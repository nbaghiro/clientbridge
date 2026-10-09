"""Password auth + JWT sessions: register/login, refresh rotation/reuse, logout, token rejection."""

import time
from uuid import uuid4

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


async def test_login_pauses_after_five_failures_429(
    api: httpx.AsyncClient, factory: Factory
) -> None:
    await factory.user(email="locked@test.ca", password="correct-horse")
    for _ in range(5):
        res = await api.post("/auth/login", json={"email": "locked@test.ca", "password": "nope"})
        assert res.status_code == 401
    res = await api.post(
        "/auth/login", json={"email": "Locked@test.ca", "password": "correct-horse"}
    )
    assert res.status_code == 429
    assert res.json()["error"] == "login_locked"
    other = await api.post("/auth/login", json={"email": "other@test.ca", "password": "x"})
    assert other.status_code == 401


async def test_login_success_clears_failures(api: httpx.AsyncClient, factory: Factory) -> None:
    await factory.user(email="clears@test.ca", password="correct-horse")
    for _ in range(4):
        await api.post("/auth/login", json={"email": "clears@test.ca", "password": "nope"})
    ok = await api.post(
        "/auth/login", json={"email": "clears@test.ca", "password": "correct-horse"}
    )
    assert ok.status_code == 200
    for _ in range(4):
        await api.post("/auth/login", json={"email": "clears@test.ca", "password": "nope"})
    ok = await api.post(
        "/auth/login", json={"email": "clears@test.ca", "password": "correct-horse"}
    )
    assert ok.status_code == 200


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
    res = await api.get("/v1/staff/team", headers={"Authorization": f"Bearer {access}"})
    assert res.status_code == 200
    assert [m["role"] for m in res.json()["members"]] == ["owner"]


async def _login(api: httpx.AsyncClient, factory: Factory) -> tuple[str, str]:
    await factory.user(email="rot@test.ca", password="pw-123456")
    res = await api.post("/auth/login", json={"email": "rot@test.ca", "password": "pw-123456"})
    body = res.json()
    return str(body["access_token"]), str(body["refresh_token"])


