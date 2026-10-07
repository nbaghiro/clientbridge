import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from tests.helpers import card_pay, enable_payments
from tests.test_bookings import (
    CL_AMELIE,
    _deposit_booking,
    _pi_succeeded,
    _provider_ref,
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


GOOD = {"Stripe-Signature": "good"}


async def _collected(api: httpx.AsyncClient, db: AsyncSession, starts: str) -> tuple[str, str]:
    await enable_payments(db)
    bid = await _deposit_booking(api, db, starts=starts)
    pay = (await api.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await _provider_ref(db, pay["payment_id"])
    assert (
        await api.post("/webhooks/stripe", content=_pi_succeeded(f"evt_{bid}", pi), headers=GOOD)
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
    assert invoice.status == "sent"


async def test_deposit_settled_after_the_invoice_is_applied(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-07-02T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    pay = (await as_owner.post(f"/v1/bookings/{bid}/deposit?payment_method_id=default")).json()
    pi = await _provider_ref(db, pay["payment_id"])
    await as_owner.post("/webhooks/stripe", content=_pi_succeeded("evt_late", pi), headers=GOOD)
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
    partial = await as_owner.post(f"/v1/payments/{pay_id}/refund", json={"amount_cents": 500})
    assert partial.status_code == 409
    assert partial.json()["message"] == "a deposit applied to an invoice is refunded in full"
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund", json={})).status_code == 200
    invoice = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    status, held, balance = await _state(db, bid, inv_id)
    assert (status, held, balance) == ("refunded", 0, invoice.total_cents)


async def test_void_with_a_payment_in_progress_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    bid = await _deposit_booking(as_owner, db, starts="2027-07-05T10:00:00Z")
    inv_id = await _api_invoice(as_owner, bid)
    await card_pay(as_owner, db, inv_id)
    res = await as_owner.post(f"/v1/invoices/{inv_id}/void")
    assert res.status_code == 409
    assert res.json()["message"] == "this invoice has a payment in progress"
