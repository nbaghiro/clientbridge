import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from tests.conftest import FakePaymentGateway
from tests.helpers import (
    card_pay,
    deposit_payment,
    enable_payments,
    ok,
    payment,
    provider_ref,
    settle,
    stripe_event,
)
from tests.helpers import key as retry_key
from tests.test_bookings import (
    CL_AMELIE,
    deposit_booking,
    pi_succeeded,
)

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"


async def _client_and_item(db: AsyncSession) -> tuple[str, str]:
    client_id = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    item_id = (
        (
            await db.execute(
                select(Item.id)
                .where(Item.business_id == BIZ, Item.duration_min.isnot(None))
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert client_id and item_id
    return client_id, item_id


def _booking(client_id: str, item_id: str, starts: str) -> dict[str, str]:
    return {
        "client_id": client_id,
        "item_id": item_id,
        "staff_id": ST_OWNER,
        "starts_at": starts,
    }


async def test_booking_flags_deposit_required(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    await db.execute(
        update(Item).where(Item.id == iid).values(deposit_type="percent", deposit_value=20)
    )
    await db.flush()
    res = await as_owner.post("/v1/bookings", json=_booking(cid, iid, "2027-04-01T17:00:00Z"))
    assert res.status_code == 201, res.text
    bk = (await db.execute(select(Booking).where(Booking.id == res.json()["id"]))).scalar_one()
    assert bk.deposit_amount_cents > 0


async def test_booking_no_deposit_when_item_has_none(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    await db.execute(update(Item).where(Item.id == iid).values(deposit_type="none"))
    await db.flush()
    res = await as_owner.post("/v1/bookings", json=_booking(cid, iid, "2027-04-02T17:00:00Z"))
    assert res.status_code == 201
    bk = (await db.execute(select(Booking).where(Booking.id == res.json()["id"]))).scalar_one()
    assert bk.deposit_amount_cents == 0


async def test_deposit_amount_computed_from_item(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    await db.execute(
        update(Item)
        .where(Item.id == iid)
        .values(price_cents=5000, deposit_type="percent", deposit_value=20)
    )
    await db.flush()
    res = await as_owner.post("/v1/bookings", json=_booking(cid, iid, "2027-04-03T17:00:00Z"))
    assert res.status_code == 201, res.text
    assert res.json()["deposit_amount_cents"] == 1000  # 20% of $50


async def test_deposit_rounds_half_to_even_and_never_exceeds_the_price(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid, iid = await _client_and_item(db)
    listed_id = "it_groom_lg"
    cases = [("percent", 50, 101, 50), ("percent", 50, 103, 52), ("fixed", 200, 101, 101)]
    for day, (kind, value, price, owed) in enumerate(cases, start=10):
        await db.execute(
            update(Item)
            .where(Item.id.in_((iid, listed_id)))
            .values(price_cents=price, deposit_type=kind, deposit_value=value)
        )
        await db.flush()
        listed = (await api.get("/book/birchbark/services")).json()["services"]
        assert next(s for s in listed if s["id"] == listed_id)["deposit_amount_cents"] == owed
        res = await as_owner.post(
            "/v1/bookings", json=_booking(cid, iid, f"2027-04-{day}T17:00:00Z")
        )
        assert res.status_code == 201, res.text
        assert res.json()["deposit_amount_cents"] == owed, (kind, value, price)


GOOD = {"Stripe-Signature": "good"}


async def _collected(api: httpx.AsyncClient, db: AsyncSession, starts: str) -> tuple[str, str]:
    await enable_payments(db)
    bid = await deposit_booking(api, db, starts=starts)
    pay = (await api.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await provider_ref(db, pay["payment_id"])
    assert (
        await api.post("/webhooks/stripe", content=pi_succeeded(f"evt_{bid}", pi), headers=GOOD)
    ).status_code == 200
    return bid, str(pay["payment_id"])


async def _api_invoice(api: httpx.AsyncClient, bid: str, *, send: bool = True) -> str:
    res = await api.post(
        "/v1/invoices",
        json={
            "client_id": CL_AMELIE,
            "lines": [
                {"description": "Deluxe Groom", "unit_amount_cents": 12000, "booking_id": bid}
            ],
        },
    )
    assert res.status_code == 201, res.text
    if send:
        assert (await api.post(f"/v1/invoices/{res.json()['id']}/send")).status_code == 200
    return str(res.json()["id"])


async def _state(db: AsyncSession, bid: str, inv_id: str) -> tuple[str, int, int]:
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    await db.refresh(booking)
    await db.refresh(invoice)
    return (
        booking.deposit_status,
        await ledger.deposit_held(db, booking),
        await ledger.invoice_balance(db, invoice),
    )


async def test_sending_the_invoice_applies_the_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, _ = await _collected(as_owner, db, "2027-07-01T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    status, held, balance = await _state(db, bid, inv_id)
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (status, held) == ("applied", 0)
    assert balance == invoice.total_cents - 2000
    assert (await ledger.invoice_state(db, invoice))[0] == "partial"
    invoice.overdue_notified_at = clock.now()
    await db.flush()
    assert (await ledger.invoice_state(db, invoice))[0] == "overdue"


async def test_a_visit_invoice_edited_with_its_line_references_still_takes_the_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, _ = await _collected(as_owner, db, "2027-07-04T10:00:00Z")
    draft = ok(await as_owner.post(f"/v1/invoices/from-booking/{bid}"), 201).json()
    kept = ("description", "quantity", "unit_amount_cents", "item_id", "booking_id", "staff_id")
    lines = [{k: ln[k] for k in kept} for ln in draft["lines"]]
    assert {ln["booking_id"] for ln in lines} == {bid}
    edited = await as_owner.patch(
        f"/v1/invoices/{draft['id']}", json={"notes": "Thanks for coming in", "lines": lines}
    )
    assert [{k: ln[k] for k in kept} for ln in ok(edited).json()["lines"]] == lines
    ok(await as_owner.post(f"/v1/invoices/{draft['id']}/send"))
    status, held, balance = await _state(db, bid, draft["id"])
    assert (status, held) == ("applied", 0)
    assert balance == draft["total_cents"] - 2000
    visit = await db.get(Booking, bid, populate_existing=True)
    assert visit is not None and visit.invoice_id == draft["id"]


async def test_deposit_settled_after_the_invoice_is_applied(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    bid = await deposit_booking(as_owner, db, starts="2027-07-02T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await provider_ref(db, pay["payment_id"])
    await as_owner.post("/webhooks/stripe", content=pi_succeeded("evt_late", pi), headers=GOOD)
    status, held, _ = await _state(db, bid, inv_id)
    assert (status, held) == ("applied", 0)


async def test_voiding_the_invoice_returns_the_deposit_to_held(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, _ = await _collected(as_owner, db, "2027-07-03T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    assert (await as_owner.post(f"/v1/invoices/{inv_id}/void")).status_code == 200
    status, held, _ = await _state(db, bid, inv_id)
    assert (status, held) == ("collected", 2000)
    again = await _api_invoice(as_owner, bid)
    assert (await _state(db, bid, again))[0] == "applied"


async def test_refunding_an_applied_deposit_reopens_the_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, pay_id = await _collected(as_owner, db, "2027-07-04T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    partial = await as_owner.post(
        f"/v1/payments/{pay_id}/refund", json={"amount_cents": 500}, headers=retry_key()
    )
    assert partial.status_code == 409
    assert partial.json()["message"] == "a deposit applied to an invoice is refunded in full"
    assert (
        await as_owner.post(f"/v1/payments/{pay_id}/refund", json={}, headers=retry_key())
    ).status_code == 200
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    status, held, balance = await _state(db, bid, inv_id)
    assert (status, held, balance) == ("refunded", 0, invoice.total_cents)
    assert (await ledger.invoice_state(db, invoice))[0] == "sent"


async def test_void_with_a_payment_in_progress_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    bid = await deposit_booking(as_owner, db, starts="2027-07-05T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    await card_pay(as_owner, db, inv_id)
    res = await as_owner.post(f"/v1/invoices/{inv_id}/void")
    assert res.status_code == 409
    assert res.json()["message"] == "this invoice has a payment in progress"


async def _online_deposit(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str, str]:
    await enable_payments(db)
    res = await api.post(
        "/book/birchbark",
        json={
            "item_id": "it_groom_lg",
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-02T16:00:00Z",
            "client": {"name": "Deposit Payer", "email": "payer@example.com"},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["booking_id"], body["manage_token"], await deposit_payment(db, body["booking_id"])


async def test_client_cancel_cancels_the_unpaid_deposit_intent(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    _, token, pid = await _online_deposit(api, db)
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 200
    assert (await payment(db, pid)).status == "canceled"
    assert await provider_ref(db, pid) in gateway.canceled_intents


async def test_staff_cancel_cancels_the_unpaid_deposit_intent(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    bid, _, pid = await _online_deposit(api, db)
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    assert (await payment(db, pid)).status == "canceled"
    assert await provider_ref(db, pid) in gateway.canceled_intents


async def test_a_deposit_that_settles_after_the_cancel_is_refunded(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    bid, token, pid = await _online_deposit(api, db)
    gateway.confirmed.add(await provider_ref(db, pid))
    assert (await api.post(f"/manage/{token}/cancel")).status_code == 200
    assert (await payment(db, pid)).status == "pending"
    await settle(api, db, pid)
    booking = await db.get(Booking, bid, populate_existing=True)
    assert booking is not None
    assert (booking.status, booking.deposit_status) == ("canceled", "refunded")
    assert await ledger.deposit_held(db, booking) == 0


async def test_a_rebuilt_deposit_is_held_for_its_booking(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A deposit intent whose row never committed settles into the booking it names."""
    bid, _, _ = await _online_deposit(api, db)
    held = await ledger.deposit_held(db, await _booking_row(db, bid))
    intent = {
        "id": "pi_rebuilt_deposit",
        "amount": 2500,
        "currency": "cad",
        "metadata": {"business_id": BIZ, "booking_id": bid},
    }
    await stripe_event(api, "payment_intent.succeeded", intent)
    rebuilt = await payment(db, (await _payment_id(db, "pi_rebuilt_deposit")))
    assert (rebuilt.kind, rebuilt.status, rebuilt.booking_id) == ("deposit", "succeeded", bid)
    assert await ledger.deposit_held(db, await _booking_row(db, bid)) == held + 2500


async def _booking_row(db: AsyncSession, booking_id: str) -> Booking:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row


async def _payment_id(db: AsyncSession, provider_ref: str) -> str:
    return (
        await db.execute(select(Payment.id).where(Payment.provider_ref == provider_ref))
    ).scalar_one()
