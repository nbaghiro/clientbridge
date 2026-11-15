"""One read of every report for a period, and the bookkeeper's ZIP of CSVs."""

import csv
import io
import zipfile
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory
from tests.helpers import client_id

YEAR = "start=2015-01-01&end=2015-12-31"
MARCH = datetime(2015, 3, 10, 18, tzinfo=UTC)


async def _sale(
    db: AsyncSession, business_id: str = BIZ, client: str | None = None, provincial: str = "PST"
) -> None:
    """A $100 retail invoice, GST $5 and $7 provincial tax, paid by card, $56 back, a $8 tip."""
    payer = client or await client_id(db)
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=business_id,
        client_id=payer,
        number=99001,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=1200,
        total_cents=11200,
        issued_at=MARCH,
    )
    db.add(invoice)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=business_id,
            invoice_id=invoice.id,
            description="Shampoo",
            unit_amount_cents=10000,
            amount_cents=10000,
            tax_amount_cents=1200,
        )
    )
    await ledger.post_invoice(
        db, invoice, TaxResult(10000, 1200, 11200, {"GST": 500, provincial: 700}, [])
    )
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=payer,
        invoice_id=invoice.id,
        amount_cents=11200,
        method="card",
        provider="stripe",
        provider_ref=f"pi_{new_id('payment')}",
        status="succeeded",
        paid_at=MARCH,
    )
    db.add(payment)
    await db.flush()
    await ledger.post_payment(db, payment)
    refund = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=payer,
        kind="refund",
        parent_payment_id=payment.id,
        invoice_id=invoice.id,
        amount_cents=5600,
        method="card",
        provider="stripe",
        provider_ref=f"re_{new_id('payment')}",
        status="succeeded",
        paid_at=MARCH,
    )
    db.add(refund)
    await db.flush()
    await ledger.post_refund(db, refund, payment)
    await ledger.post(
        db,
        business_id,
        event="tip",
        ref=f"tip:{new_id('payment')}:st_diego",
        legs=[
            Leg("business", business_id, "staff_cost", 800),
            Leg("staff", "st_diego", "payable", -800, "pending"),
        ],
        occurred_at=MARCH,
    )
    payout_id_paid = f"po_{new_id('payment')}"
    for payout_id, amount in ((payout_id_paid, 5000), (f"po_{new_id('payment')}", 700)):
        await ledger.post_payout(
            db,
            business_id,
            payout_id=payout_id,
            amount=amount,
            currency="CAD",
            arrival_at=MARCH,
            occurred_at=MARCH,
        )
    await ledger.arrive_payout(
        db, business_id, payout_id=payout_id_paid, amount=5000, currency="CAD", arrival_at=MARCH
    )
    await db.commit()


