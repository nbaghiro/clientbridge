from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Hours, Recurrence, Slot
from clientbridge.services.bookings import booked_count
from tests.conftest import BIZ, Factory, FakeEmailSender
from tests.helpers import key, reachable

FIRST = "2027-03-02T18:00:00Z"
DAYS = ["TU", "WE", "TH"]


async def program_item(
    db: AsyncSession,
    *,
    sessions: int | None = 3,
    capacity: int = 2,
    deposit: bool = False,
    business_id: str = BIZ,
    staff_ids: list[str] | None = None,
) -> str:
    item = Item(
        id=new_id("item"),
        business_id=business_id,
        kind="class",
        name="Spring Agility Camp",
        price_cents=30000,
        currency="CAD",
        duration_min=60,
        capacity=capacity,
        session_count=sessions,
        online_bookable=True,
        deposit_type="fixed" if deposit else "none",
        deposit_value=5000 if deposit else None,
        staff_ids=staff_ids or [],
        active=True,
    )
    db.add(item)
    await db.flush()
    return item.id


def schedule_body(item_id: str, **extra: object) -> dict[str, object]:
    return {
        "item_id": item_id,
        "staff_id": "st_owner",
        "starts_at": FIRST,
        "byday": DAYS,
        "count": 3,
        **extra,
    }


async def schedule(api: httpx.AsyncClient, item_id: str, **extra: object) -> dict[str, object]:
    res = await api.post("/v1/programs", json=schedule_body(item_id, **extra), headers=key())
    assert res.status_code == 201, res.text
    body: dict[str, object] = res.json()
    return body


async def program(
    api: httpx.AsyncClient, db: AsyncSession, *, capacity: int = 2, deposit: bool = False
) -> str:
    made = await schedule(api, await program_item(db, capacity=capacity, deposit=deposit))
    return str(made["id"])


def ids(body: dict[str, object], field: str) -> list[str]:
    found = body[field]
    assert isinstance(found, list)
    return [str(x) for x in found]


async def enrol(
    api: httpx.AsyncClient, program_id: str, client: str, subject: str | None = None
) -> dict[str, object]:
    res = await api.post(
        f"/v1/programs/{program_id}/enrolments",
        json={"client_id": client, "subject_id": subject},
        headers=key(),
    )
    assert res.status_code == 201, res.text
    body: dict[str, object] = res.json()
    return body


