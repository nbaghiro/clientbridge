"""Password auth + JWT sessions: register/login, refresh rotation/reuse, logout, token rejection."""

import time

import httpx
import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.security import issue_access_token, issue_powersync_token
from tests.conftest import OWNER_USER, Factory, FakeEmailSender


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_register_returns_token_pair(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/auth/register", json={"email": "new@test.ca", "password": "pw-123456", "name": "New"}
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_register_duplicate_email_409(api: httpx.AsyncClient, factory: Factory) -> None:
    await factory.user(email="dup@test.ca", password="x")
    res = await api.post("/auth/register", json={"email": "dup@test.ca", "password": "pw-123456"})
    assert res.status_code == 409


async def test_login_seeded_user(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/auth/login", json={"email": "hannah@birchbarkpets.ca", "password": "demo1234"}
    )
    assert res.status_code == 200
    assert res.json()["access_token"]


async def test_login_unknown_email_401(api: httpx.AsyncClient) -> None:
    res = await api.post("/auth/login", json={"email": "nobody@nowhere.ca", "password": "x"})
    assert res.status_code == 401


async def test_login_wrong_password_401(api: httpx.AsyncClient, factory: Factory) -> None:
    await factory.user(email="pw@test.ca", password="correct-horse")
    res = await api.post("/auth/login", json={"email": "pw@test.ca", "password": "nope"})
    assert res.status_code == 401


async def test_login_correct_password(api: httpx.AsyncClient, factory: Factory) -> None:
    await factory.user(email="pw2@test.ca", password="correct-horse")
    res = await api.post("/auth/login", json={"email": "pw2@test.ca", "password": "correct-horse"})
    assert res.status_code == 200
    assert res.json()["access_token"]


async def test_access_token_authorizes(api: httpx.AsyncClient, factory: Factory) -> None:
    biz = await factory.business()
    user = await factory.user(email="owner@test.ca", password="pw-123456")
    await factory.staff(business=biz, user=user, role="owner")
    login = await api.post("/auth/login", json={"email": "owner@test.ca", "password": "pw-123456"})
    access = login.json()["access_token"]
    res = await api.get("/v1/clients", headers={"Authorization": f"Bearer {access}"})
    assert res.status_code == 200
    assert res.json()["total"] == 0  # fresh business → no clients


async def _login(api: httpx.AsyncClient, factory: Factory) -> tuple[str, str]:
    await factory.user(email="rot@test.ca", password="pw-123456")
    res = await api.post("/auth/login", json={"email": "rot@test.ca", "password": "pw-123456"})
    body = res.json()
    return str(body["access_token"]), str(body["refresh_token"])


async def test_refresh_rotates(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    res = await api.post("/auth/refresh", json={"refresh_token": refresh})
    assert res.status_code == 200
    assert res.json()["refresh_token"] != refresh  # rotated to a new token


async def test_refresh_invalid_401(api: httpx.AsyncClient) -> None:
    res = await api.post("/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert res.status_code == 401


async def test_refresh_reuse_revokes_family(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    first = await api.post("/auth/refresh", json={"refresh_token": refresh})
    assert first.status_code == 200
    new_refresh = first.json()["refresh_token"]

    # replaying the OLD (already-rotated) refresh → reuse detected → 401
    replay = await api.post("/auth/refresh", json={"refresh_token": refresh})
    assert replay.status_code == 401

    # ...and the whole family is now revoked: the legit NEW refresh no longer works either
    after = await api.post("/auth/refresh", json={"refresh_token": new_refresh})
    assert after.status_code == 401


async def test_logout_revokes(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    res = await api.post("/auth/logout", json={"refresh_token": refresh})
    assert res.status_code == 204
    after = await api.post("/auth/refresh", json={"refresh_token": refresh})
    assert after.status_code == 401


async def test_logout_unknown_token_204(api: httpx.AsyncClient) -> None:
    # no info leak — logging out an unknown token still 204s
    res = await api.post("/auth/logout", json={"refresh_token": "whatever"})
    assert res.status_code == 204


async def test_tampered_access_token_rejected(api: httpx.AsyncClient) -> None:
    # real header + payload, but a signature that can't match the HMAC → always rejected
    header, payload, _sig = issue_access_token(OWNER_USER).split(".")
    tampered = f"{header}.{payload}.wrongsignature"
    assert (await api.get("/v1/clients", headers=_auth(tampered))).status_code == 401


async def test_expired_access_token_rejected(api: httpx.AsyncClient) -> None:
    s = get_settings()
    now = int(time.time())
    expired = jwt.encode(
        {
            "sub": OWNER_USER,
            "type": "access",
            "iss": s.jwt_issuer,
            "iat": now - 100,
            "exp": now - 10,
        },
        s.jwt_secret,
        algorithm="HS256",
    )
    assert (await api.get("/v1/clients", headers=_auth(expired))).status_code == 401


async def test_forged_signature_rejected(api: httpx.AsyncClient) -> None:
    s = get_settings()
    now = int(time.time())
    forged = jwt.encode(
        {"sub": OWNER_USER, "type": "access", "iss": s.jwt_issuer, "iat": now, "exp": now + 300},
        "not-the-real-signing-secret-but-plenty-long-enough",
        algorithm="HS256",
    )
    assert (await api.get("/v1/clients", headers=_auth(forged))).status_code == 401


async def test_sync_token_rejected_on_api_route(api: httpx.AsyncClient) -> None:
    # a PowerSync token (aud=powersync, no iss) must not authorize a /v1 API route
    sync_token = issue_powersync_token(OWNER_USER)
    assert (await api.get("/v1/clients", headers=_auth(sync_token))).status_code == 401


async def test_forgot_password_existing_sends_email(
    api: httpx.AsyncClient, factory: Factory, email: FakeEmailSender
) -> None:
    await factory.user(email="reset-me@test.ca", password="old-password")
    res = await api.post("/auth/forgot-password", json={"email": "reset-me@test.ca"})
    assert res.status_code == 200
    assert len(email.sent) == 1
    assert email.sent[0].to == "reset-me@test.ca"


async def test_forgot_password_unknown_no_enumeration(
    api: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    res = await api.post("/auth/forgot-password", json={"email": "ghost@test.ca"})
    assert res.status_code == 200  # identical response to the existing-email case
    assert email.sent == []  # ...but nothing is actually sent


async def test_reset_password_changes_credentials(
    api: httpx.AsyncClient, factory: Factory, email: FakeEmailSender
) -> None:
    await factory.user(email="rp@test.ca", password="old-password")
    await api.post("/auth/forgot-password", json={"email": "rp@test.ca"})
    token = email.sent[-1].body.split()[-1]
    res = await api.post(
        "/auth/reset-password", json={"token": token, "new_password": "new-password"}
    )
    assert res.status_code == 204
    old = await api.post("/auth/login", json={"email": "rp@test.ca", "password": "old-password"})
    assert old.status_code == 401
    new = await api.post("/auth/login", json={"email": "rp@test.ca", "password": "new-password"})
    assert new.status_code == 200


async def test_reset_token_single_use(
    api: httpx.AsyncClient, factory: Factory, email: FakeEmailSender
) -> None:
    await factory.user(email="single@test.ca", password="old-password")
    await api.post("/auth/forgot-password", json={"email": "single@test.ca"})
    token = email.sent[-1].body.split()[-1]
    first = await api.post("/auth/reset-password", json={"token": token, "new_password": "new-1"})
    assert first.status_code == 204
    second = await api.post("/auth/reset-password", json={"token": token, "new_password": "new-2"})
    assert second.status_code == 401


async def test_reset_expired_token_401(
    api: httpx.AsyncClient, factory: Factory, email: FakeEmailSender, db: AsyncSession
) -> None:
    user = await factory.user(email="exp-reset@test.ca", password="old-password")
    await api.post("/auth/forgot-password", json={"email": "exp-reset@test.ca"})
    token = email.sent[-1].body.split()[-1]
    await db.execute(
        text("UPDATE tokens SET expires_at = now() - interval '1 hour' WHERE user_id = :u"),
        {"u": user.id},
    )
    res = await api.post("/auth/reset-password", json={"token": token, "new_password": "x"})
    assert res.status_code == 401


async def test_reset_invalidates_sessions(
    api: httpx.AsyncClient, factory: Factory, email: FakeEmailSender
) -> None:
    await factory.user(email="sess@test.ca", password="old-password")
    login = await api.post(
        "/auth/login", json={"email": "sess@test.ca", "password": "old-password"}
    )
    old_refresh = login.json()["refresh_token"]
    await api.post("/auth/forgot-password", json={"email": "sess@test.ca"})
    token = email.sent[-1].body.split()[-1]
    await api.post("/auth/reset-password", json={"token": token, "new_password": "new-password"})
    # the pre-reset session is dead
    refresh = await api.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh.status_code == 401


async def test_register_sends_and_verifies_email(
    api: httpx.AsyncClient, email: FakeEmailSender, db: AsyncSession
) -> None:
    res = await api.post(
        "/auth/register", json={"email": "verify-me@test.ca", "password": "pw-123456"}
    )
    assert res.status_code == 201
    assert len(email.sent) == 1  # the verification email
    token = email.sent[-1].body.split()[-1]
    verify = await api.post("/auth/verify-email", json={"token": token})
    assert verify.status_code == 204
    verified = (
        await db.execute(
            text("SELECT email_verified_at FROM users WHERE email = 'verify-me@test.ca'")
        )
    ).scalar()
    assert verified is not None


async def test_verify_invalid_token_401(api: httpx.AsyncClient) -> None:
    res = await api.post("/auth/verify-email", json={"token": "bogus"})
    assert res.status_code == 401
