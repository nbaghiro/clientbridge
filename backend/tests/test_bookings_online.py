import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from tests.conftest import BIZ, Factory


async def test_owner_reads_the_online_booking_settings(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/online-booking")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["slug"] == "birchbark"
    assert body["policy"]["self_service"] is True
    assert any(s["id"] == "it_groom_sm" and s["online_bookable"] for s in body["services"])
    assert all(m["bookable_online"] for m in body["staff"])
    assert body["online_30d"] >= 0


async def test_owner_changes_rules_services_and_team(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch(
        "/v1/online-booking",
        json={
            "policy": {"lead_hours": 12, "step_min": 30, "cancel_cutoff_hours": 48},
            "services": {"it_bath": False},
            "staff": {"st_priya": False},
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["policy"]["lead_hours"] == 12
    business = await db.get(Business, BIZ, populate_existing=True)
    assert business is not None
    assert business.booking_policy["cancel_cutoff_hours"] == 48
    assert business.booking_policy["max_reschedules"] == 2
    item = await db.get(Item, "it_bath", populate_existing=True)
    member = await db.get(Staff, "st_priya", populate_existing=True)
    assert item is not None and not item.online_bookable
    assert member is not None and not member.bookable_online
    back = await as_owner.patch("/v1/online-booking", json={"policy": {"step_min": 0}})
    assert back.json()["policy"]["step_min"] is None
    audit = await db.execute(select(Audit.action).where(Audit.action == "online_booking.update"))
    assert audit.scalars().first() is not None


async def test_owner_chooses_add_ons_per_service(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch(
        "/v1/online-booking/addons",
        json={"offers": [{"id": "it_brush", "addon": True, "addon_for": ["it_cat", "it_cat"]}]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["offers"] == [{"id": "it_brush", "addon": True, "addon_for": ["it_cat"]}]
    item = await db.get(Item, "it_brush", populate_existing=True)
    assert item is not None and item.addon_for == ["it_cat"]


async def test_add_ons_are_products_with_real_services(as_owner: httpx.AsyncClient) -> None:
    not_product = await as_owner.patch(
        "/v1/online-booking/addons", json={"offers": [{"id": "it_bath", "addon": True}]}
    )
    assert not_product.status_code == 404
    bad_service = await as_owner.patch(
        "/v1/online-booking/addons",
        json={"offers": [{"id": "it_brush", "addon": True, "addon_for": ["it_nope"]}]},
    )
    assert bad_service.status_code == 404


async def test_settings_validate(as_owner: httpx.AsyncClient) -> None:
    bad = await as_owner.patch("/v1/online-booking", json={"policy": {"step_min": 20}})
    assert bad.status_code == 422
    unknown = await as_owner.patch("/v1/online-booking", json={"services": {"it_nope": True}})
    assert unknown.status_code == 404
    staff = await as_owner.patch("/v1/online-booking", json={"staff": {"st_nope": True}})
    assert staff.status_code == 404


async def test_staff_cannot_change_online_booking(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/online-booking")).status_code == 403
    assert (
        await as_staff.patch("/v1/online-booking", json={"policy": {"lead_hours": 1}})
    ).status_code == 403
    assert (
        await as_staff.patch(
            "/v1/online-booking/addons", json={"offers": [{"id": "it_brush", "addon": False}]}
        )
    ).status_code == 403


async def test_unauth_cannot_read_online_booking(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/v1/online-booking")).status_code == 401


async def test_another_business_items_are_out_of_reach(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    db.add(Item(id="it_rival", business_id=other.id, kind="product", name="Rival brush"))
    await db.flush()
    res = await as_owner.patch(
        "/v1/online-booking/addons", json={"offers": [{"id": "it_rival", "addon": True}]}
    )
    assert res.status_code == 404


async def test_saving_the_same_settings_twice_is_stable(as_owner: httpx.AsyncClient) -> None:
    body = {"policy": {"max_reschedules": 3}}
    first = await as_owner.patch("/v1/online-booking", json=body)
    again = await as_owner.patch("/v1/online-booking", json=body)
    assert first.json()["policy"] == again.json()["policy"]


async def test_reminder_preview_matches_what_is_sent(as_owner: httpx.AsyncClient) -> None:
    created = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": "cl_amelie",
            "item_id": "it_groom_sm",
            "staff_id": "st_priya",
            "starts_at": "2027-03-01T18:00:00Z",
        },
    )
    bid = created.json()["id"]
    res = await as_owner.get(f"/v1/bookings/{bid}/reminder")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["subject"].startswith("Appointment reminder")
    assert "Change or cancel:" in body["body"]
    assert body["sends_at"].startswith("2027-02-28T18:00")
    assert body["sent_at"] is None
    assert (await as_owner.get("/v1/bookings/bk_missing/reminder")).status_code == 404
