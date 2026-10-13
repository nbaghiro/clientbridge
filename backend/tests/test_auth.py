"""Kratos sessions at the API edge: provisioning, /v1/me, cookie vs token, origin guard, outages."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.security import issue_powersync_token
from clientbridge.integrations.kratos import Identity, KratosIdentityProvider, get_identity_provider
from clientbridge.models.business import User
from clientbridge.services.auth import AuthService
from tests.conftest import OWNER_USER, Factory, FakeIdentityProvider, identity_for, session_token

COOKIE = get_settings().auth_session_cookie


def fresh(email: str = "fresh@test.ca", *, name: str | None = "Fresh") -> Identity:
    return Identity(
        id=str(uuid4()),
        email=email,
        verified_emails=frozenset({email}),
        name=name,
        session_id=str(uuid4()),
        aal="aal1",
    )


async def test_me_describes_the_signed_in_user(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    res = await api.get(
        "/v1/me", headers={"X-Session-Token": await session_token(identities, db, OWNER_USER)}
    )
    assert res.status_code == 200, res.text
    assert res.json() == {
        "user_id": OWNER_USER,
        "email": "hannah@birchbarkpets.ca",
        "name": "Hannah Wong",
        "email_verified": True,
        "aal": "aal1",
    }


async def test_first_request_provisions_the_user_once(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identity = fresh()
    headers = {"X-Session-Token": identities.issue(identity)}
    first = (await api.get("/v1/me", headers=headers)).json()
    second = (await api.get("/v1/me", headers=headers)).json()
    assert first["user_id"] == second["user_id"] and first["user_id"].startswith("us_")
    users = (await db.execute(select(User).where(User.identity_id == identity.id))).scalars()
    assert [u.email for u in users] == ["fresh@test.ca"]


async def test_provision_is_idempotent_for_one_identity(
    db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identity = fresh("twice@test.ca")
    first = await AuthService(db).provision(identity, identities)
    second = await AuthService(db).provision(identity, identities)
    assert first.id == second.id


async def test_profile_changes_in_kratos_reach_the_user(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user(email="before@test.ca")
    changed = identity_for(user, email="after@test.ca")
    res = await api.get("/v1/me", headers={"X-Session-Token": identities.issue(changed)})
    assert res.json()["email"] == "after@test.ca"
    await factory.db.refresh(user)
    assert user.email == "after@test.ca"


async def test_an_email_held_by_another_user_409(
    api: httpx.AsyncClient, identities: FakeIdentityProvider
) -> None:
    taken = fresh("hannah@birchbarkpets.ca")
    res = await api.get("/v1/me", headers={"X-Session-Token": identities.issue(taken)})
    assert res.status_code == 409 and res.json()["error"] == "email_in_use"


async def test_a_deleted_identity_is_relinked_when_the_email_is_verified(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    owner = await db.get(User, OWNER_USER)
    assert owner is not None
    identities.deleted.add(owner.identity_id)
    again = fresh("hannah@birchbarkpets.ca")
    unverified = replace(again, verified_emails=frozenset())
    refused = await api.get("/v1/me", headers={"X-Session-Token": identities.issue(unverified)})
    assert refused.status_code == 409
    res = await api.get("/v1/me", headers={"X-Session-Token": identities.issue(again)})
    assert res.status_code == 200 and res.json()["user_id"] == OWNER_USER
    await db.refresh(owner)
    assert str(owner.identity_id) == again.id


async def test_me_relinks_from_the_fresh_identity_right_after_verification(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    owner = await db.get(User, OWNER_USER)
    assert owner is not None
    identities.deleted.add(owner.identity_id)
    again = fresh("hannah@birchbarkpets.ca")
    token = identities.issue(again)
    identities.cached[token] = replace(again, verified_emails=frozenset())
    res = await api.get("/v1/me", headers={"X-Session-Token": token})
    assert res.status_code == 200 and res.json()["user_id"] == OWNER_USER
    assert res.json()["email_verified"] is True


async def test_last_seen_is_throttled(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    headers = {"X-Session-Token": await session_token(identities, factory.db, user.id)}
    await api.get("/v1/me", headers=headers)
    await factory.db.refresh(user)
    seen = user.last_seen_at
    assert seen is not None
    await api.get("/v1/me", headers=headers)
    await factory.db.refresh(user)
    assert user.last_seen_at == seen
    user.last_seen_at = datetime.now(UTC) - timedelta(minutes=6)
    await factory.db.flush()
    await api.get("/v1/me", headers=headers)
    await factory.db.refresh(user)
    later = user.last_seen_at
    assert later is not None and later > seen


async def test_missing_or_unknown_credentials_401(api: httpx.AsyncClient) -> None:
    for headers in ({}, {"X-Session-Token": "unknown"}, {"Authorization": "Bearer anything"}):
        res = await api.get("/v1/me", headers=headers)
        assert res.status_code == 401, headers
        assert res.json()["error"] == "unauthenticated"


async def test_a_powersync_token_is_not_a_session(api: httpx.AsyncClient) -> None:
    res = await api.get("/v1/me", headers={"X-Session-Token": issue_powersync_token(OWNER_USER)})
    assert res.status_code == 401


async def test_cookie_session_reads(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    cookie = await session_token(identities, db, OWNER_USER)
    res = await api.get("/v1/me", cookies={COOKIE: cookie})
    assert res.status_code == 200 and res.json()["user_id"] == OWNER_USER


async def test_cookie_writes_need_an_allowed_origin(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    api.cookies.set(COOKIE, await session_token(identities, db, OWNER_USER))
    url, body = "/v1/staff/invites", {"email": "csrf@test.ca", "role": "staff"}
    for origin in (
        None,
        "https://evil.example",
        "http://localhost:8709",
        "https://pay.clientbridge.ca",
    ):
        headers = {"X-Business-Id": "bz_birchbark"} | ({"Origin": origin} if origin else {})
        res = await api.post(url, json=body, headers=headers)
        assert res.status_code == 403, origin
        assert res.json()["error"] == "origin_refused"
    allowed = await api.post(
        url, json=body, headers={"X-Business-Id": "bz_birchbark", "Origin": "http://localhost:8700"}
    )
    assert allowed.status_code == 201, allowed.text


async def test_token_writes_need_no_origin(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    res = await api.post(
        "/v1/staff/invites",
        json={"email": "native@test.ca", "role": "staff"},
        headers={
            "X-Session-Token": await session_token(identities, db, OWNER_USER),
            "X-Business-Id": "bz_birchbark",
        },
    )
    assert res.status_code == 201, res.text


async def test_production_cookie_writes_come_only_from_the_web_app(
    api: httpx.AsyncClient,
    db: AsyncSession,
    identities: FakeIdentityProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "web_base_url", "https://app.clientbridge.ca")
    monkeypatch.setattr(
        settings,
        "cors_allow_origins",
        "https://connect.clientbridge.ca,https://pay.clientbridge.ca",
    )
    api.cookies.set(COOKIE, await session_token(identities, db, OWNER_USER))
    for origin, status in (
        ("http://localhost:8700", 403),
        ("https://connect.clientbridge.ca", 403),
        ("https://app.clientbridge.ca", 201),
    ):
        res = await api.post(
            "/v1/staff/invites",
            json={"email": f"prod-{status}@test.ca", "role": "staff"},
            headers={"X-Business-Id": "bz_birchbark", "Origin": origin},
        )
        assert res.status_code == status, origin


async def test_the_token_wins_over_the_cookie(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    api.cookies.set(COOKIE, await session_token(identities, db, OWNER_USER))
    token = await session_token(identities, db, "us_diego")
    res = await api.get("/v1/me", headers={"X-Session-Token": token})
    assert res.json()["user_id"] == "us_diego"


async def test_expected_user_mismatch_401(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    headers = {"X-Session-Token": await session_token(identities, db, OWNER_USER)}
    same = await api.get("/v1/me", headers=headers | {"X-Expected-User": OWNER_USER})
    assert same.status_code == 200
    other = await api.get("/v1/me", headers=headers | {"X-Expected-User": "us_diego"})
    assert other.status_code == 401 and other.json()["error"] == "session_changed"


async def test_second_factor_required_401(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    token = await session_token(identities, db, OWNER_USER)
    identities.step_up.add(token)
    res = await api.get("/v1/me", headers={"X-Session-Token": token})
    assert res.status_code == 401 and res.json()["error"] == "aal2_required"


async def test_kratos_outage_is_not_a_sign_out(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    token = await session_token(identities, db, OWNER_USER)
    identities.down = True
    res = await api.get("/v1/me", headers={"X-Session-Token": token})
    assert res.status_code == 503 and res.json()["error"] == "identity_unavailable"


async def test_onboarding_needs_a_verified_email(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    token = await session_token(identities, factory.db, user.id, verified=False)
    res = await api.post(
        "/v1/onboarding",
        json={"name": "Unverified Studio", "slug": "unverified-studio", "province": "BC"},
        headers={"X-Session-Token": token},
    )
    assert res.status_code == 403 and res.json()["error"] == "email_unverified"
    me = await api.get("/v1/me", headers={"X-Session-Token": token})
    assert me.json()["email_verified"] is False


async def test_old_auth_endpoints_are_gone(api: httpx.AsyncClient, db: AsyncSession) -> None:
    for path in ("/auth/login", "/auth/register", "/auth/refresh", "/auth/accept-invite"):
        assert (await api.post(path, json={})).status_code == 404, path
    assert await db.scalar(text("SELECT to_regclass('public.sessions')")) is None


@pytest.mark.parametrize(
    ("origin", "credentialed"),
    [
        ("http://localhost:8700", True),
        ("http://localhost:8721", True),
        ("http://localhost:8709", False),
    ],
)
async def test_only_the_web_app_gets_credentialed_cors(
    api: httpx.AsyncClient, origin: str, credentialed: bool
) -> None:
    res = await api.options(
        "/sync/token",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    assert res.headers["access-control-allow-origin"] == origin
    assert ("access-control-allow-credentials" in res.headers) is credentialed


async def test_verification_sensitive_checks_skip_the_session_cache(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    headers = {"X-Session-Token": await session_token(identities, factory.db, user.id)}
    await api.get("/v1/me", headers=headers)
    await api.post(
        "/v1/onboarding", json={"name": "F", "slug": "fresh-ck", "province": "ON"}, headers=headers
    )
    await api.post("/v1/staff/invites/accept", json={"token": "nope"}, headers=headers)
    assert identities.fresh_reads == 3
    await api.get("/sync/token", headers=headers)
    assert identities.fresh_reads == 3


def test_identity_provider_dependency_builds_the_kratos_provider() -> None:
    assert isinstance(get_identity_provider(), KratosIdentityProvider)
