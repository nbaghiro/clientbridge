"""Onboarding — atomic business + owner staff; the province drives the derived tax rates."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.security import issue_access_token
from tests.conftest import Factory


def _auth(api: httpx.AsyncClient, user_id: str) -> None:
    api.headers.update({"Authorization": f"Bearer {issue_access_token(user_id)}"})


async def test_onboard_creates_business_owner_and_taxes(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    user = await factory.user()
    _auth(api, user.id)
    res = await api.post(
        "/v1/onboarding", json={"name": "Acme Cleaning", "slug": "acme-clean", "province": "BC"}
    )
    assert res.status_code == 201, res.text
    biz = res.json()
    assert biz["slug"] == "acme-clean"
    assert biz["province"] == "BC"

    role = (
        await db.execute(
            text("SELECT role FROM staff WHERE business_id = :b AND user_id = :u"),
            {"b": biz["id"], "u": user.id},
        )
    ).scalar()
    assert role == "owner"

    # rates aren't stored — they're derived from the business's province at request time. Assert the
    # exact ordered list (not a set) so a duplicate/wrong-count regression can't slip through.
    rates = (await api.get("/v1/tax-rates")).json()
    assert [(r["jurisdiction"], r["rate_bps"]) for r in rates] == [("GST", 500), ("PST", 700)]


async def test_onboard_province_drives_taxes(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    _auth(api, user.id)
    res = await api.post(
        "/v1/onboarding", json={"name": "ON Biz", "slug": "on-biz", "province": "ON"}
    )
    assert res.status_code == 201
    rates = (await api.get("/v1/tax-rates")).json()
    assert [(r["jurisdiction"], r["rate_bps"]) for r in rates] == [("HST", 1300)]


async def test_onboard_owner_can_access_scoped_clients(
    api: httpx.AsyncClient, factory: Factory
) -> None:
    user = await factory.user()
    _auth(api, user.id)
    res = await api.post("/v1/onboarding", json={"name": "X", "slug": "x-co", "province": "AB"})
    assert res.status_code == 201
    # the user now has exactly one business → /v1/clients resolves + is scoped (empty)
    res = await api.get("/v1/clients")
    assert res.status_code == 200
    assert res.json()["total"] == 0


async def test_onboard_duplicate_slug_409_no_partial(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    user = await factory.user()
    _auth(api, user.id)
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
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    user = await factory.user()
    _auth(api, user.id)
    res = await api.post("/v1/onboarding", json={"name": "X", "slug": "bad-prov", "province": "XX"})
    assert res.status_code == 422  # an unsupported province must be rejected, not stored
    n = (await db.execute(text("SELECT count(*) FROM businesses WHERE slug = 'bad-prov'"))).scalar()
    assert n == 0  # and nothing partial is committed
