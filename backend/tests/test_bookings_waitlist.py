import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.messaging import Delivery
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, BookingStatus, Recurrence, Slot
from clientbridge.schemas.bookings import BookingPatch
from clientbridge.services.bookings import (
    BookingService,
    booked_count,
    run_complete_past_bookings,
    run_reap_unpaid_bookings,
)
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    OWNER_USER,
    Factory,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)
from tests.helpers import delete_bookings, queued_subjects

CLASS = "Puppy Socialization (group)"
SESSION = datetime(2027, 3, 6, 18, tzinfo=UTC)
SIGNED_UP = datetime(2026, 10, 1, 9, tzinfo=UTC)
OWNER = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")


async def _session(
    db: AsyncSession,
    *,
    capacity: int = 2,
    starts_at: datetime = SESSION,
    staff_id: str = "st_owner",
    business_id: str = BIZ,
    item_id: str = "it_puppy",
) -> Slot:
    slot = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        capacity=capacity,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    return slot


async def _seat(
    db: AsyncSession,
    slot: Slot,
    client_id: str,
    status: BookingStatus = "confirmed",
    *,
    order: int = 0,
    booking_id: str | None = None,
    source: str = "manual",
    deposit_cents: int = 0,
) -> Booking:
    booking = Booking(
        id=booking_id or new_id("booking"),
        business_id=slot.business_id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=slot.staff_id,
        client_id=client_id,
        status=status,
        source=source,
        price_cents=3000,
        deposit_amount_cents=deposit_cents,
        deposit_status="pending" if deposit_cents > 0 else "none",
        confirmed_at=SIGNED_UP if status == "confirmed" else None,
        created_at=SIGNED_UP + timedelta(minutes=order),
    )
    db.add(booking)
    await db.flush()
    return booking


async def _full(db: AsyncSession) -> tuple[Slot, Booking, Booking, Booking, Booking]:
    slot = await _session(db)
    first = await _seat(db, slot, "cl_amelie", order=0)
    second = await _seat(db, slot, "cl_marcus", order=1)
    # ids run against sign-up order, so the line follows who signed up first
    early = await _seat(db, slot, "cl_yuki", "waitlisted", order=2, booking_id="bk_zz_early")
    late = await _seat(db, slot, "cl_liam", "waitlisted", order=3, booking_id="bk_aa_late")
    return slot, first, second, early, late


async def _fresh(db: AsyncSession, booking: Booking) -> Booking:
    row = await db.get(Booking, booking.id, populate_existing=True)
    assert row is not None
    return row


async def _seat_audits(db: AsyncSession, booking_id: str) -> list[Audit]:
    rows = await db.scalars(
        select(Audit).where(Audit.entity_id == booking_id, Audit.action == "class.seat_opened")
    )
    return list(rows)


