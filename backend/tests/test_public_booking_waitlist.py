from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.messaging import Delivery
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
from tests.conftest import BIZ, Factory, FakeJobs
from tests.helpers import key, queued_subjects

SLUG = "birchbark"
CLASS = "Puppy Socialization (group)"
TUESDAY = "2026-12-01"
OPENING = "2026-12-01T16:00:00Z"
SIGNED_UP = datetime(2026, 10, 1, 9, tzinfo=UTC)


async def _session(db: AsyncSession, *, taken: int = 2, capacity: int = 2) -> str:
    starts = datetime.fromisoformat(OPENING)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id="st_owner",
        starts_at=starts,
        ends_at=starts + timedelta(hours=1),
        capacity=capacity,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    for order, client in enumerate(["cl_amelie", "cl_marcus", "cl_yuki"][:taken]):
        await _booking(db, slot.id, client, order=order)
    return slot.id


async def _booking(
    db: AsyncSession,
    slot_id: str,
    client_id: str,
    status: BookingStatus = "confirmed",
    *,
    order: int = 0,
) -> Booking:
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot_id,
        starts_at=datetime.fromisoformat(OPENING),
        staff_id="st_owner",
        client_id=client_id,
        status=status,
        source="manual",
        manage_token=f"tok-{new_id('booking')}",
        confirmed_at=SIGNED_UP if status == "confirmed" else None,
        created_at=SIGNED_UP + timedelta(minutes=order),
    )
    db.add(booking)
    await db.flush()
    return booking


def _body(name: str = "Wait Lister", **extra: object) -> dict[str, object]:
    return {
        "item_id": "it_puppy",
        "staff_id": "st_owner",
        "starts_at": OPENING,
        "client": {"name": name, "email": f"{name.split()[0].lower()}@clients.test"},
        **extra,
    }


async def _join(api: httpx.AsyncClient, name: str = "Wait Lister") -> dict[str, object]:
    res = await api.post(f"/book/{SLUG}/waitlist", json=_body(name), headers=key())
    assert res.status_code == 200, res.text
    body: dict[str, object] = res.json()
    return body


