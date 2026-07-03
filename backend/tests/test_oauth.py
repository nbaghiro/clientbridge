"""Google OAuth — verify (faked) → find-or-create user → session."""

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import User
from tests.conftest import Factory


async def test_oauth_new_user_created_and_session(api: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await api.post("/auth/oauth/google", json={"id_token": "newperson@gmail.com"})
    assert res.status_code == 200
    assert res.json()["access_token"]
    user = (await db.execute(select(User).where(User.email == "newperson@gmail.com"))).scalar_one()
    assert user.email_verified_at is not None  # Google asserts the email is verified
    assert "google" in user.oauth


async def test_oauth_links_existing_user(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    await factory.user(email="existing@gmail.com")
    res = await api.post("/auth/oauth/google", json={"id_token": "existing@gmail.com"})
    assert res.status_code == 200
    n = (
        await db.execute(text("SELECT count(*) FROM users WHERE email = 'existing@gmail.com'"))
    ).scalar()
    assert n == 1  # linked to the existing user, not duplicated
    user = (await db.execute(select(User).where(User.email == "existing@gmail.com"))).scalar_one()
    assert "google" in user.oauth


async def test_oauth_unverified_email_rejected(api: httpx.AsyncClient) -> None:
    # An unverified provider email must not sign in / link (it could assert a victim's address).
    res = await api.post("/auth/oauth/google", json={"id_token": "unverified-victim@gmail.com"})
    assert res.status_code == 401


async def test_oauth_invalid_token_401(api: httpx.AsyncClient) -> None:
    res = await api.post("/auth/oauth/google", json={"id_token": "invalid"})
    assert res.status_code == 401


async def test_oauth_session_authenticates(api: httpx.AsyncClient) -> None:
    res = await api.post("/auth/oauth/google", json={"id_token": "sess@gmail.com"})
    access = res.json()["access_token"]
    sync = await api.get("/sync/token", headers={"Authorization": f"Bearer {access}"})
    assert sync.status_code == 200
