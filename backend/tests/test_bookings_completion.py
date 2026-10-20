from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
from clientbridge.services.bookings import run_complete_past_bookings
from clientbridge.services.notifications import Notifier
from clientbridge.services.reviews import run_review_requests
from tests.conftest import (
    BIZ,
    Factory,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)
from tests.google_business import configure_google_review_profile
from tests.helpers import enable_payments, key, ok, settle

ST_OWNER = "st_owner"
CLIENT = "cl_amelie"
# far in the past so the job sees only the visits each test plants (the seed is ~now)
VISIT = datetime(2020, 1, 1, 18, tzinfo=UTC)
NEXT_MORNING = datetime(2020, 1, 2, 12, tzinfo=UTC)
AHEAD = datetime(2027, 6, 1, 18, tzinfo=UTC)


async def _visit(
    db: AsyncSession,
    *,
    status: BookingStatus = "confirmed",
    starts_at: datetime = VISIT,
    business_id: str = BIZ,
    staff_id: str = ST_OWNER,
    client_id: str = CLIENT,
    item_id: str = "it_groom_lg",
    slot: Slot | None = None,
) -> Booking:
    if slot is None:
        slot = Slot(
            id=new_id("slot"),
            business_id=business_id,
            item_id=item_id,
            staff_id=staff_id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=1),
            capacity=1,
            status="scheduled",
        )
        db.add(slot)
        await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=slot.business_id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=slot.staff_id,
        client_id=client_id,
        status=status,
        source="manual",
        confirmed_at=slot.starts_at if status == "confirmed" else None,
    )
    db.add(booking)
    await db.flush()
    return booking


async def _run(db: AsyncSession, now: datetime = NEXT_MORNING) -> int:
    return await run_complete_past_bookings(db, FakePaymentGateway(), now)


async def _fresh(db: AsyncSession, booking: Booking) -> tuple[Booking, Slot]:
    row = await db.get(Booking, booking.id, populate_existing=True)
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert row is not None and slot is not None
    return row, slot


async def _audits(db: AsyncSession, booking_id: str) -> list[Audit]:
    rows = await db.scalars(select(Audit).where(Audit.entity_id == booking_id))
    return list(rows)


