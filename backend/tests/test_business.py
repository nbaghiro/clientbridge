import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business

BIZ = "bz_birchbark"


async def test_owner_updates_account_settings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch(
        "/v1/business",
        json={
            "name": "Birchbark Grooming Co",
            "timezone": "America/Vancouver",
            "billing_email": "owner@birchbark.test",
            "gst_hst_number": "123456789RT0001",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "Birchbark Grooming Co"
    assert body["gst_hst_number"] == "123456789RT0001"
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.name == "Birchbark Grooming Co" and biz.timezone == "America/Vancouver"
    assert biz.billing_email == "owner@birchbark.test"


async def test_partial_update_leaves_other_fields(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slug = (await db.execute(select(Business.slug).where(Business.id == BIZ))).scalar_one()
    res = await as_owner.patch("/v1/business", json={"locale": "fr"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.locale == "fr" and biz.slug == slug  # slug is not editable here, left untouched


async def test_staff_cannot_update_account(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/business", json={"name": "Nope"})
    assert res.status_code == 403


async def test_unauth_cannot_update_account(unauth: httpx.AsyncClient) -> None:
    res = await unauth.patch("/v1/business", json={"name": "Nope"})
    assert res.status_code == 401