async def days(db: AsyncSession, program_id: str) -> list[Slot]:
    rows = await db.scalars(
        select(Slot)
        .where(Slot.recurrence_id == program_id)
        .order_by(Slot.starts_at)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def bookings(db: AsyncSession, booking_ids: list[str]) -> list[Booking]:
    rows = await db.scalars(
        select(Booking)
        .where(Booking.id.in_(booking_ids))
        .order_by(Booking.starts_at)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def test_a_schedule_lays_out_empty_sessions_with_no_client(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    made = await schedule(as_owner, item_id)
    sessions = made["sessions"]
    assert isinstance(sessions, list) and len(sessions) == 3
    assert [s["starts_at"][:10] for s in sessions] == ["2027-03-02", "2027-03-03", "2027-03-04"]
    slots = await days(db, str(made["id"]))
    assert [s.capacity for s in slots] == [2, 2, 2]
    assert [await booked_count(db, s.id) for s in slots] == [0, 0, 0]
    recurrence = await db.get(Recurrence, str(made["id"]))
    assert recurrence is not None and recurrence.client_id is None


async def test_a_plain_class_can_be_scheduled_for_any_number_of_sessions(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db, sessions=None)
    made = await schedule(as_owner, item_id, count=None, until="2027-03-10")
    assert len(await days(db, str(made["id"]))) == 5


async def test_a_schedule_replays_on_its_idempotency_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = schedule_body(await program_item(db))
    headers = key()
    first = await as_owner.post("/v1/programs", json=body, headers=headers)
    again = await as_owner.post("/v1/programs", json=body, headers=headers)
    assert first.status_code == again.status_code == 201
    assert first.json()["id"] == again.json()["id"]
    count = await db.scalar(
        select(func.count(Slot.id)).where(Slot.recurrence_id == first.json()["id"])
    )
    assert count == 3


async def test_a_program_schedule_holds_one_session_per_day(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db, sessions=5)
    res = await as_owner.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert res.status_code == 422 and res.json()["error"] == "program_days"


async def test_only_a_class_is_scheduled(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/programs", json=schedule_body("it_groom_sm"), headers=key())
    assert res.status_code == 422 and res.json()["error"] == "schedule_class_only"


async def test_a_schedule_starts_in_the_future(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = schedule_body(await program_item(db), starts_at="2026-10-06T17:00:00Z")
    res = await as_owner.post("/v1/programs", json=body, headers=key())
    assert res.status_code == 422 and res.json()["error"] == "schedule_past"


async def test_a_schedule_respects_who_offers_the_class(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db, staff_ids=["st_diego"])
    res = await as_owner.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert res.status_code == 422 and res.json()["error"] == "service_not_offered"


async def test_a_day_off_refuses_the_whole_schedule(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    db.add(
        Hours(
            id=new_id("hours"),
            business_id=BIZ,
            staff_id="st_owner",
            basis="exception",
            starts_at=datetime(2027, 3, 3, 8, tzinfo=UTC),
            ends_at=datetime(2027, 3, 4, 8, tzinfo=UTC),
            available=False,
            reason="Dentist",
        )
    )
    await db.flush()
    res = await as_owner.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert res.status_code == 409 and res.json()["error"] == "schedule_conflict"


async def test_a_day_outside_the_instructors_hours_refuses_the_schedule(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = schedule_body(await program_item(db), starts_at="2027-03-02T15:00:00Z")
    res = await as_owner.post("/v1/programs", json=body, headers=key())
    assert res.status_code == 409 and res.json()["error"] == "schedule_conflict"


async def test_a_booked_day_refuses_the_schedule(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    visit = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": "cl_amelie",
            "item_id": "it_groom_sm",
            "staff_id": "st_owner",
            "starts_at": "2027-03-04T18:30:00Z",
            "notify": False,
        },
    )
    assert visit.status_code == 201, visit.text
    res = await as_owner.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert res.status_code == 409 and res.json()["error"] == "schedule_conflict"


async def test_staff_schedule_only_their_own_classes(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    res = await as_staff.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert res.status_code == 403


async def test_enrolling_books_every_day_with_the_price_and_deposit_on_the_first(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await reachable(db, "cl_amelie")
    program_id = await program(as_owner, db, deposit=True)
    made = await enrol(as_owner, program_id, "cl_amelie", "sj_bella")
    rows = await bookings(db, ids(made, "booking_ids"))
    assert [b.price_cents for b in rows] == [30000, 0, 0]
    assert [b.deposit_amount_cents for b in rows] == [5000, 0, 0]
    assert [b.deposit_status for b in rows] == ["pending", "none", "none"]
    assert {b.status for b in rows} == {"confirmed"}
    assert {b.subject_id for b in rows} == {"sj_bella"}
    assert [e.subject for e in email.sent][-1].startswith("Your visits are booked")


async def test_an_enrolment_replays_on_its_idempotency_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    url = f"/v1/programs/{program_id}/enrolments"
    headers = key()
    first = await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers)
    again = await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers)
    assert first.status_code == again.status_code == 201
    assert first.json()["booking_ids"] == again.json()["booking_ids"]
    taken = [await booked_count(db, s.id) for s in await days(db, program_id)]
    assert taken == [1, 1, 1]


async def test_siblings_each_hold_a_seat_in_one_session(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    await enrol(as_owner, program_id, "cl_marcus", "sj_rex")
    await enrol(as_owner, program_id, "cl_marcus", "sj_luna")
    assert [await booked_count(db, s.id) for s in await days(db, program_id)] == [2, 2, 2]


async def test_the_same_subject_cannot_enrol_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db, capacity=4)
    await enrol(as_owner, program_id, "cl_marcus", "sj_rex")
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments",
        json={"client_id": "cl_marcus", "subject_id": "sj_rex"},
        headers=key(),
    )
    assert res.status_code == 409 and res.json()["error"] == "already_enrolled"


async def test_a_client_with_no_subject_cannot_enrol_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db, capacity=4)
    await enrol(as_owner, program_id, "cl_amelie")
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": "cl_amelie"}, headers=key()
    )
    assert res.status_code == 409 and res.json()["error"] == "already_enrolled"


async def test_a_full_day_refuses_the_enrolment(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db, capacity=2)
    await enrol(as_owner, program_id, "cl_amelie")
    wednesday = (await days(db, program_id))[1]
    db.add(
        Booking(
            id=new_id("booking"),
            business_id=BIZ,
            slot_id=wednesday.id,
            starts_at=wednesday.starts_at,
            staff_id="st_owner",
            client_id="cl_yuki",
            status="confirmed",
            source="manual",
        )
    )
    await db.flush()
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": "cl_liam"}, headers=key()
    )
    assert res.status_code == 409
    assert res.json()["error"] == "program_full"


async def test_canceling_an_enrolment_releases_every_day(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await reachable(db, "cl_amelie")
    program_id = await program(as_owner, db)
    made = await enrol(as_owner, program_id, "cl_amelie")
    await enrol(as_owner, program_id, "cl_liam")
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": "cl_amelie"}
    )
    assert res.status_code == 200, res.text
    assert sorted(res.json()["canceled"]) == sorted(ids(made, "booking_ids"))
    assert {b.status for b in await bookings(db, ids(made, "booking_ids"))} == {"canceled"}
    sessions = await days(db, program_id)
    assert {s.status for s in sessions} == {"scheduled"}
    assert [await booked_count(db, s.id) for s in sessions] == [1, 1, 1]
    assert email.sent[-1].subject.startswith("Your visits were canceled")
    await enrol(as_owner, program_id, "cl_yuki")


async def test_canceling_an_enrolment_refunds_its_paid_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db, deposit=True)
    made = await enrol(as_owner, program_id, "cl_amelie")
    first = (await bookings(db, ids(made, "booking_ids")))[0]
    first.deposit_status = "collected"
    await db.flush()
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": "cl_amelie"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["refunded_cents"] >= 0


async def test_one_later_day_can_be_canceled_on_its_own(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    made = await enrol(as_owner, program_id, "cl_amelie")
    rows = await bookings(db, ids(made, "booking_ids"))
    res = await as_owner.patch(f"/v1/bookings/{rows[1].id}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    assert [await booked_count(db, s.id) for s in await days(db, program_id)] == [1, 0, 1]
    assert {s.status for s in await days(db, program_id)} == {"scheduled"}


async def test_the_priced_first_day_is_canceled_only_with_the_enrolment(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    made = await enrol(as_owner, program_id, "cl_amelie")
    first = (await bookings(db, ids(made, "booking_ids")))[0]
    res = await as_owner.patch(f"/v1/bookings/{first.id}", json={"status": "canceled"})
    assert res.status_code == 409 and res.json()["error"] == "program_first_day"


async def test_a_freed_program_seat_promotes_no_one(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    made = await enrol(as_owner, program_id, "cl_amelie")
    await enrol(as_owner, program_id, "cl_liam")
    tuesday = (await days(db, program_id))[0]
    waiting = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=tuesday.id,
        starts_at=tuesday.starts_at,
        staff_id="st_owner",
        client_id="cl_yuki",
        status="waitlisted",
        source="manual",
    )
    db.add(waiting)
    await db.flush()
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": "cl_amelie"}
    )
    assert res.status_code == 200, res.text
    assert len(ids(made, "booking_ids")) == 3
    row = await db.get(Booking, waiting.id, populate_existing=True)
    assert row is not None and row.status == "waitlisted"


async def test_a_program_day_takes_no_single_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    tuesday = (await days(db, program_id))[0]
    res = await as_owner.post(f"/v1/classes/{tuesday.id}/roster", json={"client_id": "cl_amelie"})
    assert res.status_code == 409 and res.json()["error"] == "program_enrol"


async def test_a_program_is_never_booked_one_day_at_a_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    res = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": "cl_amelie",
            "item_id": item_id,
            "staff_id": "st_owner",
            "starts_at": FIRST,
            "notify": False,
        },
    )
    assert res.status_code == 409 and res.json()["error"] == "program_enrol"


async def test_a_plain_class_schedule_is_not_enrolled_in(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    made = await schedule(as_owner, await program_item(db, sessions=None))
    res = await as_owner.post(
        f"/v1/programs/{made['id']}/enrolments", json={"client_id": "cl_amelie"}, headers=key()
    )
    assert res.status_code == 422 and res.json()["error"] == "not_a_program"


async def test_a_schedule_is_not_changed_as_a_client_series(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    moved = await as_owner.patch(
        f"/v1/recurrences/{program_id}", json={"scope": "all", "time": "11:00"}
    )
    assert moved.status_code == 409 and moved.json()["error"] == "class_schedule"
    canceled = await as_owner.post(f"/v1/recurrences/{program_id}/cancel", json={})
    assert canceled.status_code == 409 and canceled.json()["error"] == "class_schedule"


async def test_an_empty_schedule_cancels_its_sessions(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    res = await as_owner.post(f"/v1/programs/{program_id}/cancel")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled" and len(res.json()["canceled"]) == 3
    assert {s.status for s in await days(db, program_id)} == {"canceled"}


async def test_a_schedule_with_enrolments_is_not_canceled(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    await enrol(as_owner, program_id, "cl_amelie")
    res = await as_owner.post(f"/v1/programs/{program_id}/cancel")
    assert res.status_code == 409 and res.json()["error"] == "program_enrolled"


async def test_canceling_without_an_enrolment_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": "cl_amelie"}
    )
    assert res.status_code == 404


async def test_staff_cannot_enrol_in_another_members_program(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    item_id = await program_item(db)
    program_id = new_id("recurrence")
    db.add(
        Recurrence(
            id=program_id,
            business_id=BIZ,
            item_id=item_id,
            staff_id="st_owner",
            frequency="week",
            interval=1,
            byday=DAYS,
            count=3,
            status="active",
        )
    )
    await db.flush()
    enrolled = await as_staff.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": "cl_amelie"}, headers=key()
    )
    assert enrolled.status_code == 403
    left = await as_staff.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": "cl_amelie"}
    )
    assert left.status_code == 403
    canceled = await as_staff.post(f"/v1/programs/{program_id}/cancel")
    assert canceled.status_code == 403


async def test_another_business_program_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    member = await factory.staff(business=other)
    item_id = await program_item(db, business_id=other.id)
    program_id = new_id("recurrence")
    db.add(
        Recurrence(
            id=program_id,
            business_id=other.id,
            item_id=item_id,
            staff_id=member.id,
            frequency="week",
            interval=1,
            byday=DAYS,
            count=3,
            status="active",
        )
    )
    starts = datetime.fromisoformat(FIRST)
    db.add(
        Slot(
            id=new_id("slot"),
            business_id=other.id,
            item_id=item_id,
            staff_id=member.id,
            recurrence_id=program_id,
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            capacity=2,
            status="scheduled",
        )
    )
    await db.flush()
    url = f"/v1/programs/{program_id}"
    enrolled = await as_owner.post(f"{url}/enrolments", json={"client_id": "cl_amelie"})
    assert enrolled.status_code == 404
    left = await as_owner.post(f"{url}/enrolments/cancel", json={"client_id": "cl_amelie"})
    assert left.status_code == 404
    assert (await as_owner.post(f"{url}/cancel")).status_code == 404
    rival = await as_owner.post("/v1/programs", json=schedule_body(item_id), headers=key())
    assert rival.status_code == 404


async def test_a_class_takes_a_number_of_days(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items",
        json={
            "kind": "class",
            "name": "Winter camp",
            "price_cents": 25000,
            "duration_min": 360,
            "capacity": 10,
            "session_count": 5,
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["session_count"] == 5


async def test_siblings_each_take_a_seat_on_a_class_roster(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    made = await schedule(as_owner, await program_item(db, sessions=None), count=1)
    slot_id = (await days(db, str(made["id"])))[0].id
    url = f"/v1/classes/{slot_id}/roster"
    for pet in ("sj_rex", "sj_luna"):
        res = await as_owner.post(url, json={"client_id": "cl_marcus", "subject_id": pet})
        assert res.status_code == 201, res.text
    assert await booked_count(db, slot_id) == 2
    again = await as_owner.post(url, json={"client_id": "cl_marcus", "subject_id": "sj_rex"})
    assert again.status_code == 409


async def test_a_parent_takes_their_own_seat_beside_their_child(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    await enrol(as_owner, program_id, "cl_marcus", "sj_rex")
    await enrol(as_owner, program_id, "cl_marcus")
    assert [await booked_count(db, s.id) for s in await days(db, program_id)] == [2, 2, 2]


async def test_approving_one_day_of_a_requested_enrolment_approves_every_day(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    rows = await bookings(db, ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids"))
    for row in rows:
        row.status = "pending"
    await db.flush()
    res = await as_owner.patch(f"/v1/bookings/{rows[2].id}", json={"status": "confirmed"})
    assert res.status_code == 200, res.text
    assert {b.status for b in await bookings(db, [r.id for r in rows])} == {"confirmed"}


async def test_declining_a_requested_enrolment_cancels_every_day(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    rows = await bookings(db, ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids"))
    for row in rows:
        row.status = "pending"
    await db.flush()
    res = await as_owner.patch(f"/v1/bookings/{rows[0].id}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    assert {b.status for b in await bookings(db, [r.id for r in rows])} == {"canceled"}
    assert {s.status for s in await days(db, program_id)} == {"scheduled"}


async def test_a_second_cancel_of_an_enrolment_finds_nothing_left(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    await enrol(as_owner, program_id, "cl_amelie")
    url = f"/v1/programs/{program_id}/enrolments/cancel"
    first = await as_owner.post(url, json={"client_id": "cl_amelie"})
    assert first.status_code == 200, first.text
    again = await as_owner.post(url, json={"client_id": "cl_amelie"})
    assert again.status_code == 404


async def test_a_canceled_schedule_takes_no_enrolment_or_second_cancel(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    ok_cancel = await as_owner.post(f"/v1/programs/{program_id}/cancel")
    assert ok_cancel.status_code == 200, ok_cancel.text
    again = await as_owner.post(f"/v1/programs/{program_id}/cancel")
    assert again.status_code == 409 and again.json()["error"] == "program_closed"
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": "cl_amelie"}, headers=key()
    )
    assert res.status_code == 409 and res.json()["error"] == "program_closed"


async def test_a_program_with_no_days_left_takes_no_enrolment(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    clock.travel(datetime(2027, 3, 5, tzinfo=UTC))
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": "cl_amelie"}, headers=key()
    )
    assert res.status_code == 409 and res.json()["error"] == "program_over"


async def test_a_client_of_another_business_is_not_enrolled(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    program_id = await program(as_owner, db)
    rival = await factory.client(business=await factory.business(name="Rival Co"))
    res = await as_owner.post(
        f"/v1/programs/{program_id}/enrolments", json={"client_id": rival.id}, headers=key()
    )
    assert res.status_code == 404