async def _halifax(db: AsyncSession, factory: Factory) -> tuple[str, str, str, str]:
    business = await factory.business(name="Harbour Grooming", province="NS")
    business.timezone = "America/Halifax"
    owner = await factory.staff(business=business, user=await factory.user())
    client = await factory.client(business=business)
    item = Item(
        id=new_id("item"),
        business_id=business.id,
        kind="service",
        name="Harbour bath",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    return business.id, owner.id, client.id, item.id


async def test_a_visit_left_open_yesterday_is_completed_and_asked_for_a_review(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    visit = await _visit(db)
    assert await _run(db) == 1
    booking, slot = await _fresh(db, visit)
    assert booking.status == "completed" and booking.completed_at == NEXT_MORNING
    assert slot.status == "completed"
    [audit] = await _audits(db, visit.id)
    assert audit.action == "booking.auto_complete" and audit.performed_by is None
    # review requests go out at 8 a.m. in the business's zone (Vancouver, UTC-8 in January)
    business = await db.get(Business, visit.business_id)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    eight_am = NEXT_MORNING.replace(hour=16)
    assert await run_review_requests(db, Notifier(email, sms, push), eight_am) == 1
    review = await db.scalar(select(ReviewRequest).where(ReviewRequest.booking_id == visit.id))
    assert review is not None and review.requested_at == eight_am


async def test_a_pending_visit_never_approved_is_canceled_without_a_notice(
    db: AsyncSession, email: FakeEmailSender
) -> None:
    visit = await _visit(db, status="pending")
    assert await _run(db) == 1
    booking, slot = await _fresh(db, visit)
    assert booking.status == "canceled" and booking.canceled_at == NEXT_MORNING
    assert slot.status == "canceled"
    [audit] = await _audits(db, visit.id)
    assert audit.action == "booking.auto_cancel"
    assert email.sent == []


async def test_a_class_completes_once_its_last_open_booking_closes(db: AsyncSession) -> None:
    first = await _visit(db, item_id="it_puppy")
    slot = await db.get(Slot, first.slot_id)
    assert slot is not None
    slot.capacity = 4
    second = await _visit(db, slot=slot, client_id="cl_marcus", status="pending")
    waiting = await _visit(db, slot=slot, client_id="cl_yuki", status="waitlisted")
    assert await _run(db) == 3
    assert (await _fresh(db, first))[0].status == "completed"
    assert (await _fresh(db, second))[0].status == "canceled"
    assert (await _fresh(db, waiting))[0].status == "canceled"
    assert (await _fresh(db, first))[1].status == "completed"


async def test_a_visit_from_today_waits_for_local_midnight(db: AsyncSession) -> None:
    visit = await _visit(db)
    # 21:00 the same evening in Vancouver
    assert await _run(db, datetime(2020, 1, 2, 5, tzinfo=UTC)) == 0
    assert (await _fresh(db, visit))[0].status == "confirmed"


async def test_one_run_closes_each_business_at_its_own_midnight(
    db: AsyncSession, factory: Factory
) -> None:
    vancouver = await _visit(db)
    biz, staff, client, item = await _halifax(db, factory)
    halifax = await _visit(db, business_id=biz, staff_id=staff, client_id=client, item_id=item)
    # 21:00 in Vancouver, already 01:00 the next day in Halifax
    assert await _run(db, datetime(2020, 1, 2, 5, tzinfo=UTC)) == 1
    assert (await _fresh(db, vancouver))[0].status == "confirmed"
    assert (await _fresh(db, halifax))[0].status == "completed"
    [audit] = await _audits(db, halifax.id)
    assert audit.business_id == biz


async def test_running_twice_changes_nothing_the_second_time(db: AsyncSession) -> None:
    visit = await _visit(db)
    missed = await _visit(db, starts_at=VISIT + timedelta(hours=2), status="no_show")
    assert await _run(db) == 1
    assert await _run(db) == 0
    assert len(await _audits(db, visit.id)) == 1
    assert (await _fresh(db, missed))[0].status == "no_show"
    assert await _audits(db, missed.id) == []


async def test_a_business_that_turned_auto_completion_off_is_left_alone(
    db: AsyncSession,
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.booking_policy = {**business.booking_policy, "auto_complete": False}
    visit = await _visit(db)
    assert await _run(db) == 0
    assert (await _fresh(db, visit))[0].status == "confirmed"


async def test_no_show_and_complete_wait_for_the_visit_to_start(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ahead = await _visit(db, starts_at=AHEAD)
    for status in ("no_show", "completed"):
        res = await as_owner.patch(f"/v1/bookings/{ahead.id}", json={"status": status})
        assert res.status_code == 409, res.text
        assert res.json()["error"] == "visit_not_started"
    assert (await _fresh(db, ahead))[0].status == "confirmed"
    started = await _visit(db)
    res = await as_owner.patch(f"/v1/bookings/{started.id}", json={"status": "completed"})
    assert res.status_code == 200, res.text


async def test_the_roster_refuses_a_no_show_before_the_class_starts(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ahead = await _visit(db, item_id="it_puppy", starts_at=AHEAD)
    slot = await db.get(Slot, ahead.slot_id)
    assert slot is not None
    slot.capacity = 4
    await db.flush()
    url = f"/v1/classes/{slot.id}/roster/{ahead.id}"
    res = await as_owner.patch(url, json={"action": "no_show"})
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "visit_not_started"
    count = await db.scalar(select(func.count(Audit.id)).where(Audit.entity_id == ahead.id))
    assert count == 0


async def test_an_unapproved_visit_keeps_a_paid_deposit_for_staff(db: AsyncSession) -> None:
    paid = await _visit(db, status="pending")
    paid.deposit_status = "collected"
    unpaid = await _visit(db, status="pending", starts_at=VISIT + timedelta(hours=2))
    unpaid.deposit_status = "pending"
    await db.flush()
    assert await _run(db) == 1
    assert (await _fresh(db, paid))[0].status == "pending"
    canceled, _ = await _fresh(db, unpaid)
    assert (canceled.status, canceled.deposit_status) == ("canceled", "none")


pytestmark = pytest.mark.usefixtures("google_review_provider")


async def _sell(api: httpx.AsyncClient, booking: Booking) -> str:
    line = {"description": "Visit", "unit_amount_cents": 5000, "booking_id": booking.id}
    sale = ok(
        await api.post("/v1/orders", json={"client_id": booking.client_id, "lines": [line]}), 201
    ).json()
    order_id: str = sale["id"]
    return order_id


async def _cash(api: httpx.AsyncClient, order_id: str) -> None:
    ok(await api.post(f"/v1/orders/{order_id}/cash", json={"tendered_cents": 10000}, headers=key()))


async def test_paying_for_a_started_visit_completes_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db)
    await _cash(as_owner, await _sell(as_owner, booking))
    row, slot = await _fresh(db, booking)
    assert (row.status, slot.status) == ("completed", "completed")
    assert row.completed_at is not None and row.charged_at is not None
    assert [a.action for a in await _audits(db, booking.id)] == ["booking.complete_on_payment"]


async def test_paying_ahead_leaves_the_visit_open(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db, starts_at=AHEAD)
    await _cash(as_owner, await _sell(as_owner, booking))
    row, slot = await _fresh(db, booking)
    assert (row.status, slot.status) == ("confirmed", "scheduled")
    assert row.charged_at is not None and row.completed_at is None


async def test_an_unapproved_visit_stays_pending_when_paid(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db, status="pending")
    await _cash(as_owner, await _sell(as_owner, booking))
    row, _ = await _fresh(db, booking)
    assert row.status == "pending"


async def test_a_refund_keeps_the_paid_visit_completed_and_a_replay_changes_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    booking = await _visit(db)
    order_id = await _sell(as_owner, booking)
    pay = ok(await as_owner.post(f"/v1/orders/{order_id}/pay", json={})).json()
    await settle(as_owner, db, pay["payment_id"], "evt_paid_visit")
    await settle(as_owner, db, pay["payment_id"], "evt_paid_visit")
    assert len(await _audits(db, booking.id)) == 1
    ok(await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund", json={}, headers=key()))
    row, _ = await _fresh(db, booking)
    assert row.status == "completed" and row.charged_at is None


async def _invoice(api: httpx.AsyncClient, booking: Booking) -> str:
    line = {"description": "Visit", "unit_amount_cents": 5000, "booking_id": booking.id}
    body = {"client_id": booking.client_id, "lines": [line], "send": True}
    invoice_id: str = ok(await api.post("/v1/invoices", json=body), 201).json()["id"]
    return invoice_id


async def test_sending_an_invoice_for_a_started_visit_completes_and_links_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    started, ahead = await _visit(db), await _visit(db, starts_at=AHEAD)
    invoice_id = await _invoice(as_owner, started)
    await _invoice(as_owner, ahead)
    row, slot = await _fresh(db, started)
    assert (row.status, row.invoice_id, slot.status) == ("completed", invoice_id, "completed")
    assert [a.action for a in await _audits(db, started.id)] == ["booking.complete_on_invoice"]
    later, _ = await _fresh(db, ahead)
    assert later.status == "confirmed" and later.invoice_id is not None


async def test_a_visit_is_billed_on_a_sale_or_an_invoice_not_both(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    on_sale = await _visit(db)
    await _sell(as_owner, on_sale)
    line = {"description": "Visit", "unit_amount_cents": 5000, "booking_id": on_sale.id}
    body = {"client_id": on_sale.client_id, "lines": [line], "send": True}
    assert (await as_owner.post("/v1/invoices", json=body)).status_code == 409
    invoiced = await _visit(db, starts_at=VISIT + timedelta(hours=3))
    await _invoice(as_owner, invoiced)
    line = {"description": "Visit", "unit_amount_cents": 5000, "booking_id": invoiced.id}
    sale = await as_owner.post(
        "/v1/orders", json={"client_id": invoiced.client_id, "lines": [line]}
    )
    assert sale.status_code == 409
