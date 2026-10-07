from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Note, Subject
from clientbridge.models.scheduling import Addon, Booking, Hours
from tests.conftest import BIZ, FakeEmailSender
from tests.helpers import key

SLUG = "birchbark"
TUESDAY = "2026-12-01"
TEN_LOCAL = "2026-12-01T17:00:00Z"  # 10 a.m. in Vancouver (UTC-7)


def _body(starts: str = TEN_LOCAL, staff: str = "st_owner", **extra: object) -> dict[str, object]:
    return {
        "item_id": "it_groom_sm",
        "staff_id": staff,
        "starts_at": starts,
        "client": {"name": "Web Booker", "email": "web@example.com"},
        **extra,
    }


async def _policy(db: AsyncSession, **values: object) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(booking_policy=values))
    await db.flush()


async def test_page_carries_policy_clock_staff_and_offers(api: httpx.AsyncClient) -> None:
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert page["slug"] == SLUG
    assert page["now"] is not None
    assert page["policy"]["cancel_cutoff_hours"] == 24
    service = next(s for s in page["services"] if s["id"] == "it_groom_sm")
    assert service["category"] and service["color"]
    assert "st_owner" in service["staff_ids"]
    assert {a["id"] for a in page["addons"]} == {"it_shampoo", "it_brush"}
    assert page["review_count"] >= 0


async def test_hidden_staff_and_unoffered_products_drop_off_the_page(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Staff).where(Staff.id == "st_priya").values(bookable_online=False))
    await db.execute(update(Item).where(Item.id == "it_brush").values(addon=False))
    await db.flush()
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert "st_priya" not in {s["id"] for s in page["staff"]}
    assert {a["id"] for a in page["addons"]} == {"it_shampoo"}
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_groom_sm", "staff_id": "st_priya", "date": TUESDAY},
    )
    assert res.status_code == 404


async def test_anyone_slots_name_the_person(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots", params={"item_id": "it_groom_sm", "staff_id": "any", "date": TUESDAY}
    )
    assert res.status_code == 200, res.text
    slots = res.json()["slots"]
    assert slots and all(s["staff_id"] for s in slots)


async def test_days_count_openings_and_name_closures(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    db.add(
        Hours(
            id="av_closed_wed",
            business_id=BIZ,
            staff_id=None,
            basis="exception",
            starts_at=datetime(2026, 12, 2, 7, tzinfo=UTC),
            ends_at=datetime(2026, 12, 3, 7, tzinfo=UTC),
            reason="Staff training",
            available=False,
        )
    )
    await db.flush()
    res = await api.get(
        f"/book/{SLUG}/days",
        params={"item_id": "it_groom_sm", "staff_id": "st_owner", "from": TUESDAY, "days": 3},
    )
    assert res.status_code == 200, res.text
    days = res.json()["days"]
    assert [d["date"] for d in days] == ["2026-12-01", "2026-12-02", "2026-12-03"]
    assert days[0]["count"] > 0 and not days[0]["closed"]
    assert days[1] == {"date": "2026-12-02", "count": 0, "closed": True, "reason": "Staff training"}


async def test_lead_time_and_horizon_bound_open_times_and_booking(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _policy(db, lead_hours=48, horizon_days=7)
    far = await api.post(f"/book/{SLUG}", json=_body())
    assert far.status_code == 409
    soon = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (await api.post(f"/book/{SLUG}", json=_body(soon))).status_code == 409
    res = await api.get(
        f"/book/{SLUG}/slots", params={"item_id": "it_groom_sm", "staff_id": "any", "date": TUESDAY}
    )
    assert res.json()["slots"] == []


async def test_booking_keeps_pet_note_and_returns_a_manage_link(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    res = await api.post(
        f"/book/{SLUG}",
        json=_body(staff="any", pet_name=" Biscuit ", note="Nervous with dryers"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["manage_token"] and body["status"] == "confirmed"
    booking = await db.get(Booking, body["booking_id"])
    assert booking is not None and booking.subject_id is not None
    pet = await db.get(Subject, booking.subject_id)
    assert pet is not None and pet.name == "Biscuit"
    note = (await db.execute(select(Note.body).where(Note.parent_id == booking.id))).scalar_one()
    assert note == "Nervous with dryers"
    assert f"/m/{body['manage_token']}" in email.sent[-1].body


async def test_new_clients_wait_for_approval_when_asked(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _policy(db, approve_new_clients=True)
    res = await api.post(f"/book/{SLUG}", json=_body())
    assert res.json()["status"] == "pending"


async def test_addons_must_be_offered_with_the_service(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == "it_brush").values(addon_for=["it_cat"]))
    await db.flush()
    refused = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_brush", "quantity": 1}])
    )
    assert refused.status_code == 404
    ok = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_shampoo", "quantity": 2}])
    )
    assert ok.status_code == 200, ok.text
    rows = await db.execute(
        select(Addon.quantity).where(Addon.booking_id == ok.json()["booking_id"])
    )
    assert rows.scalars().all() == [2]


async def test_booking_replays_on_the_same_key(api: httpx.AsyncClient, db: AsyncSession) -> None:
    headers = key()
    first = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    again = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    assert first.status_code == 200 and again.status_code == 200
    assert first.json()["booking_id"] == again.json()["booking_id"]
    rows = await db.execute(select(Booking.id).where(Booking.source == "online"))
    assert first.json()["booking_id"] in rows.scalars().all()


def _days(**params: str | int) -> dict[str, str | int]:
    return {"item_id": "it_groom_sm", "staff_id": "st_owner", "from": TUESDAY, **params}


async def test_days_refuse_unknown_slug_item_and_staff(api: httpx.AsyncClient) -> None:
    assert (await api.get("/book/no-such-page/days", params=_days())).status_code == 404
    unknown_item = await api.get(f"/book/{SLUG}/days", params=_days(item_id="it_nope"))
    assert unknown_item.status_code == 404
    unknown_staff = await api.get(f"/book/{SLUG}/days", params=_days(staff_id="st_nope"))
    assert unknown_staff.status_code == 404


async def test_days_refuse_a_service_not_bookable_online(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == "it_groom_sm").values(online_bookable=False))
    await db.flush()
    assert (await api.get(f"/book/{SLUG}/days", params=_days())).status_code == 409


async def test_days_validate_the_window(api: httpx.AsyncClient) -> None:
    for days in (0, 15):
        res = await api.get(f"/book/{SLUG}/days", params=_days(days=days))
        assert res.status_code == 422
    no_start = {"item_id": "it_groom_sm", "staff_id": "st_owner"}
    assert (await api.get(f"/book/{SLUG}/days", params=no_start)).status_code == 422


async def test_anyone_is_refused_when_every_member_is_busy(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Staff)
        .where(Staff.business_id == BIZ, Staff.id != "st_owner")
        .values(bookable_online=False)
    )
    await db.flush()
    first = await api.post(f"/book/{SLUG}", json=_body())
    assert first.status_code == 200, first.text
    assert (await api.post(f"/book/{SLUG}", json=_body(staff="any"))).status_code == 409


async def test_an_addon_over_stock_is_refused(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Item).where(Item.id == "it_shampoo").values(track_stock=True, stock_on_hand=1)
    )
    await db.flush()
    res = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_shampoo", "quantity": 2}])
    )
    assert res.status_code == 409


async def test_a_short_idempotency_key_is_refused(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}", json=_body(), headers={"Idempotency-Key": "short"})
    assert res.status_code == 422
