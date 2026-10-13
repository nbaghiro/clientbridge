from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.zones import SUPPORTED_ZONES
from clientbridge.models.business import Business
from clientbridge.services.business import after_quiet_hours, quiet_hours, reply_address

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
    res = await as_owner.patch("/v1/business", json={"timezone": "America/Vancouver"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.timezone == "America/Vancouver" and biz.slug == slug


async def test_owner_updates_brand(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch(
        "/v1/business",
        json={
            "brand": {
                "primary": "#123abc",
                "tagline": "  Best grooming in town  ",
            }
        },
    )
    assert res.status_code == 200, res.text
    assert {k: res.json()["brand"][k] for k in ("primary", "tagline")} == {
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
        await as_owner.patch("/v1/business", json={"brand": {"cover_url": "javascript:alert(1)"}})
    ).status_code == 422


async def test_brand_merges_and_clears(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.patch(
        "/v1/business",
        json={"brand": {"primary": "#000000", "tagline": ""}},
    )
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.brand["primary"] == "#000000"
    assert "tagline" not in biz.brand
    assert biz.brand["about"]
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


async def test_unknown_timezone_is_422_and_not_stored(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    for zone in ("Mars/Olympus_Mons", "america/vancouver", "Europe/London", "EST5EDT ", "", None):
        res = await as_owner.patch("/v1/business", json={"timezone": zone})
        assert res.status_code == 422, zone
        assert res.json()["error"] == "invalid_timezone"
    after = (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    assert after == before


async def test_a_malformed_request_names_a_code(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/business", json={"name": ["not", "text"]})
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_request"


async def test_update_without_timezone_skips_the_check(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/business", json={"name": "Birchbark"})
    assert res.status_code == 200, res.text


async def test_seeded_businesses_use_supported_zones(db: AsyncSession) -> None:
    zones = set((await db.execute(select(Business.timezone))).scalars())
    assert zones and zones <= set(SUPPORTED_ZONES)


def test_quiet_hours_run_from_nine_at_night_to_nine_in_the_morning() -> None:
    zone = ZoneInfo("America/Toronto")
    evening = datetime(2026, 3, 7, 21, 30, tzinfo=zone)
    early = datetime(2026, 3, 8, 6, 0, tzinfo=zone)  # the morning the clocks spring forward
    noon = datetime(2026, 3, 8, 12, 0, tzinfo=zone)
    assert quiet_hours(evening, zone) and quiet_hours(early, zone) and not quiet_hours(noon, zone)
    nine = datetime(2026, 3, 8, 9, 0, tzinfo=zone)
    assert after_quiet_hours(evening, zone) == nine
    assert after_quiet_hours(early, zone) == nine
    assert after_quiet_hours(noon, zone) == noon


def test_replies_go_to_the_brand_email_and_fall_back_to_billing() -> None:
    business = Business(
        brand={"email": " hi@birchbark.example "}, billing_email="bill@birchbark.example"
    )
    assert reply_address(business) == "hi@birchbark.example"
    business.brand = {"email": ""}
    assert reply_address(business) == "bill@birchbark.example"
    business.billing_email = None
    assert reply_address(business) is None
    business.billing_email = "not an address"
    assert reply_address(business) is None


async def test_a_junk_billing_email_is_refused(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/business", json={"billing_email": "not an address"})
    assert res.status_code == 422
    res = await as_owner.patch("/v1/business", json={"billing_email": " owner@birchbark.example "})
    assert res.status_code == 200, res.text
