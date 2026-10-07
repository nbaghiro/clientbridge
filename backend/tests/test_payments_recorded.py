from datetime import UTC, date, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment, PaymentMethod
from tests.conftest import BIZ, Factory, FakeEmailSender
from tests.helpers import (
    business_balance,
    client_id,
    enable_payments,
    invoice,
    key,
    ok,
    sent_invoice,
)


def _pay(method: str, amount: int, **extra: object) -> dict[str, object]:
    return {"method": method, "amount_cents": amount, **extra}


async def test_cash_part_payment_then_the_rest(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await client_id(db, email="payer@example.ca")
    inv = await sent_invoice(db, client=cid, total=5661)
    cash_before = await business_balance(db, "cash")

    first = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments",
            json=_pay("cash", 2000, tendered_cents=5000, note="paid at the desk"),
            headers=key(),
        ),
        201,
    ).json()
    assert first["status"] == "succeeded"
    assert first["change_cents"] == 3000
    assert first["balance_cents"] == 3661
    assert (await invoice(db, inv)).status == "partial"
    assert await business_balance(db, "cash") == cash_before + 2000
    assert any("Receipt" in m.subject for m in email.sent)

    row = (await db.execute(select(Payment).where(Payment.id == first["payment_id"]))).scalar_one()
    assert (row.provider, row.method, row.tendered_cents, row.note) == (
        "manual",
        "cash",
        5000,
        "paid at the desk",
    )

    rest = ok(
        await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 3661), headers=key()),
        201,
    ).json()
    assert rest["balance_cents"] == 0
    assert rest["change_cents"] == 0
    assert (await invoice(db, inv)).status == "paid"


async def test_cheque_and_etransfer_land_in_the_bank(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await sent_invoice(db, total=10000)
    bank_before = await business_balance(db, "bank")
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    cheque = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments",
            json=_pay("cheque", 4000, reference="000123", received_on=yesterday),
            headers=key(),
        ),
        201,
    ).json()
    etransfer = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments",
            json=_pay("interac", 6000, reference="CA1MRkB7"),
            headers=key(),
        ),
        201,
    ).json()
    assert etransfer["balance_cents"] == 0
    assert await business_balance(db, "bank") == bank_before + 10000
    row = (await db.execute(select(Payment).where(Payment.id == cheque["payment_id"]))).scalar_one()
    assert row.method == "cheque" and row.reference == "000123"
    assert row.paid_at is not None and row.paid_at.date() < datetime.now(UTC).date() + timedelta(1)


async def test_charge_saved_card_opens_an_intent(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_rec"))
    card = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=cid,
        method="card",
        brand="amex",
        last4="0005",
        provider="stripe",
        provider_ref="pm_rec",
        status="active",
    )
    db.add(card)
    inv = await sent_invoice(db, client=cid, total=3000)
    res = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments",
            json=_pay("card", 3000, payment_method_id=card.id),
            headers=key(),
        ),
        201,
    ).json()
    assert res["status"] == "pending"
    assert res["client_secret"]
    assert res["balance_cents"] == 3000  # paid only when the charge settles


async def test_card_needs_a_saved_card(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv = await sent_invoice(db, total=3000)
    res = await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("card", 3000))
    assert res.status_code == 422


async def test_card_needs_stripe(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db, None)
    inv = await sent_invoice(db, total=3000)
    res = await as_owner.post(
        f"/v1/invoices/{inv}/payments", json=_pay("card", 3000, payment_method_id="default")
    )
    assert res.status_code == 409


async def test_saved_card_only_for_card(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    res = await as_owner.post(
        f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000, payment_method_id="default")
    )
    assert res.status_code == 422


async def test_more_than_the_balance_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await sent_invoice(db, total=3000)
    res = await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 3001))
    assert res.status_code == 409


async def test_tendered_must_cover_the_amount(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await sent_invoice(db, total=3000)
    short = await as_owner.post(
        f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000, tendered_cents=2000)
    )
    assert short.status_code == 422
    not_cash = await as_owner.post(
        f"/v1/invoices/{inv}/payments", json=_pay("cheque", 3000, tendered_cents=5000)
    )
    assert not_cash.status_code == 422


async def test_future_date_is_refused(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    later = (date.today() + timedelta(days=3)).isoformat()
    res = await as_owner.post(
        f"/v1/invoices/{inv}/payments", json=_pay("interac", 3000, received_on=later)
    )
    assert res.status_code == 422


async def test_draft_void_and_paid_take_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    draft = await sent_invoice(db, total=3000, status="draft")
    void = await sent_invoice(db, total=3000, status="void")
    for inv in (draft, void):
        res = await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 1000))
        assert res.status_code == 409
    paid = await sent_invoice(db, total=1000)
    ok(await as_owner.post(f"/v1/invoices/{paid}/payments", json=_pay("cash", 1000)), 201)
    again = await as_owner.post(f"/v1/invoices/{paid}/payments", json=_pay("cash", 1000))
    assert again.status_code == 409


async def test_invalid_amount_and_method(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    assert (
        await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 0))
    ).status_code == 422
    assert (
        await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("bitcoin", 100))
    ).status_code == 422


async def test_staff_cannot_record(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    res = await as_staff.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000))
    assert res.status_code == 403


async def test_unauthenticated_cannot_record(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    res = await unauth.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000))
    assert res.status_code == 401


async def test_foreign_invoice_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    inv = await sent_invoice(db, client=client.id, total=3000, business_id=other.id)
    res = await as_owner.post(f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000))
    assert res.status_code == 404
    minted = (
        await db.execute(select(Payment.id).where(Payment.invoice_id == inv))
    ).scalar_one_or_none()
    assert minted is None


async def test_same_key_records_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await sent_invoice(db, total=3000)
    headers = key()
    first = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments", json=_pay("cash", 1000), headers=headers
        ),
        201,
    ).json()
    again = ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments", json=_pay("cash", 1000), headers=headers
        ),
        201,
    ).json()
    assert again["payment_id"] == first["payment_id"]
    count = (await db.execute(select(Payment.id).where(Payment.invoice_id == inv))).scalars().all()
    assert len(count) == 1
    assert (await invoice(db, inv)).balance_cents == 2000


async def test_no_receipt_when_not_asked(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await client_id(db, email="quiet@example.ca")
    inv = await sent_invoice(db, client=cid, total=3000)
    ok(
        await as_owner.post(
            f"/v1/invoices/{inv}/payments", json=_pay("cash", 3000, send_receipt=False)
        ),
        201,
    )
    assert not any("Receipt" in m.subject for m in email.sent)
