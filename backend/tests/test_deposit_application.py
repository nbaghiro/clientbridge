"""A collected deposit counts toward the booking's invoice, and comes back off it on void/refund."""

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from tests.test_bookings import (
    CL_AMELIE,
    _deposit_booking,
    _enable_payments,
    _pi_succeeded,
    _provider_ref,
)

GOOD = {"Stripe-Signature": "good"}


async def _collected(api: httpx.AsyncClient, db: AsyncSession, starts: str) -> tuple[str, str]:
    await _enable_payments(db)
    bid = await _deposit_booking(api, db, starts=starts)
    pay = (await api.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await _provider_ref(db, pay["payment_id"])
    assert (
        await api.post("/webhooks/stripe", content=_pi_succeeded(f"evt_{bid}", pi), headers=GOOD)
    ).status_code == 200
    return bid, str(pay["payment_id"])


async def _invoice(api: httpx.AsyncClient, bid: str, *, send: bool = True) -> str:
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
    inv_id = await _invoice(as_owner, bid)
    status, held, balance = await _state(db, bid, inv_id)
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (status, held) == ("applied", 0)
    assert balance == invoice.total_cents - 2000
    assert invoice.status == "sent"


async def test_deposit_settled_after_the_invoice_is_applied(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-07-02T10:00:00Z")
    inv_id = await _invoice(as_owner, bid)
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await _provider_ref(db, pay["payment_id"])
    await as_owner.post("/webhooks/stripe", content=_pi_succeeded("evt_late", pi), headers=GOOD)
    status, held, _ = await _state(db, bid, inv_id)
    assert (status, held) == ("applied", 0)


async def test_voiding_the_invoice_returns_the_deposit_to_held(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, _ = await _collected(as_owner, db, "2027-07-03T10:00:00Z")
    inv_id = await _invoice(as_owner, bid)
    assert (await as_owner.post(f"/v1/invoices/{inv_id}/void")).status_code == 200
    status, held, _ = await _state(db, bid, inv_id)
    assert (status, held) == ("collected", 2000)
    again = await _invoice(as_owner, bid)
    assert (await _state(db, bid, again))[0] == "applied"


async def test_refunding_an_applied_deposit_reopens_the_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid, pay_id = await _collected(as_owner, db, "2027-07-04T10:00:00Z")
    inv_id = await _invoice(as_owner, bid)
    partial = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=500")
    assert partial.status_code == 409
    assert partial.json()["message"] == "a deposit applied to an invoice is refunded in full"
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund")).status_code == 200
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    status, held, balance = await _state(db, bid, inv_id)
    assert (status, held, balance) == ("refunded", 0, invoice.total_cents)


async def test_void_with_a_payment_in_progress_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-07-05T10:00:00Z")
    inv_id = await _invoice(as_owner, bid)
    assert (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).status_code in (200, 201)
    res = await as_owner.post(f"/v1/invoices/{inv_id}/void")
    assert res.status_code == 409
    assert res.json()["message"] == "this invoice has a payment in progress"
