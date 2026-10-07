import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business

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


async def test_owner_updates_brand(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch(
        "/v1/business",
        json={
            "brand": {
                "logo_url": "https://cdn.example/logo.png",
                "primary": "#123abc",
                "tagline": "  Best grooming in town  ",
            }
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["brand"] == {
        "logo_url": "https://cdn.example/logo.png",
        "primary": "#123abc",
        "tagline": "Best grooming in town",  # trimmed
    }
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.brand["primary"] == "#123abc"


async def test_brand_rejects_invalid_values(as_owner: httpx.AsyncClient) -> None:
    assert (
        await as_owner.patch("/v1/business", json={"brand": {"primary": "red"}})
    ).status_code == 422
    assert (
        await as_owner.patch("/v1/business", json={"brand": {"logo_url": "javascript:alert(1)"}})
    ).status_code == 422


async def test_brand_replaces_and_clears(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    # sending brand replaces it wholesale; emptied fields drop out, unrelated fields stay untouched
    res = await as_owner.patch(
        "/v1/business",
        json={"brand": {"primary": "#000000", "tagline": "", "logo_url": ""}},
    )
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.brand == {"primary": "#000000"}
    assert biz.name == "Birchbark Pet Studio"  # a field not sent in this PATCH is left alone


async def test_staff_cannot_update_account(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/business", json={"name": "Nope"})
    assert res.status_code == 403


async def test_unauth_cannot_update_account(unauth: httpx.AsyncClient) -> None:
    res = await unauth.patch("/v1/business", json={"name": "Nope"})
    assert res.status_code == 401


async def test_tax_registration_numbers_and_filing(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch(
        "/v1/business",
        json={
            "tax_registered": True,
            "gst_hst_number": "123456789 rt 0001",
            "pst_number": "PST-1234-5678",
            "filing_frequency": "quarterly",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["tax_registered"] is True
    assert body["gst_hst_number"] == "123456789RT0001"
    assert body["pst_number"] == "PST12345678"
    assert body["filing_frequency"] == "quarterly"
    cleared = await as_owner.patch("/v1/business", json={"pst_number": ""})
    assert cleared.json()["pst_number"] is None


async def test_bad_tax_numbers_are_422(as_owner: httpx.AsyncClient) -> None:
    for body in (
        {"gst_hst_number": "12345"},
        {"qst_number": "1234567890RT0001"},
        {"pst_number": "PST-12"},
        {"filing_frequency": "weekly"},
    ):
        assert (await as_owner.patch("/v1/business", json=body)).status_code == 422, body


async def test_setup_list_can_be_hidden_and_shown(as_owner: httpx.AsyncClient) -> None:
    hidden = await as_owner.patch("/v1/business", json={"setup_dismissed": True})
    assert hidden.json()["setup_dismissed_at"] is not None
    shown = await as_owner.patch("/v1/business", json={"setup_dismissed": False})
    assert shown.json()["setup_dismissed_at"] is None


async def test_staff_cannot_change_tax_settings_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/business", json={"tax_registered": True})
    assert res.status_code == 403
