import secrets
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.bookings import run_reap_unpaid_bookings
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    Factory,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)
from tests.helpers import enable_payments, key, ok, payment, settle, stripe_event
from tests.test_bookings import CL_AMELIE, deliverable_phone

DEPOSIT = 2000
DEPOSIT_LINE = "Please pay the $20.00 deposit"


async def _deposit_on_classes(db: AsyncSession) -> None:
    await db.execute(
        update(Item)
        .where(Item.id == "it_puppy")
        .values(deposit_type="fixed", deposit_value=DEPOSIT)
    )


async def _class(db: AsyncSession, capacity: int = 4) -> str:
    await _deposit_on_classes(db)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id="st_owner",
        starts_at=datetime(2027, 3, 9, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, 9, 19, tzinfo=UTC),
        capacity=capacity,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    return slot.id


async def _row(db: AsyncSession, booking_id: str) -> Booking:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row


async def _added(
    as_owner: httpx.AsyncClient, db: AsyncSession, slot_id: str, client: str = CL_AMELIE
) -> Booking:
    res = await as_owner.post(f"/v1/classes/{slot_id}/roster", json={"client_id": client})
    assert res.status_code == 201, res.text
    return await _row(db, str(res.json()["booking_id"]))


async def _seated(as_owner: httpx.AsyncClient, db: AsyncSession) -> Booking:
    await enable_payments(db)
    return await _added(as_owner, db, await _class(db))


async def _deposits(db: AsyncSession, booking_id: str) -> list[Payment]:
    rows = await db.execute(
        select(Payment)
        .where(Payment.booking_id == booking_id, Payment.kind == "deposit")
        .order_by(Payment.created_at, Payment.id)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def _pay(api: httpx.AsyncClient, token: str | None) -> httpx.Response:
    assert token is not None
    return await api.post(f"/manage/{token}/deposit")


def _intent(res: httpx.Response) -> str:
    assert res.status_code == 200, res.text
    return str(res.json()["client_secret"]).removesuffix("_secret")


async def test_a_class_seat_added_by_staff_asks_for_the_deposit_and_takes_it(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
) -> None:
    await deliverable_phone(db, CL_AMELIE)
    booking = await _seated(as_owner, db)
    assert (booking.status, booking.deposit_status) == ("confirmed", "pending")
    body = sms.sent[-1].body
    assert DEPOSIT_LINE in body and f"/m/{booking.manage_token}" in body

    view = ok(await api.get(f"/manage/{booking.manage_token}")).json()
    assert (view["deposit_due"], view["accepts_card"], view["deposit_cents"]) == (
        True,
        True,
        DEPOSIT,
    )
    res = await _pay(api, booking.manage_token)
    assert res.json()["stripe_account_id"] == "acct_test"
    [deposit] = await _deposits(db, booking.id)
    assert (deposit.status, deposit.amount_cents, deposit.provider_ref) == (
        "pending",
        DEPOSIT,
        _intent(res),
    )
    await settle(api, db, deposit.id)
    paid = await _row(db, booking.id)
    assert paid.deposit_status == "collected"
    assert await ledger.deposit_held(db, paid) == DEPOSIT
    view = ok(await api.get(f"/manage/{booking.manage_token}")).json()
    assert (view["deposit_due"], view["deposit_status"]) == (False, "collected")


async def test_a_staff_booking_with_a_deposit_asks_for_it_in_the_confirmation(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
) -> None:
    await enable_payments(db)
    await deliverable_phone(db, CL_AMELIE)
    res = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": CL_AMELIE,
            "item_id": "it_groom_lg",
            "staff_id": "st_owner",
            "starts_at": "2027-03-10T17:00:00Z",
            "notify": True,
        },
    )
    assert res.status_code == 201, res.text
    booking = await _row(db, res.json()["id"])
    assert booking.deposit_amount_cents > 0
    assert "Please pay the" in sms.sent[-1].body
    assert f"/m/{booking.manage_token}" in sms.sent[-1].body
    _intent(await _pay(api, booking.manage_token))


async def test_without_card_payments_nothing_is_payable_and_nothing_is_asked(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    gateway: FakePaymentGateway,
) -> None:
    await enable_payments(db, None)
    await deliverable_phone(db, CL_AMELIE)
    booking = await _added(as_owner, db, await _class(db))
    assert DEPOSIT_LINE not in sms.sent[-1].body
    view = ok(await api.get(f"/manage/{booking.manage_token}")).json()
    assert (view["deposit_due"], view["accepts_card"]) == (True, False)
    res = await _pay(api, booking.manage_token)
    assert res.status_code == 409 and res.json()["error"] == "card_payments_unavailable"
    assert await _deposits(db, booking.id) == [] and gateway.charges == {}


