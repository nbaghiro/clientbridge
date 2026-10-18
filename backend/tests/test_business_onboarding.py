"""Onboarding — atomic business + owner staff; the province drives the derived tax rates."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.services.tax import rates_for_business
from tests.conftest import Factory, FakeIdentityProvider, session_token


async def _auth(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, user_id: str
) -> None:
    api.headers.update({"X-Session-Token": await session_token(identities, factory.db, user_id)})


async def test_onboard_creates_business_owner_and_taxes(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    res = await api.post(
        "/v1/onboarding", json={"name": "Acme Cleaning", "slug": "acme-clean", "province": "BC"}
    )
    assert res.status_code == 201, res.text
    biz = res.json()
    assert biz["slug"] == "acme-clean"
    assert biz["province"] == "BC"

    owner = (
        await db.execute(
            text("SELECT role, name FROM staff WHERE business_id = :b AND user_id = :u"),
            {"b": biz["id"], "u": user.id},
        )
    ).one()
    assert owner.role == "owner"
    assert owner.name == user.name  # the owner's name syncs to the team on their staff row

    # An exact ordered list, so a duplicated or missing rate fails
    rates = await rates_for_business(db, biz["id"])
    assert [(r.jurisdiction, r.rate_bps) for r in rates] == [("GST", 500), ("PST", 700)]


async def test_onboard_province_drives_taxes(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    res = await api.post(
        "/v1/onboarding", json={"name": "ON Biz", "slug": "on-biz", "province": "ON"}
    )
    assert res.status_code == 201
    rates = await rates_for_business(db, res.json()["id"])
    assert [(r.jurisdiction, r.rate_bps) for r in rates] == [("HST", 1300)]


async def test_onboard_owner_can_access_their_team(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    res = await api.post("/v1/onboarding", json={"name": "X", "slug": "x-co", "province": "AB"})
    assert res.status_code == 201
    res = await api.get("/v1/staff/team")
    assert res.status_code == 200
    assert [m["role"] for m in res.json()["members"]] == ["owner"]


async def test_onboard_duplicate_slug_409_no_partial(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    first = await api.post(
        "/v1/onboarding", json={"name": "A", "slug": "dup-slug", "province": "AB"}
    )
    assert first.status_code == 201
    second = await api.post(
        "/v1/onboarding", json={"name": "B", "slug": "dup-slug", "province": "AB"}
    )
    assert second.status_code == 409
    n = (await db.execute(text("SELECT count(*) FROM businesses WHERE slug = 'dup-slug'"))).scalar()
    assert n == 1


async def test_unauthenticated_onboard_401(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/v1/onboarding", json={"name": "X", "slug": "noauth-co", "province": "AB"}
    )
    assert res.status_code == 401


async def test_invalid_province_422(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    res = await api.post("/v1/onboarding", json={"name": "X", "slug": "bad-prov", "province": "XX"})
    assert res.status_code == 422  # an unsupported province must be rejected, not stored
    n = (await db.execute(text("SELECT count(*) FROM businesses WHERE slug = 'bad-prov'"))).scalar()
    assert n == 0  # and nothing partial is committed


async def test_onboard_keeps_a_valid_timezone(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    body = {"name": "Tz", "slug": "tz-ok", "province": "NS", "timezone": "America/Halifax"}
    res = await api.post("/v1/onboarding", json=body)
    assert res.status_code == 201, res.text
    assert res.json()["timezone"] == "America/Halifax"


async def test_onboard_defaults_timezone(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    res = await api.post("/v1/onboarding", json={"name": "D", "slug": "tz-def", "province": "ON"})
    assert res.json()["timezone"] == "America/Toronto"


async def test_onboard_unknown_timezone_422_no_partial(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider, db: AsyncSession
) -> None:
    user = await factory.user()
    await _auth(api, factory, identities, user.id)
    body = {"name": "X", "slug": "tz-bad", "province": "BC", "timezone": "Pacific Time"}
    res = await api.post("/v1/onboarding", json=body)
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_timezone"
    n = (await db.execute(text("SELECT count(*) FROM businesses WHERE slug = 'tz-bad'"))).scalar()
    assert n == 0
