"""Refunds as numbered credit notes: reason, notify, the split preview and refunds made by hand."""

from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.payments import credit_note_number, next_credit_note
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory, FakeEmailSender
from tests.helpers import (
    business_balance,
    client_id,
    enable_payments,
    invoice,
    key,
    ok,
    payment,
    sent_invoice,
    settle,
)


async def _taxed_card_payment(
    api: httpx.AsyncClient, db: AsyncSession, number: int
) -> tuple[str, str]:
    """A sent $100 + $5 GST + $2 PST invoice, paid in full by card and settled."""
    await enable_payments(db)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await client_id(db, email="cn@example.ca"),
        number=number,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=700,
        total_cents=10700,
        issued_at=datetime.now(UTC),
    )
    db.add(inv)
    await db.flush()
    await ledger.post_invoice(db, inv, TaxResult(10000, 700, 10700, {"GST": 500, "PST": 200}, []))
    pay = ok(await api.post(f"/v1/payments/invoice/{inv.id}")).json()
    await settle(api, db, str(pay["payment_id"]))
    return inv.id, str(pay["payment_id"])


def _parts(preview: dict[str, object]) -> dict[str, int]:
    rows = preview["parts"]
    assert isinstance(rows, list)
    return {f"{r['category']}:{r['code']}": int(r["cents"]) for r in rows}


async def test_part_refund_is_numbered_and_previewed(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    inv, pay = await _taxed_card_payment(as_owner, db, 9811)

    preview = ok(await as_owner.get(f"/v1/payments/{pay}/refund-preview?amount_cents=2140")).json()
    assert preview["left_cents"] == 10700
    assert preview["refund_cents"] == 2140
    assert preview["next_credit_note"] == "CN-9811-1"
    assert preview["by_hand"] is False
    assert _parts(preview) == {"revenue:": 2000, "tax:GST": 100, "tax:PST": 40}

    body = {"amount_cents": 2140, "reason": "skipped", "notify": True}
    out = ok(await as_owner.post(f"/v1/payments/{pay}/refund", json=body, headers=key())).json()
    assert out["credit_note"] == "CN-9811-1"
    refund = await payment(db, out["refund_id"])
    assert (refund.reason, refund.credit_note) == ("skipped", "CN-9811-1")
    assert any("CN-9811-1" in m.body for m in email.sent)
    assert (await invoice(db, inv)).status == "paid"

    revenue = await ledger.subject_balance(
        db, BIZ, category="revenue", subject_type="invoice", subject_id=inv
    )
    assert revenue == -8000

    second = ok(await as_owner.get(f"/v1/payments/{pay}/refund-preview")).json()
    assert second["next_credit_note"] == "CN-9811-2"
    assert second["left_cents"] == 8560
    assert _parts(second) == {"revenue:": 8000, "tax:GST": 400, "tax:PST": 160}


async def test_refund_without_notice_sends_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    _, pay = await _taxed_card_payment(as_owner, db, 9812)
    email.sent.clear()
    body = {"reason": "duplicate", "notify": False}
    ok(await as_owner.post(f"/v1/payments/{pay}/refund", json=body))
    assert not any("Refund" in m.subject for m in email.sent)


async def test_cash_payment_is_refunded_by_hand(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await sent_invoice(db, total=3000, number=9813)
    paid = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments",
            json={"method": "cash", "amount_cents": 3000},
            headers=key(),
        ),
        201,
    ).json()
    cash = await business_balance(db, "cash")
    preview = ok(await as_owner.get(f"/v1/payments/{paid['payment_id']}/refund-preview")).json()
    assert preview["by_hand"] is True
    assert preview["fee_cents"] == 0

    out = ok(
        await as_owner.post(
            f"/v1/payments/{paid['payment_id']}/refund", json={"amount_cents": 1000}
        )
    ).json()
    refund = await payment(db, out["refund_id"])
    assert (refund.provider, refund.method, refund.provider_ref) == ("manual", "cash", None)
    assert refund.credit_note == "CN-9813-1"
    assert await business_balance(db, "cash") == cash - 1000
    assert (await invoice(db, inv)).status == "paid"


async def test_sale_credit_notes_use_the_sale_number(db: AsyncSession) -> None:
    order = Order(id=new_id("order"), business_id=BIZ, staff_id="st_owner", number=1044)
    db.add(order)
    await db.flush()
    paid = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        kind="payment",
        order_id=order.id,
        amount_cents=500,
        method="cash",
        provider="manual",
        status="succeeded",
    )
    db.add(paid)
    await db.flush()
    assert await next_credit_note(db, paid) == "CN-S-1044-1"
    assert credit_note_number("1143", 2) == "CN-1143-2"


async def test_preview_rejects_a_bad_amount_and_reports_blocks(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay = await _taxed_card_payment(as_owner, db, 9814)
    res = await as_owner.get(f"/v1/payments/{pay}/refund-preview?amount_cents=99999")
    assert res.status_code == 409
    ok(await as_owner.post(f"/v1/payments/{pay}/refund", json={}))
    done = ok(await as_owner.get(f"/v1/payments/{pay}/refund-preview")).json()
    assert done["blocked"] == "this payment was already refunded"
    assert done["parts"] == []
    refund_id = (
        await db.execute(select(Payment.id).where(Payment.parent_payment_id == pay))
    ).scalar_one()
    assert (await as_owner.get(f"/v1/payments/{refund_id}/refund-preview")).status_code == 409


async def test_bad_reason_is_refused(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    _, pay = await _taxed_card_payment(as_owner, db, 9815)
    res = await as_owner.post(f"/v1/payments/{pay}/refund", json={"reason": "because"})
    assert res.status_code == 422


async def _card_payment(db: AsyncSession) -> str:
    row = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        kind="payment",
        amount_cents=500,
        method="card",
        provider="stripe",
        provider_ref=f"pi_{new_id('payment')}",
        status="succeeded",
    )
    db.add(row)
    await db.flush()
    return row.id


async def test_staff_cannot_preview_or_refund(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    pay = await _card_payment(db)
    assert (await as_staff.get(f"/v1/payments/{pay}/refund-preview")).status_code == 403
    assert (await as_staff.post(f"/v1/payments/{pay}/refund", json={})).status_code == 403


async def test_unauthenticated_cannot_preview(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    pay = await _card_payment(db)
    assert (await unauth.get(f"/v1/payments/{pay}/refund-preview")).status_code == 401


async def test_foreign_payment_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    foreign = Payment(
        id=new_id("payment"),
        business_id=other.id,
        client_id=client.id,
        kind="payment",
        amount_cents=500,
        method="cash",
        provider="manual",
        status="succeeded",
    )
    db.add(foreign)
    await db.flush()
    assert (await as_owner.get(f"/v1/payments/{foreign.id}/refund-preview")).status_code == 404
    assert (await as_owner.post(f"/v1/payments/{foreign.id}/refund", json={})).status_code == 404


async def test_same_key_refunds_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    _, pay = await _taxed_card_payment(as_owner, db, 9818)
    headers = key()
    body = {"amount_cents": 1000, "reason": "other"}
    first = ok(await as_owner.post(f"/v1/payments/{pay}/refund", json=body, headers=headers)).json()
    again = ok(await as_owner.post(f"/v1/payments/{pay}/refund", json=body, headers=headers)).json()
    assert first == again
    rows = (await db.execute(select(Payment.id).where(Payment.parent_payment_id == pay))).scalars()
    assert len(list(rows)) == 1