async def test_an_unknown_link_is_404(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/manage/{secrets.token_urlsafe(18)}/deposit")
    assert res.status_code == 404


async def test_a_paid_deposit_or_none_due_is_409(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _seated(as_owner, db)
    _intent(await _pay(api, booking.manage_token))
    [deposit] = await _deposits(db, booking.id)
    await settle(api, db, deposit.id)
    paid = await _pay(api, booking.manage_token)
    assert paid.status_code == 409 and paid.json()["error"] == "deposit_not_due"
    assert len(await _deposits(db, booking.id)) == 1

    await db.execute(update(Item).where(Item.id == "it_groom_sm").values(deposit_type="none"))
    free = ok(
        await as_owner.post(
            "/v1/bookings",
            json={
                "client_id": CL_AMELIE,
                "item_id": "it_groom_sm",
                "staff_id": "st_owner",
                "starts_at": "2027-03-11T17:00:00Z",
            },
        ),
        201,
    ).json()
    none_due = await _pay(api, (await _row(db, free["id"])).manage_token)
    assert none_due.status_code == 409 and none_due.json()["error"] == "deposit_not_due"


async def test_a_cancelled_or_waitlisted_booking_has_nothing_to_pay(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    slot_id = await _class(db, capacity=2)
    seated = await _added(as_owner, db, slot_id)
    await _added(as_owner, db, slot_id, "cl_marcus")
    waiting = await _added(as_owner, db, slot_id, "cl_yuki")
    assert (waiting.status, waiting.deposit_status) == ("waitlisted", "pending")
    refused = await _pay(api, waiting.manage_token)
    assert refused.status_code == 409 and refused.json()["error"] == "deposit_not_due"
    assert not ok(await api.get(f"/manage/{waiting.manage_token}")).json()["deposit_due"]

    ok(await api.post(f"/manage/{seated.manage_token}/cancel", headers=key()))
    canceled = await _pay(api, seated.manage_token)
    assert canceled.status_code == 409 and canceled.json()["error"] == "deposit_not_due"
    assert await _deposits(db, seated.id) == []


async def test_staff_cancel_closes_the_opened_deposit(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    booking = await _seated(as_owner, db)
    ref = _intent(await _pay(api, booking.manage_token))
    ok(await as_owner.patch(f"/v1/bookings/{booking.id}", json={"status": "canceled"}))
    assert ref in gateway.canceled_intents
    assert [d.status for d in await _deposits(db, booking.id)] == ["canceled"]
    res = await _pay(api, booking.manage_token)
    assert res.status_code == 409 and res.json()["error"] == "deposit_not_due"


async def test_a_deposit_paid_from_the_link_is_refunded_on_a_cancel(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    booking = await _seated(as_owner, db)
    ref = _intent(await _pay(api, booking.manage_token))
    await settle(api, db, (await _deposits(db, booking.id))[0].id)
    res = ok(await api.post(f"/manage/{booking.manage_token}/cancel", headers=key()))
    assert res.json() == {"deposit": "refunded", "refund_cents": DEPOSIT}
    assert gateway.refunds[-1][:2] == (ref, DEPOSIT)
    assert (await _row(db, booking.id)).deposit_status == "refunded"


async def test_a_disputed_deposit_is_left_to_the_dispute_and_the_visit_still_cancels(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    booking = await _seated(as_owner, db)
    _intent(await _pay(api, booking.manage_token))
    [deposit] = await _deposits(db, booking.id)
    await settle(api, db, deposit.id)
    await db.execute(
        update(Payment).where(Payment.id == deposit.id).values(dispute_status="needs_response")
    )
    refunds = len(gateway.refunds)
    res = await api.post(f"/manage/{booking.manage_token}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert len(gateway.refunds) == refunds
    assert (await _row(db, booking.id)).status == "canceled"


async def test_another_business_is_paid_into_its_own_account(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    other = await factory.business(name="Other Studio")
    other.stripe_account_id, other.stripe_charges_enabled = "acct_other", True
    staff = await factory.staff(business=other)
    client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Visit",
        price_cents=8000,
        currency="CAD",
        duration_min=60,
        deposit_type="fixed",
        deposit_value=1500,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=staff.id,
        starts_at=datetime(2027, 3, 12, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, 12, 19, tzinfo=UTC),
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
        staff_id=staff.id,
        client_id=client.id,
        status="confirmed",
        source="manual",
        price_cents=8000,
        deposit_amount_cents=1500,
        deposit_status="pending",
        manage_token=secrets.token_urlsafe(18),
    )
    db.add(booking)
    await db.flush()
    res = await _pay(api, booking.manage_token)
    assert res.json()["stripe_account_id"] == "acct_other"
    [deposit] = await _deposits(db, booking.id)
    assert (deposit.business_id, deposit.client_id, deposit.amount_cents) == (
        other.id,
        client.id,
        1500,
    )

    other.stripe_charges_enabled = False
    await db.flush()
    off = await _pay(api, booking.manage_token)
    assert off.status_code == 409 and off.json()["error"] == "card_payments_unavailable"


async def test_opening_the_payment_again_replays_the_same_intent(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _seated(as_owner, db)
    first = _intent(await _pay(api, booking.manage_token))
    again = _intent(await _pay(api, booking.manage_token))
    assert first == again
    assert len(await _deposits(db, booking.id)) == 1


async def test_the_online_booking_intent_is_reused_from_the_link(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    booked = ok(
        await api.post(
            "/book/birchbark",
            json={
                "item_id": "it_groom_lg",
                "staff_id": "st_owner",
                "starts_at": "2027-03-02T16:00:00Z",
                "client": {"name": "Deposit Payer", "phone": "+16045550257"},
            },
        )
    ).json()
    res = await _pay(api, booked["manage_token"])
    assert res.json()["client_secret"] == booked["deposit_client_secret"]
    assert len(await _deposits(db, booked["booking_id"])) == 1


async def test_a_failed_attempt_opens_a_fresh_intent_and_closes_the_old_one(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    booking = await _seated(as_owner, db)
    first = _intent(await _pay(api, booking.manage_token))
    await stripe_event(api, "payment_intent.payment_failed", {"id": first})
    second = _intent(await _pay(api, booking.manage_token))
    assert second != first
    assert first in gateway.canceled_intents
    assert [d.status for d in await _deposits(db, booking.id)] == ["canceled", "pending"]
    assert _intent(await _pay(api, booking.manage_token)) == second


async def test_an_attempt_already_going_through_is_not_paid_twice(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    booking = await _seated(as_owner, db)
    first = _intent(await _pay(api, booking.manage_token))
    gateway.confirmed.add(first)
    await stripe_event(api, "payment_intent.payment_failed", {"id": first})
    res = await _pay(api, booking.manage_token)
    assert res.status_code == 409 and res.json()["error"] == "deposit_in_progress"
    assert [d.provider_ref for d in await _deposits(db, booking.id)] == [first]
    assert gateway.canceled_intents[-1] != first


async def test_a_repeated_webhook_collects_the_deposit_once(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _seated(as_owner, db)
    _intent(await _pay(api, booking.manage_token))
    [deposit] = await _deposits(db, booking.id)
    await settle(api, db, deposit.id, event_id="evt_deposit_once")
    await settle(api, db, deposit.id, event_id="evt_deposit_once")
    await settle(api, db, deposit.id)
    paid = await _row(db, booking.id)
    assert (paid.deposit_status, (await payment(db, deposit.id)).status) == (
        "collected",
        "succeeded",
    )
    assert await ledger.deposit_held(db, paid) == DEPOSIT


async def test_the_release_job_leaves_a_staff_booking_with_an_opened_deposit(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    booking = await _seated(as_owner, db)
    _intent(await _pay(api, booking.manage_token))
    online = ok(
        await api.post(
            "/book/birchbark",
            json={
                "item_id": "it_groom_lg",
                "staff_id": "st_owner",
                "starts_at": "2027-03-02T16:00:00Z",
                "client": {"name": "Deposit Payer", "phone": "+16045550257"},
            },
        )
    ).json()
    created = datetime(2026, 12, 31, tzinfo=UTC)
    await db.execute(
        update(Booking)
        .where(Booking.id.in_([booking.id, online["booking_id"]]))
        .values(created_at=created)
    )
    later = created + timedelta(days=1)
    released = await run_reap_unpaid_bookings(db, gateway, Notifier(email, sms, push), later)
    assert released == 1
    assert (await _row(db, online["booking_id"])).status == "canceled"
    kept = await _row(db, booking.id)
    assert (kept.status, kept.deposit_status) == ("confirmed", "pending")
    count = await db.scalar(
        select(func.count(Payment.id)).where(
            Payment.booking_id == booking.id, Payment.status == "pending"
        )
    )
    assert count == 1
