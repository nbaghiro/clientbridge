from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.bookings import run_complete_past_bookings
from tests.conftest import BIZ, Factory, FakePaymentGateway, FakeSmsSender
from tests.helpers import deposit_payment, enable_payments, payment, provider_ref, settle

SLUG = "birchbark"
ST_OWNER = "st_owner"
ST_DIEGO = "st_diego"
LARGE_GROOM = "it_groom_lg"  # $110 with a 25% deposit


async def _request(
    api: httpx.AsyncClient,
    db: AsyncSession,
    *,
    staff: str = ST_OWNER,
    item: str = LARGE_GROOM,
    phone: str = "+16045550271",
) -> str:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(booking_policy={"approve_new_clients": True})
    )
    await db.flush()
    res = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": item,
            "staff_id": staff,
            "starts_at": "2027-03-02T16:00:00Z",
            "client": {"name": "First Timer", "phone": phone},
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending"
    return str(res.json()["booking_id"])


async def _paid_request(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    await enable_payments(db)
    booking_id = await _request(api, db)
    payment_id = await deposit_payment(db, booking_id)
    await settle(api, db, payment_id)
    return booking_id, payment_id


async def _booking(db: AsyncSession, booking_id: str) -> Booking:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row


async def test_approving_a_paid_request_confirms_it_and_keeps_the_deposit(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    booking_id, _ = await _paid_request(api, db)
    assert (await _booking(db, booking_id)).deposit_status == "collected"

    res = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "confirmed"})

    assert res.status_code == 200, res.text
    booking = await _booking(db, booking_id)
    assert (booking.status, booking.deposit_status) == ("confirmed", "collected")
    assert booking.confirmed_at is not None
    assert await ledger.deposit_held(db, booking) == 2750
    assert sms.sent[-1].body.startswith("You're booked for")


async def test_declining_a_paid_request_refunds_the_deposit_and_tells_the_client(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    sms: FakeSmsSender,
) -> None:
    booking_id, payment_id = await _paid_request(api, db)

    res = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "canceled"})

    assert res.status_code == 200, res.text
    booking = await _booking(db, booking_id)
    assert (booking.status, booking.deposit_status) == ("canceled", "refunded")
    assert await ledger.deposit_held(db, booking) == 0
    assert gateway.refunds == [(await provider_ref(db, payment_id), 2750, False)]
    assert sms.sent[-1].body.startswith("Your request with Birchbark Pet Studio for")
    assert sms.sent[-1].body.endswith(
        "wasn't accepted, and your $27.50 deposit is being refunded to your card."
    )
    assert ".." not in sms.sent[-1].body


async def test_declining_an_unpaid_request_cancels_its_deposit_and_frees_the_time(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    sms: FakeSmsSender,
) -> None:
    await enable_payments(db)
    booking_id = await _request(api, db)
    payment_id = await deposit_payment(db, booking_id)

    res = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "canceled"})

    assert res.status_code == 200, res.text
    assert (await payment(db, payment_id)).status == "canceled"
    assert await provider_ref(db, payment_id) in gateway.canceled_intents
    assert gateway.refunds == []
    assert sms.sent[-1].body.endswith("You're welcome to book another time.")
    again = await _request(api, db, phone="+16045550272")
    assert (await _booking(db, again)).status == "pending"


async def test_a_declined_request_is_answered_once(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    sms: FakeSmsSender,
) -> None:
    booking_id, _ = await _paid_request(api, db)
    first = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "canceled"})
    assert first.status_code == 200, first.text
    sent = len(sms.sent)

    again = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "canceled"})
    approve = await as_owner.patch(f"/v1/bookings/{booking_id}", json={"status": "confirmed"})

    assert again.status_code == 200
    assert approve.status_code == 409
    assert len(gateway.refunds) == 1 and len(sms.sent) == sent
    refunds = await db.scalar(
        select(func.count()).where(Payment.booking_id == booking_id, Payment.kind == "refund")
    )
    assert refunds == 1


async def test_a_member_answers_only_their_own_requests(
    api: httpx.AsyncClient, as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    theirs = await _request(api, db, staff=ST_DIEGO, item="it_groom_sm", phone="+16045550273")
    others = await _request(api, db, item="it_groom_sm", phone="+16045550274")

    refused = await as_staff.patch(f"/v1/bookings/{others}", json={"status": "confirmed"})
    declined = await as_staff.patch(f"/v1/bookings/{others}", json={"status": "canceled"})
    approved = await as_staff.patch(f"/v1/bookings/{theirs}", json={"status": "confirmed"})

    assert (refused.status_code, declined.status_code) == (403, 403)
    assert (await _booking(db, others)).status == "pending"
    assert approved.status_code == 200, approved.text
    assert (await _booking(db, theirs)).status == "confirmed"


async def test_another_business_request_is_out_of_reach(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=owner.id,
        starts_at=datetime(2027, 8, 4, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 4, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=owner.id,
        client_id=client.id,
        status="pending",
        source="online",
    )
    db.add(booking)
    await db.flush()

    for status in ("confirmed", "canceled"):
        res = await as_owner.patch(f"/v1/bookings/{booking.id}", json={"status": status})
        assert res.status_code == 404
    assert (await _booking(db, booking.id)).status == "pending"


async def test_a_paid_request_nobody_answered_is_declined_and_refunded_after_its_day(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, sms: FakeSmsSender
) -> None:
    booking_id, payment_id = await _paid_request(api, db)
    booking = await _booking(db, booking_id)
    past = datetime(2020, 1, 1, 18, tzinfo=UTC)
    await db.execute(
        update(Slot)
        .where(Slot.id == booking.slot_id)
        .values(starts_at=past, ends_at=past + timedelta(hours=2))
    )
    await db.execute(update(Booking).where(Booking.id == booking_id).values(starts_at=past))
    await db.flush()
    sent = len(sms.sent)

    assert await run_complete_past_bookings(db, gateway, past + timedelta(days=1)) >= 1

    booking = await _booking(db, booking_id)
    assert (booking.status, booking.deposit_status) == ("canceled", "refunded")
    assert gateway.refunds == [(await provider_ref(db, payment_id), 2750, False)]
    assert not any("wasn't accepted" in s.body for s in sms.sent[sent:])