async def test_refresh_rotates(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    res = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert res.status_code == 200
    assert res.json()["refresh_token"] != refresh  # rotated to a new token


async def test_refresh_invalid_401(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/auth/refresh", json={"refresh_token": "not-a-real-token", "attempt_id": str(uuid4())}
    )
    assert res.status_code == 401


async def test_refresh_requires_an_attempt_identity(api: httpx.AsyncClient) -> None:
    response = await api.post("/auth/refresh", json={"refresh_token": "unused"})
    assert response.status_code == 422


async def test_refresh_reuse_revokes_family(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    first = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert first.status_code == 200
    new_refresh = first.json()["refresh_token"]

    # replaying the OLD (already-rotated) refresh → reuse detected → 401
    replay = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert replay.status_code == 401

    # ...and the whole family is now revoked: the legit NEW refresh no longer works either
    after = await api.post(
        "/auth/refresh", json={"refresh_token": new_refresh, "attempt_id": str(uuid4())}
    )
    assert after.status_code == 401


async def test_logout_revokes(api: httpx.AsyncClient, factory: Factory) -> None:
    _, refresh = await _login(api, factory)
    res = await api.post("/auth/logout", json={"refresh_token": refresh})
    assert res.status_code == 204
    after = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert after.status_code == 401


async def test_logout_unknown_token_204(api: httpx.AsyncClient) -> None:
    # no info leak — logging out an unknown token still 204s
    res = await api.post("/auth/logout", json={"refresh_token": "whatever"})
    assert res.status_code == 204


async def test_tampered_access_token_rejected(api: httpx.AsyncClient) -> None:
    # real header + payload, but a signature that can't match the HMAC → always rejected
    header, payload, _sig = issue_access_token(OWNER_USER, family_id="test-family").split(".")
    tampered = f"{header}.{payload}.wrongsignature"
    assert (await api.get("/v1/staff/team", headers=_auth(tampered))).status_code == 401


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
    assert (await api.get("/v1/staff/team", headers=_auth(expired))).status_code == 401


async def test_forged_signature_rejected(api: httpx.AsyncClient) -> None:
    s = get_settings()
    now = int(time.time())
    forged = jwt.encode(
        {"sub": OWNER_USER, "type": "access", "iss": s.jwt_issuer, "iat": now, "exp": now + 300},
        "not-the-real-signing-secret-but-plenty-long-enough",
        algorithm="HS256",
    )
    assert (await api.get("/v1/staff/team", headers=_auth(forged))).status_code == 401


async def test_sync_token_rejected_on_api_route(api: httpx.AsyncClient) -> None:
    # a PowerSync token (aud=powersync, no iss) must not authorize a /v1 API route
    sync_token = issue_powersync_token(OWNER_USER)
    assert (await api.get("/v1/staff/team", headers=_auth(sync_token))).status_code == 401


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
    refresh = await api.post(
        "/auth/refresh", json={"refresh_token": old_refresh, "attempt_id": str(uuid4())}
    )
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


async def test_refresh_replays_same_attempt_without_revoking_family(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    from uuid import uuid4

    from sqlalchemy import select

    from clientbridge.core.security import hash_token
    from clientbridge.models.auth import AuthSession

    _, refresh = await _login(api, factory)
    body = {"refresh_token": refresh, "attempt_id": str(uuid4())}
    first = await api.post("/auth/refresh", json=body)
    replay = await api.post("/auth/refresh", json=body)
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    stored = await db.scalar(
        select(AuthSession).where(AuthSession.token_hash == hash_token(refresh))
    )
    assert stored is not None and stored.replay_ciphertext is not None
    assert first.json()["refresh_token"] not in stored.replay_ciphertext
    assert first.json()["access_token"] not in stored.replay_ciphertext
    next_refresh = await api.post(
        "/auth/refresh",
        json={"refresh_token": first.json()["refresh_token"], "attempt_id": str(uuid4())},
    )
    assert next_refresh.status_code == 200, next_refresh.text


async def test_refresh_different_attempt_revokes_family(
    api: httpx.AsyncClient, factory: Factory
) -> None:
    from uuid import uuid4

    _, refresh = await _login(api, factory)
    first = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert first.status_code == 200
    replay = await api.post(
        "/auth/refresh", json={"refresh_token": refresh, "attempt_id": str(uuid4())}
    )
    assert replay.status_code == 401
    after = await api.post(
        "/auth/refresh",
        json={"refresh_token": first.json()["refresh_token"], "attempt_id": str(uuid4())},
    )
    assert after.status_code == 401


async def test_logout_prevents_refresh_replay(api: httpx.AsyncClient, factory: Factory) -> None:
    from uuid import uuid4

    _, refresh = await _login(api, factory)
    body = {"refresh_token": refresh, "attempt_id": str(uuid4())}
    first = await api.post("/auth/refresh", json=body)
    assert first.status_code == 200
    assert (
        await api.post("/auth/logout", json={"refresh_token": first.json()["refresh_token"]})
    ).status_code == 204
    assert (await api.post("/auth/refresh", json=body)).status_code == 401


async def test_expired_refresh_replay_is_pruned_and_refused(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from sqlalchemy import update

    from clientbridge.models.auth import AuthSession
    from clientbridge.services.auth import run_prune_refreshes

    _, refresh = await _login(api, factory)
    body = {"refresh_token": refresh, "attempt_id": str(uuid4())}
    assert (await api.post("/auth/refresh", json=body)).status_code == 200
    now = datetime.now(UTC)
    await db.execute(
        update(AuthSession)
        .where(AuthSession.replay_ciphertext.is_not(None))
        .values(replay_expires_at=now - timedelta(seconds=1))
    )
    assert await run_prune_refreshes(db, now) >= 1
    assert (await api.post("/auth/refresh", json=body)).status_code == 401


async def test_concurrent_same_refresh_attempt_returns_one_rotation(db: AsyncSession) -> None:
    import asyncio
    from uuid import uuid4

    from sqlalchemy import delete, select

    from clientbridge.core.db import SessionLocal
    from clientbridge.core.security import decode_jwt
    from clientbridge.main import create_app
    from clientbridge.models.auth import AuthSession
    from clientbridge.services.auth import AuthService

    async with SessionLocal() as session:
        pair = await AuthService(session).issue_session(OWNER_USER)
    family = str(decode_jwt(pair.access_token)["sid"])
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            body = {"refresh_token": pair.refresh_token, "attempt_id": str(uuid4())}
            first, second = await asyncio.gather(
                client.post("/auth/refresh", json=body), client.post("/auth/refresh", json=body)
            )
            assert first.status_code == second.status_code == 200, (first.text, second.text)
            assert first.json() == second.json()
        async with SessionLocal() as session:
            active = list(
                await session.scalars(
                    select(AuthSession).where(
                        AuthSession.family_id == family, AuthSession.revoked_at.is_(None)
                    )
                )
            )
            assert len(active) == 1
    finally:
        async with SessionLocal() as session:
            await session.execute(delete(AuthSession).where(AuthSession.family_id == family))
            await session.commit()
