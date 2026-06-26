"""P1.2: password auth + JWT sessions — register/login, refresh rotation + reuse, logout."""

import httpx

from tests.conftest import Factory


# ── register ──────────────────────────────────────────────────────────────────────────────
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


# ── login ─────────────────────────────────────────────────────────────────────────────────
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


# ── refresh rotation + reuse-detection ────────────────────────────────────────────────────
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


# ── logout ────────────────────────────────────────────────────────────────────────────────
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
