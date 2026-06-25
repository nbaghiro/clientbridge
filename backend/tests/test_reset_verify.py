"""P1.5: password reset + email verification — one-time tokens, no enumeration."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import Factory, FakeEmailSender


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
        text("UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = :u"),
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