async def test_a_canceled_seat_goes_to_the_first_person_waiting(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot, first, _, early, late = await _full(db)
    res = await as_owner.patch(f"/v1/bookings/{first.id}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    seated = await _fresh(db, early)
    assert seated.status == "confirmed" and seated.confirmed_at is not None
    assert seated.manage_token is not None
    assert (await _fresh(db, late)).status == "waitlisted"
    assert await booked_count(db, slot.id) == 2
    [audit] = await _seat_audits(db, early.id)
    assert audit.performed_by == OWNER_USER
    subjects = await queued_subjects(db, f"seat:{slot.id}:{early.id}")
    assert len(subjects) == 1
    assert subjects[0].startswith(f"A seat opened up in {CLASS} with")
    assert "so you're booked" in subjects[0]
    assert await queued_subjects(db, f"seat:{slot.id}:{late.id}") == []


async def test_a_seat_freed_once_the_class_started_stays_empty(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot = await _session(db, starts_at=clock.now() - timedelta(minutes=10))
    first = await _seat(db, slot, "cl_amelie")
    second = await _seat(db, slot, "cl_marcus", order=1)
    waiting = await _seat(db, slot, "cl_yuki", "waitlisted", order=2)
    canceled = await as_owner.patch(f"/v1/bookings/{first.id}", json={"status": "canceled"})
    assert canceled.status_code == 200, canceled.text
    missed = await as_owner.patch(
        f"/v1/classes/{slot.id}/roster/{second.id}", json={"action": "no_show"}
    )
    assert missed.status_code == 200, missed.text
    assert (await _fresh(db, waiting)).status == "waitlisted"


async def test_leaving_the_waitlist_seats_nobody(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot, _, _, early, late = await _full(db)
    res = await as_owner.patch(f"/v1/bookings/{early.id}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    assert (await _fresh(db, late)).status == "waitlisted"
    assert await booked_count(db, slot.id) == 2


async def test_canceling_again_seats_nobody_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, first, _, early, late = await _full(db)
    for _ in range(2):
        res = await as_owner.patch(f"/v1/bookings/{first.id}", json={"status": "canceled"})
        assert res.status_code == 200, res.text
    assert (await _fresh(db, late)).status == "waitlisted"
    assert len(await _seat_audits(db, early.id)) == 1


async def test_an_unknown_status_or_another_members_class_is_refused(
    as_owner: httpx.AsyncClient, as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, first, _, early, _ = await _full(db)
    bad = await as_owner.patch(f"/v1/bookings/{first.id}", json={"status": "dance"})
    assert bad.status_code == 422
    theirs = await as_staff.patch(f"/v1/bookings/{first.id}", json={"status": "canceled"})
    assert theirs.status_code == 403
    assert (await _fresh(db, first)).status == "confirmed"
    assert (await _fresh(db, early)).status == "waitlisted"


async def test_another_business_cannot_free_or_take_a_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    rival = await factory.business(name="Rival Co")
    member = await factory.staff(business=rival, user=await factory.user())
    client = await factory.client(business=rival)
    item = Item(
        id=new_id("item"),
        business_id=rival.id,
        kind="class",
        name="Rival class",
        price_cents=3000,
        currency="CAD",
        duration_min=60,
        capacity=2,
    )
    db.add(item)
    await db.flush()
    slot = await _session(db, staff_id=member.id, business_id=rival.id, item_id=item.id)
    seat = await _seat(db, slot, client.id)
    waiting = await _seat(db, slot, client.id, "waitlisted", order=1)
    res = await as_owner.patch(f"/v1/bookings/{seat.id}", json={"status": "canceled"})
    assert res.status_code == 404
    promote = await as_owner.patch(
        f"/v1/classes/{slot.id}/roster/{waiting.id}", json={"action": "promote"}
    )
    assert promote.status_code == 404
    assert (await _fresh(db, waiting)).status == "waitlisted"


async def test_a_waitlist_keeps_an_open_seat_from_new_bookings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot = await _session(db, capacity=3)
    slot_id = slot.id
    await _seat(db, slot, "cl_amelie")
    await _seat(db, slot, "cl_marcus", order=1)
    await _seat(db, slot, "cl_yuki", "waitlisted", order=2)
    booked = await as_owner.post(
        "/v1/bookings",
        json={
            "item_id": "it_puppy",
            "staff_id": "st_owner",
            "client_id": "cl_liam",
            "starts_at": SESSION.isoformat(),
            "notify": False,
        },
    )
    assert booked.status_code == 409, booked.text
    assert booked.json()["error"] == "class_full"
    added = await as_owner.post(f"/v1/classes/{slot_id}/roster", json={"client_id": "cl_liam"})
    assert added.status_code == 201, added.text
    assert added.json()["status"] == "waitlisted" and added.json()["waitlist_position"] == 2


async def test_a_staff_added_seat_gets_a_manage_link_and_a_confirmation(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot = await _session(db)
    url = f"/v1/classes/{slot.id}/roster"
    await _seat(db, slot, "cl_liam")
    seated = (await as_owner.post(url, json={"client_id": "cl_amelie"})).json()
    waiting = (await as_owner.post(url, json={"client_id": "cl_marcus"})).json()
    quiet = (await as_owner.post(url, json={"client_id": "cl_yuki", "notify": False})).json()
    assert [seated["status"], waiting["status"], quiet["status"]] == [
        "confirmed",
        "waitlisted",
        "waitlisted",
    ]
    [confirmed] = await queued_subjects(db, f"booking:{seated['booking_id']}")
    assert confirmed.startswith("You're booked for")
    [waitlisted] = await queued_subjects(db, f"booking:{waiting['booking_id']}")
    assert waitlisted.startswith(f"{CLASS} with")
    assert "you're on the waitlist" in waitlisted
    assert await queued_subjects(db, f"booking:{quiet['booking_id']}") == []
    for body in (seated, waiting, quiet):
        row = await db.get(Booking, str(body["booking_id"]))
        assert row is not None and row.manage_token is not None


async def test_a_staff_added_seat_owes_its_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await db.get(Item, "it_puppy")
    assert item is not None
    item.deposit_type, item.deposit_value = "fixed", 1000
    slot = await _session(db)
    res = await as_owner.post(f"/v1/classes/{slot.id}/roster", json={"client_id": "cl_amelie"})
    assert res.status_code == 201, res.text
    row = await db.get(Booking, str(res.json()["booking_id"]))
    assert row is not None
    assert row.deposit_amount_cents == 1000 and row.deposit_status == "pending"


async def test_adding_with_the_same_key_replays_the_first_answer(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    slot = await _session(db)
    url = f"/v1/classes/{slot.id}/roster"
    headers = {"Idempotency-Key": "roster-add-once"}
    first = await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers)
    sent = len(sms.sent)
    again = await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers)
    assert again.status_code == 201, again.text
    assert again.json()["booking_id"] == first.json()["booking_id"]
    assert len(sms.sent) == sent
    other = await as_owner.post(url, json={"client_id": "cl_marcus"}, headers=headers)
    assert other.status_code == 422 and other.json()["error"] == "idempotency_key_reused"


async def test_canceling_a_series_seats_the_next_person_waiting(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    series = Recurrence(
        id=new_id("recurrence"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id="st_owner",
        client_id="cl_amelie",
        frequency="week",
        interval=1,
        count=1,
        status="active",
    )
    db.add(series)
    await db.flush()
    slot = await _session(db)
    slot.recurrence_id = series.id
    await _seat(db, slot, "cl_amelie")
    await _seat(db, slot, "cl_liam", order=1)
    waiting = await _seat(db, slot, "cl_marcus", "waitlisted", order=2)
    res = await as_owner.post(f"/v1/recurrences/{series.id}/cancel", json={})
    assert res.status_code == 200, res.text
    assert (await _fresh(db, waiting)).status == "confirmed"


async def test_an_unpaid_online_seat_released_by_the_job_goes_to_the_next_in_line(
    db: AsyncSession,
) -> None:
    slot = await _session(db, starts_at=datetime(2030, 1, 3, 18, tzinfo=UTC))
    await _seat(db, slot, "cl_liam")
    unpaid = await _seat(db, slot, "cl_amelie", source="online", deposit_cents=1000)
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            booking_id=unpaid.id,
            kind="deposit",
            amount_cents=1000,
            method="card",
            provider="stripe",
            status="pending",
        )
    )
    waiting = await _seat(db, slot, "cl_marcus", "waitlisted", order=1)
    unpaid.created_at = datetime(2029, 12, 31, tzinfo=UTC)
    notifier = Notifier(FakeEmailSender(), FakeSmsSender(), FakePushSender())
    now = datetime(2030, 1, 1, tzinfo=UTC)
    assert await run_reap_unpaid_bookings(db, FakePaymentGateway(), notifier, now) == 1
    assert (await _fresh(db, unpaid)).status == "canceled"
    assert (await _fresh(db, waiting)).status == "confirmed"
    assert len(await _seat_audits(db, waiting.id)) == 1


async def test_the_overnight_job_closes_a_waitlist_once_the_class_is_over(
    db: AsyncSession,
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.booking_policy = {**business.booking_policy, "auto_complete": False}
    ended = await _session(db, capacity=1, starts_at=datetime(2020, 1, 1, 18, tzinfo=UTC))
    await _seat(db, ended, "cl_amelie")
    waiting = await _seat(db, ended, "cl_marcus", "waitlisted", order=1)
    tonight = await _session(db, capacity=1, starts_at=datetime(2020, 1, 2, 18, tzinfo=UTC))
    await _seat(db, tonight, "cl_amelie")
    later = await _seat(db, tonight, "cl_yuki", "waitlisted", order=1)
    morning = datetime(2020, 1, 2, 12, tzinfo=UTC)
    assert await run_complete_past_bookings(db, FakePaymentGateway(), morning) == 1
    closed = await _fresh(db, waiting)
    assert closed.status == "canceled" and closed.canceled_at == morning
    assert (await _fresh(db, later)).status == "waitlisted"
    [audit] = await db.scalars(
        select(Audit).where(
            Audit.entity_id == waiting.id, Audit.action == "booking.waitlist_closed"
        )
    )
    assert audit.changes == {"reason": "class_full"}
    notice = await db.scalar(
        select(Delivery).where(Delivery.key.startswith(f"waitlist:{waiting.id}:"))
    )
    assert notice is not None
    assert await run_complete_past_bookings(db, FakePaymentGateway(), morning) == 0


async def test_two_cancellations_at_once_seat_the_waiting_client_once(db: AsyncSession) -> None:
    starts = datetime(2027, 4, 21, 18, tzinfo=UTC)
    async with SessionLocal() as setup:
        slot = await _session(setup, starts_at=starts)
        first = await _seat(setup, slot, "cl_amelie")
        second = await _seat(setup, slot, "cl_marcus", order=1)
        waiting = await _seat(setup, slot, "cl_yuki", "waitlisted", order=2)
        slot_id, ids = slot.id, [first.id, second.id, waiting.id]
        await setup.commit()
    ready = asyncio.Barrier(2)

    async def cancel(booking_id: str) -> str:
        async with SessionLocal() as session:
            service = BookingService(session, OWNER, FakePaymentGateway())
            await ready.wait()
            out = await service.patch(booking_id, BookingPatch(status="canceled"))
            return out.status

    try:
        assert await asyncio.gather(cancel(ids[0]), cancel(ids[1])) == [
            "canceled",
            "canceled",
        ]
        async with SessionLocal() as check:
            row = await check.get(Booking, ids[2])
            assert row is not None and row.status == "confirmed"
            assert len(await _seat_audits(check, ids[2])) == 1
            assert await booked_count(check, slot_id) == 1
    finally:
        async with SessionLocal() as cleanup:
            await cleanup.execute(
                delete(Delivery).where(Delivery.key.startswith(f"seat:{slot_id}"))
            )
            await delete_bookings(cleanup, ids)
            await cleanup.commit()
