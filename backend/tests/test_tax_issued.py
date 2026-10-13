"""Tax is fixed when a document is issued: later settings never change what was charged."""

from decimal import Decimal

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Line
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.tax import TaxComponent, TaxLine, split_fixed
from tests.conftest import BIZ, FakeEmailSender
from tests.helpers import client_id, enable_payments, key, ok, settle

BC = [TaxComponent("GST", Decimal("0.05")), TaxComponent("PST", Decimal("0.07"))]
SHAMPOO = {"description": "Shampoo", "item_id": "it_shampoo", "unit_amount_cents": 2400}


async def _small_supplier(db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()


async def _tax_legs(db: AsyncSession, ref: str) -> dict[str, int]:
    rows = await db.execute(
        select(Account.code, Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.ref == ref, Account.category == "tax")
    )
    return {code: -cents for code, cents in rows.tuples().all()}


async def test_sale_paid_after_registration_change_books_the_tax_it_charged(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    sale = ok(
        await as_owner.post(
            "/v1/orders", json={"lines": [SHAMPOO], "receipt_email": "walkin@example.ca"}
        ),
        201,
    ).json()
    assert (sale["tax_total_cents"], sale["total_cents"]) == (288, 2688)
    await _small_supplier(db)
    await enable_payments(db)
    pay = ok(await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={})).json()
    await settle(as_owner, db, pay["payment_id"], "evt_issued_sale")
    assert await _tax_legs(db, f"payment:{pay['payment_id']}") == {"GST": 120, "PST": 168}
    line = (await db.execute(select(Line).where(Line.order_id == sale["id"]))).scalar_one()
    assert line.tax_amount_cents == 288
    (receipt,) = [m for m in email.sent if m.to == "walkin@example.ca"]
    assert "GST  $1.20" in receipt.body and "PST  $1.68" in receipt.body
    assert "Total  $26.88" in receipt.body


async def test_pay_page_shows_the_tax_issued_on_the_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    sent = ok(
        await as_owner.post(
            "/v1/invoices", json={"client_id": cid, "lines": [SHAMPOO], "send": True}
        ),
        201,
    ).json()
    await _small_supplier(db)
    page = ok(await as_owner.get(f"/pay/{sent['pay_token']}")).json()
    assert page["taxes"] == [
        {"code": "GST", "rate_bps": 500, "base_cents": 2400, "cents": 120},
        {"code": "PST", "rate_bps": 700, "base_cents": 2400, "cents": 168},
    ]
    assert page["lines"][0]["tax_codes"] == ["GST", "PST"]
    assert page["total_cents"] == 2688


async def test_package_settled_after_a_price_change_books_the_tax_in_what_was_paid(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    body = ok(
        await as_owner.post(
            "/v1/packages",
            json={"client_id": "cl_marcus", "item_id": "it_pkg5", "payment_method_id": "default"},
            headers=key(),
        ),
        201,
    ).json()
    await db.execute(update(Item).where(Item.id == "it_pkg5").values(price_cents=30000))
    await db.flush()
    await settle(as_owner, db, body["payment_id"], "evt_issued_pkg")
    assert await _tax_legs(db, f"payment:{body['payment_id']}") == {"GST": 1000}


async def test_package_settlement_keeps_the_sale_tax_when_nothing_changed(
    db: AsyncSession,
) -> None:
    payment = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id="cl_marcus",
        kind="payment",
        amount_cents=21000,
        currency="CAD",
        method="cash",
        provider="manual",
        status="succeeded",
        paid_at=clock.now(),
    )
    db.add(payment)
    await db.flush()
    package = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id="cl_marcus",
        item_id="it_pkg5",
        sessions_total=5,
        status="active",
        payment_id=payment.id,
    )
    db.add(package)
    await db.flush()
    await ledger.post_payment(db, payment)
    assert await _tax_legs(db, f"payment:{payment.id}") == {"GST": 1000}


def test_split_keeps_each_fixed_line_total_and_its_codes() -> None:
    result = split_fixed(
        [
            (TaxLine(10000), 1200),
            (TaxLine(10000), 0),
            (TaxLine(10000), 1300),
            (TaxLine(10000, tax_class="federal_only"), 500),
            (TaxLine(10000, tax_class="exempt"), 0),
        ],
        BC,
    )
    assert [ln.by_jurisdiction for ln in result.lines] == [
        {"GST": 500, "PST": 700},
        {},
        {"GST": 542, "PST": 758},
        {"GST": 500},
        {},
    ]
    assert result.tax_total_cents == 3000
    assert result.by_jurisdiction == {"GST": 1542, "PST": 1458}