async def test_a_full_class_is_offered_as_a_waitlist_time(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _session(db)
    params = {"item_id": "it_puppy", "staff_id": "st_owner"}
    slots = (await api.get(f"/book/{SLUG}/slots", params={**params, "date": TUESDAY})).json()
    [full] = [s for s in slots["slots"] if s["starts_at"].startswith("2026-12-01T16:00")]
    assert full["waitlist"] is True and full["staff_id"] == "st_owner"
    assert not any(s["waitlist"] for s in slots["slots"] if s is not full)
    days = await api.get(f"/book/{SLUG}/days", params={**params, "from": TUESDAY, "days": 1})
    assert days.json()["days"][0]["waitlist"] == 1
    booked = await api.post(f"/book/{SLUG}", json=_body(), headers=key())
    assert booked.status_code == 409 and booked.json()["error"] == "slot_unavailable"


async def test_joining_the_waitlist_online_puts_the_client_in_line(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot_id = await _session(db)
    first = await _join(api, "Wait Lister")
    assert first["status"] == "waitlisted" and first["waitlist_position"] == 1
    assert first["manage_token"] and first["deposit_client_secret"] is None
    second = await _join(api, "Next Lister")
    assert second["waitlist_position"] == 2
    row = await db.get(Booking, str(first["booking_id"]))
    assert row is not None and row.slot_id == slot_id and row.source == "online"
    assert row.confirmed_at is None
    assert await queued_subjects(db, f"booking:{first['booking_id']}") == [
        f"You're on the waitlist for {CLASS}"
    ]
    view = (await api.get(f"/manage/{first['manage_token']}")).json()
    assert view["status"] == "waitlisted" and view["waitlist_position"] == 1
    assert view["can_cancel"] is True and view["can_move"] is False


async def test_a_seat_canceled_online_goes_to_the_first_person_waiting(
    api: httpx.AsyncClient, db: AsyncSession, jobs: FakeJobs
) -> None:
    slot_id = await _session(db)
    leaving = await db.scalar(select(Booking.manage_token).where(Booking.slot_id == slot_id))
    waiting = await _join(api)
    later = await _join(api, "Late Lister")
    jobs.work, jobs.enqueued = False, []
    res = await api.post(f"/manage/{leaving}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert jobs.enqueued == []  # the seat notice waits for the scheduled sweep
    seated = (await api.get(f"/manage/{waiting['manage_token']}")).json()
    assert seated["status"] == "confirmed" and seated["waitlist_position"] is None
    assert await queued_subjects(db, f"seat:{slot_id}:{waiting['booking_id']}") == [
        f"A seat opened up in {CLASS}"
    ]
    notices = await db.scalars(
        select(Delivery.state).where(Delivery.key.startswith(f"seat:{slot_id}:"))
    )
    assert set(notices) == {"queued"}
    still = (await api.get(f"/manage/{later['manage_token']}")).json()
    assert still["status"] == "waitlisted" and still["waitlist_position"] == 1
    slots = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_puppy", "staff_id": "st_owner", "date": TUESDAY},
    )
    [again] = [s for s in slots.json()["slots"] if s["starts_at"].startswith("2026-12-01T16:00")]
    assert again["waitlist"] is True


async def test_leaving_the_waitlist_online_seats_nobody(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot_id = await _session(db)
    first = await _join(api)
    second = await _join(api, "Next Lister")
    res = await api.post(f"/manage/{first['manage_token']}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert res.json()["deposit"] == "none"
    view = (await api.get(f"/manage/{second['manage_token']}")).json()
    assert view["status"] == "waitlisted" and view["waitlist_position"] == 1
    seats = await db.scalar(
        select(func.count(Booking.id)).where(
            Booking.slot_id == slot_id, Booking.status == "confirmed"
        )
    )
    assert seats == 2


async def test_the_waitlist_is_only_for_a_full_class_session(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    service = await api.post(
        f"/book/{SLUG}/waitlist", json=_body(item_id="it_groom_sm"), headers=key()
    )
    assert service.status_code == 422 and service.json()["error"] == "no_waitlist"
    nothing = await api.post(f"/book/{SLUG}/waitlist", json=_body(), headers=key())
    assert nothing.status_code == 409 and nothing.json()["error"] == "slot_unavailable"
    await _session(db, taken=1)
    room = await api.post(f"/book/{SLUG}/waitlist", json=_body(), headers=key())
    assert room.status_code == 409 and room.json()["error"] == "class_open"
    missing = await api.post("/book/no-such-studio/waitlist", json=_body(), headers=key())
    assert missing.status_code == 404
    unknown = await api.post(
        f"/book/{SLUG}/waitlist", json=_body(item_id="it_missing"), headers=key()
    )
    assert unknown.status_code == 404


async def test_a_client_already_in_the_class_cannot_join_its_waitlist(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _session(db)
    await _join(api)
    again = await api.post(f"/book/{SLUG}/waitlist", json=_body(), headers=key())
    assert again.status_code == 409, again.text


async def test_another_business_class_cannot_be_joined_through_this_page(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    rival = await factory.business(name="Rival Co")
    item = Item(
        id=new_id("item"),
        business_id=rival.id,
        kind="class",
        name="Rival class",
        price_cents=3000,
        currency="CAD",
        duration_min=60,
        capacity=2,
        online_bookable=True,
    )
    db.add(item)
    await db.flush()
    res = await api.post(f"/book/{SLUG}/waitlist", json=_body(item_id=item.id), headers=key())
    assert res.status_code == 404


async def test_joining_with_the_same_key_replays_the_first_answer(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot_id = await _session(db)
    headers = {"Idempotency-Key": "waitlist-join-once"}
    first = await api.post(f"/book/{SLUG}/waitlist", json=_body(), headers=headers)
    again = await api.post(f"/book/{SLUG}/waitlist", json=_body(), headers=headers)
    assert again.status_code == 200, again.text
    assert again.json()["booking_id"] == first.json()["booking_id"]
    waiting = await db.scalar(
        select(func.count(Booking.id)).where(
            Booking.slot_id == slot_id, Booking.status == "waitlisted"
        )
    )
    assert waiting == 1
    other = await api.post(f"/book/{SLUG}/waitlist", json=_body("Other Name"), headers=headers)
    assert other.status_code == 422 and other.json()["error"] == "idempotency_key_reused"