async def test_summary_reads_every_report(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _sale(db)
    res = await as_owner.get(f"/v1/reports/summary?{YEAR}")
    assert res.status_code == 200, res.text
    body = res.json()
    income = body["income"]
    assert income["sales_cents"] == 10000
    assert income["refunds_cents"] == 5000
    assert income["net_cents"] == 5000
    assert income["tax_by_code"] == {"GST": 250, "PST": 350}
    assert income["tips_cents"] == 800
    assert income["received_cents"] == 5600
    assert income["by_method"] == {"card": 5600}
    assert body["gst_hst"]["tax_collected_cents"] == 250
    assert body["provincial"]["collected_cents"] == 350
    assert body["provincial"]["taxable_cents"] == 5000  # half refunded, like its PST
    assert [m["month"] for m in body["months"]][:3] == ["2015-01", "2015-02", "2015-03"]
    assert len(body["months"]) == 12
    assert body["months"][2]["net_cents"] == 5000
    assert [p["amount_cents"] for p in body["payouts"]] == [5000]
    assert body["payouts"][0]["status"] == "paid"
    assert str(body["payouts"][0]["payout_id"]).startswith("po_")
    assert body["t4a_year"] == 2015
    assert {r["code"] for r in body["rates"]} >= {"GST"}


async def test_export_zip_holds_one_csv_per_report(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _sale(db)
    res = await as_owner.post(
        "/v1/reports/export",
        json={
            "kinds": ["income", "pst", "payouts", "pst"],
            "start": "2015-01-01",
            "end": "2015-12-31",
        },
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        names = zf.namelist()
        assert names == [
            "income-2015-01-01-to-2015-12-31.csv",
            "pst-2015-01-01-to-2015-12-31.csv",
            "payouts-2015-01-01-to-2015-12-31.csv",
        ]
        pst = list(csv.reader(io.StringIO(zf.read(names[1]).decode())))
        assert pst[1][2:4] == ["5000", "350"]
        payouts = list(csv.reader(io.StringIO(zf.read(names[2]).decode())))
        assert payouts[1][1:] == ["2015-03-10", "5000", "paid"]


async def test_the_zip_names_the_t4a_for_its_year(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _sale(db)
    res = await as_owner.post(
        "/v1/reports/export",
        json={"kinds": ["income", "t4a"], "start": "2015-03-01", "end": "2015-03-31"},
    )
    assert res.status_code == 200, res.text
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        assert zf.namelist() == ["income-2015-03-01-to-2015-03-31.csv", "t4a-2015.csv"]


async def test_income_csv_carries_the_income_report_as_on_screen(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _sale(db)
    income = (await as_owner.get(f"/v1/reports/summary?{YEAR}")).json()["income"]
    res = await as_owner.get(f"/v1/reports/income.csv?{YEAR}")
    assert res.status_code == 200, res.text
    assert list(csv.reader(io.StringIO(res.text))) == [
        ["metric", "amount_cents"],
        ["sales", str(income["sales_cents"])],
        ["refunds", str(income["refunds_cents"])],
        ["net_sales", str(income["net_cents"])],
        ["tax:GST", "250"],
        ["tax:PST", "350"],
        ["sales_with_tax", "5600"],
        ["tips", "800"],
        ["received", "5600"],
        ["method:card", "5600"],
    ]
    assert (income["sales_cents"], income["refunds_cents"], income["net_cents"]) == (
        10000,
        5000,
        5000,
    )


@pytest.mark.parametrize(
    ("province", "provincial", "how"),
    [("BC", "PST", "refund"), ("BC", "PST", "lost dispute"), ("QC", "QST", "refund")],
)
async def test_money_back_in_a_later_month_takes_its_sale_out_of_that_months_provincial_base(
    as_owner: httpx.AsyncClient, db: AsyncSession, province: str, provincial: str, how: str
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(province=province))
    await _sale(db, provincial=provincial)
    paid = (
        await db.execute(
            select(Payment)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(Invoice.number == 99001, Payment.kind == "payment")
        )
    ).scalar_one()
    april = datetime(2015, 4, 2, 18, tzinfo=UTC)
    if how == "refund":
        rest = Payment(
            id=new_id("payment"),
            business_id=BIZ,
            client_id=paid.client_id,
            kind="refund",
            parent_payment_id=paid.id,
            invoice_id=paid.invoice_id,
            amount_cents=5600,
            method="card",
            provider="stripe",
            provider_ref=f"re_{new_id('payment')}",
            status="succeeded",
            paid_at=april,
        )
        db.add(rest)
        await db.flush()
        await ledger.post_refund(db, rest, paid)
    else:
        dispute = f"dp_{new_id('payment')}"
        await ledger.post_dispute(
            db, paid, dispute_id=dispute, amount=5600, fee=0, occurred_at=april
        )
        await ledger.lose_dispute(db, paid, dispute_id=dispute, amount=5600, occurred_at=april)
    await db.commit()

    async def base_and_tax(start: str, end: str) -> tuple[int, int]:
        body = (await as_owner.get(f"/v1/reports/summary?start={start}&end={end}")).json()
        return body["provincial"]["taxable_cents"], body["provincial"]["collected_cents"]

    assert await base_and_tax("2015-03-01", "2015-03-31") == (5000, 350)
    assert await base_and_tax("2015-04-01", "2015-04-30") == (-5000, -350)
    assert await base_and_tax("2015-01-01", "2015-12-31") == (0, 0)


async def test_every_kind_exports(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _sale(db)
    kinds = ["income", "sales-by-item", "gst-hst", "pst", "t4a", "payouts", "staff-pay"]
    res = await as_owner.post(
        "/v1/reports/export", json={"kinds": kinds, "start": "2015-01-01", "end": "2015-12-31"}
    )
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        assert len(zf.namelist()) == 7


async def test_pst_and_payout_csvs(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _sale(db)
    pst = await as_owner.get(f"/v1/reports/pst.csv?{YEAR}")
    assert pst.status_code == 200
    assert pst.text.splitlines()[0] == "code,rate_bps,taxable_sales_cents,collected_cents,number"
    payouts = await as_owner.get(f"/v1/reports/payouts.csv?{YEAR}")
    row = payouts.text.splitlines()[1]
    assert row.startswith("po_") and row.endswith(",5000,paid")


async def test_export_without_reports_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/reports/export", json={"kinds": [], "start": "2015-01-01", "end": "2015-12-31"}
    )
    assert res.status_code == 422
    unknown = await as_owner.post(
        "/v1/reports/export", json={"kinds": ["ledger"], "start": "2015-01-01", "end": "2015-12-31"}
    )
    assert unknown.status_code == 422


async def test_staff_cannot_read_or_export_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get(f"/v1/reports/summary?{YEAR}")).status_code == 403
    body = {"kinds": ["income"], "start": "2015-01-01", "end": "2015-12-31"}
    assert (await as_staff.post("/v1/reports/export", json=body)).status_code == 403


async def test_unauthenticated_401(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get(f"/v1/reports/summary?{YEAR}")).status_code == 401


async def test_other_business_money_stays_out(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    stranger = await factory.client(business=other)
    await _sale(db, other.id, stranger.id)
    body = (await as_owner.get(f"/v1/reports/summary?{YEAR}")).json()
    assert body["income"]["sales_cents"] == 0
    assert body["payouts"] == []
    assert body["provincial"]["taxable_cents"] == 0


async def test_period_with_nothing_reads_zeros(as_owner: httpx.AsyncClient) -> None:
    body = (await as_owner.get("/v1/reports/summary?start=1998-02-01&end=1998-02-28")).json()
    assert body["income"]["net_cents"] == 0
    assert body["months"] == [
        {"month": "1998-01", "net_cents": 0},
        {"month": "1998-02", "net_cents": 0},
    ]
    assert body["t4a"] == []


async def test_report_rates_are_the_periods_not_todays(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(province="NS"))
    await db.flush()
    before = (await as_owner.get("/v1/reports/summary?start=2025-01-01&end=2025-03-31")).json()
    assert {r["code"]: r["rate_bps"] for r in before["rates"]} == {"HST": 1500}
    spanning = (await as_owner.get("/v1/reports/summary?start=2025-03-01&end=2025-04-30")).json()
    assert {r["code"]: r["rate_bps"] for r in spanning["rates"]} == {"HST": None}


async def test_the_provincial_report_names_the_period_province_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(province="MB"))
    await db.flush()
    body = (await as_owner.get("/v1/reports/summary?start=2025-01-01&end=2025-03-31")).json()
    assert (body["provincial"]["code"], body["provincial"]["rate_bps"]) == ("RST", 700)


async def _paid_invoice(
    db: AsyncSession, lines: list[tuple[str | None, int]], tax: dict[str, int]
) -> Payment:
    payer = await client_id(db)
    subtotal, tax_total = sum(cents for _, cents in lines), sum(tax.values())
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=payer,
        number=99002,
        status="sent",
        currency="CAD",
        subtotal_cents=subtotal,
        tax_total_cents=tax_total,
        total_cents=subtotal + tax_total,
        issued_at=MARCH,
    )
    db.add(invoice)
    await db.flush()
    for position, (item_id, cents) in enumerate(lines):
        db.add(
            Line(
                id=new_id("line"),
                business_id=BIZ,
                invoice_id=invoice.id,
                item_id=item_id,
                description="Line",
                position=position,
                unit_amount_cents=cents,
                amount_cents=cents,
                tax_amount_cents=1,
            )
        )
    await ledger.post_invoice(
        db, invoice, TaxResult(subtotal, tax_total, subtotal + tax_total, tax, [])
    )
    payment = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=payer,
        invoice_id=invoice.id,
        amount_cents=subtotal + tax_total,
        method="card",
        provider="stripe",
        provider_ref=f"pi_{new_id('payment')}",
        status="succeeded",
        paid_at=MARCH,
    )
    db.add(payment)
    await db.flush()
    await ledger.post_payment(db, payment)
    return payment


async def _refund(db: AsyncSession, paid: Payment, amount: int, at: datetime) -> None:
    refund = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=paid.client_id,
        kind="refund",
        parent_payment_id=paid.id,
        invoice_id=paid.invoice_id,
        amount_cents=amount,
        method="card",
        provider="stripe",
        provider_ref=f"re_{new_id('payment')}",
        status="succeeded",
        paid_at=at,
    )
    db.add(refund)
    await db.flush()
    await ledger.post_refund(db, refund, paid)


async def test_part_refunds_in_two_months_give_back_the_provincial_base_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    paid = await _paid_invoice(db, [(None, 4001)], {"GST": 201, "PST": 280})
    await _refund(db, paid, 2241, datetime(2015, 4, 2, 18, tzinfo=UTC))
    await _refund(db, paid, 2241, datetime(2015, 5, 2, 18, tzinfo=UTC))
    await db.commit()

    async def base(start: str, end: str) -> int:
        body = (await as_owner.get(f"/v1/reports/summary?start={start}&end={end}")).json()
        return body["provincial"]["taxable_cents"]

    april, may = await base("2015-04-01", "2015-04-30"), await base("2015-05-01", "2015-05-31")
    assert april + may == await base("2015-04-01", "2015-05-31") == -4001
    assert await base("2015-03-01", "2015-03-31") == 4001
    assert await base("2015-01-01", "2015-12-31") == 0


async def test_sales_by_item_books_a_part_refund_in_its_own_month(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    paid = await _paid_invoice(
        db, [("it_groom_sm", 6000), ("it_bath", 4000), (None, 0)], {"GST": 500}
    )
    await _refund(db, paid, 2100, datetime(2015, 4, 2, 18, tzinfo=UTC))
    await db.commit()

    async def items(start: str, end: str) -> tuple[dict[str, tuple[int, int]], int]:
        body = (await as_owner.get(f"/v1/reports/summary?start={start}&end={end}")).json()
        rows = {
            r["item_id"]: (r["sales_cents"], r["refunded_cents"]) for r in body["sales_by_item"]
        }
        csv_rows = list(
            csv.DictReader(
                io.StringIO(
                    (
                        await as_owner.get(f"/v1/reports/sales-by-item.csv?start={start}&end={end}")
                    ).text
                )
            )
        )
        assert [(r["sales_cents"], r["refunded_cents"]) for r in csv_rows] == [
            (str(r["sales_cents"]), str(r["refunded_cents"])) for r in body["sales_by_item"]
        ]
        return rows, body["income"]["refunds_cents"]

    assert await items("2015-03-01", "2015-03-31") == (
        {"it_groom_sm": (6000, 0), "it_bath": (4000, 0)},
        0,
    )
    assert await items("2015-04-01", "2015-04-30") == (
        {"it_groom_sm": (0, 1200), "it_bath": (0, 800)},
        2000,
    )
    assert await items("2015-01-01", "2015-12-31") == (
        {"it_groom_sm": (6000, 1200), "it_bath": (4000, 800)},
        2000,
    )


async def test_sales_by_item_and_income_agree_on_a_lost_dispute(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    paid = await _paid_invoice(db, [("it_groom_sm", 3333), ("it_bath", 6667)], {"GST": 500})
    dispute = f"dp_{new_id('payment')}"
    april = datetime(2015, 4, 2, 18, tzinfo=UTC)
    await ledger.post_dispute(db, paid, dispute_id=dispute, amount=10500, fee=0, occurred_at=april)
    await ledger.lose_dispute(db, paid, dispute_id=dispute, amount=10500, occurred_at=april)
    await db.commit()
    body = (await as_owner.get("/v1/reports/summary?start=2015-04-01&end=2015-04-30")).json()
    refunded = {r["item_id"]: r["refunded_cents"] for r in body["sales_by_item"]}
    assert refunded == {"it_groom_sm": 3333, "it_bath": 6667}
    assert sum(refunded.values()) == body["income"]["refunds_cents"] == 10000
