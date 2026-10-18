from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.zones import SUPPORTED_ZONES
from clientbridge.integrations.stripe import PostalAddress
from clientbridge.models.business import Business
from clientbridge.services.business import (
    after_quiet_hours,
    postal_address,
    quiet_hours,
    reply_address,
)
from tests.conftest import Factory, FakePaymentGateway

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


async def test_a_new_address_drops_the_terminal_location_made_for_the_old_one(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_terminal_location_id = "tml_old"
    await db.flush()
    same = {"street_number": "1207", "postal_code": "v8w1y9", "brand": {"address": "Elsewhere"}}
    assert (await as_owner.patch("/v1/business", json=same)).status_code == 200
    await db.refresh(business)
    assert business.stripe_terminal_location_id == "tml_old"
    moved = {"unit": "Suite 4"}
    assert (await as_owner.patch("/v1/business", json=moved)).status_code == 200
    await db.refresh(business)
    assert business.stripe_terminal_location_id is None


async def test_owner_sets_and_clears_the_subject_kind_of_their_business_only(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    res = await as_owner.patch("/v1/business", json={"subject": "student"})
    assert res.status_code == 200, res.text
    assert res.json()["subject"] == "student"
    res = await as_owner.patch("/v1/business", json={"name": "Birchbark"})
    assert res.json()["subject"] == "student"
    res = await as_owner.patch("/v1/business", json={"subject": None})
    assert res.json()["subject"] is None
    await db.refresh(other)
    assert other.subject == "pet"


async def test_an_unknown_subject_kind_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/business", json={"subject": "vehicle"})
    assert res.status_code == 422


async def test_staff_cannot_change_the_subject_kind_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/business", json={"subject": "property"})
    assert res.status_code == 403


async def test_owner_sets_and_clears_the_legal_address_and_phone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {
        "unit": " Suite 4 ",
        "street_number": "88",
        "street_name": "Fort St",
        "city": "Victoria",
        "postal_code": "v8w1y4",
        "legal_phone": "(250) 555-0199",
    }
    res = await as_owner.patch("/v1/business", json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert (out["unit"], out["postal_code"], out["legal_phone"]) == (
        "Suite 4",
        "V8W 1Y4",
        "+12505550199",
    )
    res = await as_owner.patch("/v1/business", json={"unit": "", "legal_phone": ""})
    assert res.status_code == 200, res.text
    business = await db.get(Business, BIZ)
    assert business is not None
    await db.refresh(business)
    assert business.unit is None and business.legal_phone is None and business.street_number == "88"


@pytest.mark.parametrize(
    "body",
    [
        {"postal_code": "12345"},
        {"postal_code": "V8W 1Y"},
        {"legal_phone": "555-01"},
        {"postal_code": "V\u0668W \u0661Y\u0669"},
        {"street_name": "x" * 101},
    ],
)
async def test_a_malformed_legal_address_or_phone_is_refused(
    as_owner: httpx.AsyncClient, body: dict[str, str]
) -> None:
    assert (await as_owner.patch("/v1/business", json=body)).status_code == 422


async def test_a_postal_code_outside_the_province_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch("/v1/business", json={"postal_code": "M5H 2N2"})
    assert res.status_code == 422 and res.json()["error"] == "postal_code_province_mismatch"
    business = await db.get(Business, BIZ)
    assert business is not None
    await db.refresh(business)
    assert business.postal_code == "V8W 1Y9"


@pytest.mark.parametrize("province", ["NU", "NT"])
async def test_nunavut_and_the_northwest_territories_share_x_postal_codes(
    as_owner: httpx.AsyncClient, db: AsyncSession, province: str
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(province=province))
    await db.flush()
    res = await as_owner.patch("/v1/business", json={"postal_code": "X0A 0H0"})
    assert res.status_code == 200, res.text


async def test_a_moved_plan_only_account_takes_the_new_address_to_stripe(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_plan", stripe_requirements={})
    )
    await db.flush()
    assert (await as_owner.patch("/v1/business", json={"name": "Renamed"})).status_code == 200
    assert gateway.account_addresses == []
    assert (await as_owner.patch("/v1/business", json={"unit": "Suite 4"})).status_code == 200
    assert gateway.account_addresses == [
        (
            "acct_plan",
            PostalAddress("1207 Government Street", "Victoria", "BC", "V8W 1Y9", "Suite 4"),
        )
    ]
    assert (await as_owner.patch("/v1/business", json={"city": ""})).status_code == 200
    assert len(gateway.account_addresses) == 1


async def test_a_stripe_failure_leaves_the_address_saved(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_plan", stripe_requirements={})
    )
    await db.flush()

    async def unavailable(account_id: str, *, address: PostalAddress) -> None:
        raise RuntimeError("stripe is unavailable")

    monkeypatch.setattr(gateway, "update_account_address", unavailable)
    body = {"name": "Renamed", "unit": "Suite 9"}
    res = await as_owner.patch("/v1/business", json=body)
    assert res.status_code == 200, res.text
    business = await db.get_one(Business, BIZ)
    await db.refresh(business)
    assert (business.name, business.unit) == ("Renamed", "Suite 9")


async def test_a_payments_account_keeps_its_stripe_verified_address(
    as_owner: httpx.AsyncClient, gateway: FakePaymentGateway
) -> None:
    assert (await as_owner.patch("/v1/business", json={"unit": "Suite 4"})).status_code == 200
    assert gateway.account_addresses == []


async def test_staff_cannot_change_the_legal_address(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_staff.patch("/v1/business", json={"city": "Toronto"})
    assert res.status_code == 403
    business = await db.get(Business, BIZ)
    assert business is not None and business.city == "Victoria"


@pytest.mark.parametrize("business_id", [BIZ, "bz_demo_second"])
async def test_each_demo_business_has_a_complete_legal_address(
    db: AsyncSession, business_id: str
) -> None:
    business = await db.get_one(Business, business_id)
    address = postal_address(business)
    assert address.province == "BC" and address.postal_code[0] == "V"
    assert business.legal_phone is not None
