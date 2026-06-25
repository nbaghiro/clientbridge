"""P1.3: onboarding — atomic business + owner staff + province tax_rates."""

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

    rates = (
        (
            await db.execute(
                text("SELECT jurisdiction FROM tax_rates WHERE business_id = :b"), {"b": biz["id"]}
            )
        )
        .scalars()
        .all()
    )
    assert set(rates) == {"GST", "PST"}


async def test_onboard_province_drives_taxes(
    api: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    user = await factory.user()
    _auth(api, user.id)
    res = await api.post(
        "/v1/onboarding", json={"name": "ON Biz", "slug": "on-biz", "province": "ON"}
    )
    assert res.status_code == 201
    rows = (
        await db.execute(
            text("SELECT jurisdiction, rate_bps FROM tax_rates WHERE business_id = :b"),
            {"b": res.json()["id"]},
        )
    ).all()
    assert [tuple(r) for r in rows] == [("HST", 1300)]


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
