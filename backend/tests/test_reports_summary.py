"""One read of every report for a period, and the bookkeeper's ZIP of CSVs."""

import csv
import io
import zipfile
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory
from tests.helpers import client_id

YEAR = "start=1999-01-01&end=1999-12-31"
MARCH = datetime(1999, 3, 10, 18, tzinfo=UTC)


async def _sale(db: AsyncSession, business_id: str = BIZ, client: str | None = None) -> None:
    """A $100 retail invoice with GST $5 and PST $7, paid by card, $56 refunded, a $8 tip."""
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
        db, invoice, TaxResult(10000, 1200, 11200, {"GST": 500, "PST": 700}, [])
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
    await ledger.post_payout(
        db,
        business_id,
        payout_id=f"po_{new_id('payment')}",
        amount=5000,
        currency="CAD",
        arrival_at=MARCH,
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
    assert body["provincial"]["taxable_cents"] == 10000
    assert [m["month"] for m in body["months"]][:3] == ["1999-01", "1999-02", "1999-03"]
    assert len(body["months"]) == 12
    assert body["months"][2]["net_cents"] == 5000
    assert [p["amount_cents"] for p in body["payouts"]] == [5000]
    assert body["payouts"][0]["status"] == "paid"
    assert body["t4a_year"] == 1999
    assert {r["code"] for r in body["rates"]} >= {"GST"}


async def test_export_zip_holds_one_csv_per_report(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _sale(db)
    res = await as_owner.post(
        "/v1/reports/export",
        json={
            "kinds": ["income", "pst", "payouts", "pst"],
            "start": "1999-01-01",
            "end": "1999-12-31",
        },
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        names = zf.namelist()
        assert names == [
            "income-1999-01-01-to-1999-12-31.csv",
            "pst-1999-01-01-to-1999-12-31.csv",
            "payouts-1999-01-01-to-1999-12-31.csv",
        ]
        pst = list(csv.reader(io.StringIO(zf.read(names[1]).decode())))
        assert pst[1][2:4] == ["10000", "350"]
        payouts = list(csv.reader(io.StringIO(zf.read(names[2]).decode())))
        assert payouts[1][1:] == ["1999-03-10", "5000", "paid"]


async def test_every_kind_exports(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _sale(db)
    kinds = ["income", "sales-by-item", "gst-hst", "pst", "t4a", "payouts"]
    res = await as_owner.post(
        "/v1/reports/export", json={"kinds": kinds, "start": "1999-01-01", "end": "1999-12-31"}
    )
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        assert len(zf.namelist()) == 6


async def test_pst_and_payout_csvs(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _sale(db)
    pst = await as_owner.get(f"/v1/reports/pst.csv?{YEAR}")
    assert pst.status_code == 200
    assert pst.text.splitlines()[0] == "code,rate_bps,taxable_sales_cents,collected_cents,number"
    payouts = await as_owner.get(f"/v1/reports/payouts.csv?{YEAR}")
    assert payouts.text.splitlines()[1].endswith(",5000,paid")


async def test_export_without_reports_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/reports/export", json={"kinds": [], "start": "1999-01-01", "end": "1999-12-31"}
    )
    assert res.status_code == 422
    unknown = await as_owner.post(
        "/v1/reports/export", json={"kinds": ["ledger"], "start": "1999-01-01", "end": "1999-12-31"}
    )
    assert unknown.status_code == 422


async def test_staff_cannot_read_or_export_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get(f"/v1/reports/summary?{YEAR}")).status_code == 403
    body = {"kinds": ["income"], "start": "1999-01-01", "end": "1999-12-31"}
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
