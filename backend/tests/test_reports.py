import csv
import io
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.tax import TaxResult, rates_for_province

BIZ = "bz_birchbark"
WIDE = "start=2000-01-01&end=2100-01-01"
IN_RANGE = datetime(2026, 6, 15, 12, tzinfo=UTC)
OUT_RANGE = datetime(1990, 1, 1, 12, tzinfo=UTC)  # before WIDE start → excluded
IN_2025 = datetime(2025, 6, 15, 12, tzinfo=UTC)
IN_2024 = datetime(2024, 6, 15, 12, tzinfo=UTC)


async def _client_id(db: AsyncSession, biz: str = BIZ) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == biz).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _add_payment(
    db: AsyncSession,
    *,
    amount: int,
    method: str,
    paid_at: datetime,
    biz: str = BIZ,
    order_id: str | None = None,
    refunds: Payment | None = None,
) -> Payment:
    payment = Payment(
        id=new_id("payment"),
        business_id=biz,
        kind="refund" if refunds else "payment",
        parent_payment_id=refunds.id if refunds else None,
        order_id=order_id,
        amount_cents=amount,
        currency="CAD",
        method=method,
        provider="interac" if method == "interac" else "stripe",
        provider_ref=f"pi_{new_id('payment')}",  # full ULID keeps provider_ref unique
        status="succeeded",
        paid_at=paid_at,
    )
    db.add(payment)
    await db.flush()
    if refunds:
        await ledger.post_refund(db, payment, refunds)
    else:
        await ledger.post_payment(db, payment)
    return payment


async def _add_invoice(
    db: AsyncSession, *, number: int, issued_at: datetime, subtotal: int, tax: dict[str, int]
) -> None:
    total_tax = sum(tax.values())
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _client_id(db),
        number=number,
        status="sent",
        currency="CAD",
        subtotal_cents=subtotal,
        tax_total_cents=total_tax,
        total_cents=subtotal + total_tax,
        issued_at=issued_at,
    )
    db.add(invoice)
    await db.flush()
    await ledger.post_invoice(
        db, invoice, TaxResult(subtotal, total_tax, subtotal + total_tax, tax, [])
    )


async def _add_order(db: AsyncSession, *, subtotal: int) -> str:
    order = Order(
        id=new_id("order"),
        business_id=BIZ,
        staff_id="st_owner",
        status="open",
        currency="CAD",
        subtotal_cents=subtotal,
        tax_total_cents=subtotal * 12 // 100,
        total_cents=subtotal + subtotal * 12 // 100,
    )
    db.add(order)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            order_id=order.id,
            description="Retail",
            unit_amount_cents=subtotal,
            amount_cents=subtotal,
        )
    )
    await db.flush()
    return order.id


async def _earn(db: AsyncSession, *, staff_id: str, amount: int, at: datetime, stage: str) -> None:
    """Post one earning for a payee and advance it to `stage` (pending · approved · paid)."""
    ref = new_id("booking")
    journal = await ledger.post(
        db,
        BIZ,
        event="earning",
        ref=f"earning:{ref}:0",
        legs=[
            Leg("business", BIZ, "staff_cost", amount),
            Leg("staff", staff_id, "payable", -amount, "pending"),
        ],
        occurred_at=at,
    )
    if stage == "pending":
        return
    await ledger.post(
        db,
        BIZ,
        event="approval",
        ref=f"approval:{journal}",
        legs=[
            Leg("staff", staff_id, "payable", amount, "pending"),
            Leg("staff", staff_id, "payable", -amount, "approved"),
        ],
        source=("journal", journal or ""),
        occurred_at=at,
    )
    if stage == "paid":
        await ledger.post(
            db,
            BIZ,
            event="staff_payment",
            ref=f"staff_payment:{journal}",
            legs=[
                Leg("staff", staff_id, "payable", amount, "approved"),
                Leg("business", BIZ, "bank", -amount),
            ],
            source=("journal", journal or ""),
            occurred_at=at,
        )


async def _new_payee(db: AsyncSession, *, name: str) -> str:
    user = User(
        id=new_id("user"), email=f"{new_id('user')[3:13].lower()}@test.ca", name=name, oauth={}
    )
    db.add(user)
    await db.flush()
    staff = Staff(
        id=new_id("staff"), business_id=BIZ, user_id=user.id, role="staff", status="active"
    )
    db.add(staff)
    await db.flush()
    return staff.id


def test_rates_for_province_derivation() -> None:
    assert [(r.jurisdiction, r.rate_bps) for r in rates_for_province("BC")] == [
        ("GST", 500),
        ("PST", 700),
    ]
    assert [(r.jurisdiction, r.rate_bps) for r in rates_for_province("ON")] == [("HST", 1300)]
    # a business with no province, or one outside the table, collects no tax (empty, not an error)
    assert rates_for_province(None) == []
    assert rates_for_province("ZZ") == []


async def test_income_summary_nets_payments_and_refunds(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()
    card = await _add_payment(db, amount=10000, method="card", paid_at=IN_RANGE)
    await _add_payment(db, amount=5000, method="interac", paid_at=IN_RANGE)
    await _add_payment(db, amount=2000, method="card", paid_at=IN_RANGE, refunds=card)
    await _add_payment(db, amount=99999, method="card", paid_at=OUT_RANGE)
    after = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()

    assert after["gross_cents"] - before["gross_cents"] == 15000
    assert after["refunds_cents"] - before["refunds_cents"] == 2000
    assert after["net_cents"] - before["net_cents"] == 13000  # out-of-range 99999 excluded
    assert after["by_method"]["card"] - before["by_method"].get("card", 0) == 8000  # 10000 - 2000
    assert after["by_method"]["interac"] - before["by_method"].get("interac", 0) == 5000


async def test_gst_hst_return_splits_tax_by_code(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()
    await _add_invoice(
        db, number=9601, issued_at=IN_RANGE, subtotal=10000, tax={"GST": 500, "PST": 700}
    )
    await _add_invoice(db, number=9602, issued_at=IN_RANGE, subtotal=4000, tax={"HST": 520})
    await _add_invoice(db, number=9603, issued_at=IN_RANGE, subtotal=2000, tax={"QST": 200})
    await _add_invoice(db, number=9604, issued_at=OUT_RANGE, subtotal=8000, tax={"GST": 777})
    after = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()

    # the federal line is GST + HST; PST and QST file separately, each exactly as booked
    assert after["tax_collected_cents"] - before["tax_collected_cents"] == 500 + 520
    assert after["pst_cents"] - before["pst_cents"] == 700
    assert after["qst_cents"] - before["qst_cents"] == 200
    assert after["taxable_sales_cents"] - before["taxable_sales_cents"] == 16000
    assert after["gst_hst_number"] == "84720 1539 RT0001"


async def test_gst_hst_return_includes_order_sales_net_of_refunds(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()
    sold = await _add_order(db, subtotal=5000)
    await _add_order(db, subtotal=3000)  # never paid → no sale on the books
    await _add_payment(db, amount=5600, method="card", paid_at=IN_RANGE, order_id=sold)
    mid = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()

    # BC GST 5% + PST 7% on the $50 sale
    assert mid["tax_collected_cents"] - before["tax_collected_cents"] == 250
    assert mid["pst_cents"] - before["pst_cents"] == 350
    assert mid["taxable_sales_cents"] - before["taxable_sales_cents"] == 5000

    sale = (await db.execute(select(Payment).where(Payment.order_id == sold))).scalar_one()
    await _add_payment(db, amount=5600, method="card", paid_at=IN_RANGE, refunds=sale)
    after = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()
    assert after["tax_collected_cents"] == before["tax_collected_cents"]
    assert after["pst_cents"] == before["pst_cents"]
    assert after["taxable_sales_cents"] == before["taxable_sales_cents"]


async def test_gst_hst_period_bounds_use_business_timezone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    tz = ZoneInfo(
        (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    )
    # 23:00 on the last day of Q2 in the business tz is still Q2 locally, but next-day UTC.
    issued_at = datetime(2026, 6, 30, 23, 0, tzinfo=tz).astimezone(UTC)
    q2, q3 = "start=2026-04-01&end=2026-06-30", "start=2026-07-01&end=2026-09-30"
    q2_before = (await as_owner.get(f"/v1/reports/gst-hst?{q2}")).json()
    q3_before = (await as_owner.get(f"/v1/reports/gst-hst?{q3}")).json()
    await _add_invoice(
        db, number=9610, issued_at=issued_at, subtotal=10000, tax={"GST": 500, "PST": 700}
    )
    q2_after = (await as_owner.get(f"/v1/reports/gst-hst?{q2}")).json()
    q3_after = (await as_owner.get(f"/v1/reports/gst-hst?{q3}")).json()

    assert q2_after["tax_collected_cents"] - q2_before["tax_collected_cents"] == 500
    assert q2_after["pst_cents"] - q2_before["pst_cents"] == 700
    assert q3_after["tax_collected_cents"] == q3_before["tax_collected_cents"]


async def test_t4a_sums_earnings_paid_in_year(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    staff_id = await _new_payee(db, name="Wade Payee")
    await _earn(db, staff_id=staff_id, amount=4000, at=IN_2025, stage="approved")
    await _earn(db, staff_id=staff_id, amount=6000, at=IN_2025, stage="paid")
    await _earn(db, staff_id=staff_id, amount=999, at=IN_2025, stage="pending")
    await _earn(db, staff_id=staff_id, amount=8888, at=IN_2024, stage="approved")

    rows = (await as_owner.get("/v1/reports/t4a?year=2025")).json()
    row = next(r for r in rows if r["staff_id"] == staff_id)
    assert row["total_cents"] == 6000  # paid only; approved-unpaid, pending and prior-year excluded
    assert row["name"] == "Wade Payee"


async def test_t4a_csv_has_header_and_values(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    staff_id = await _new_payee(db, name="Csv Payee")
    await _earn(db, staff_id=staff_id, amount=7000, at=IN_2025, stage="paid")

    res = await as_owner.get("/v1/reports/t4a.csv?year=2025")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    reader = list(csv.reader(io.StringIO(res.text)))
    assert reader[0] == ["staff_id", "name", "total_cents"]
    row = next(r for r in reader[1:] if r[0] == staff_id)
    assert row[1] == "Csv Payee"
    assert row[2] == "7000"


async def test_income_csv_returns_text_csv(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get(f"/v1/reports/income.csv?{WIDE}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=income.csv" in res.headers["content-disposition"]
    reader = list(csv.reader(io.StringIO(res.text)))
    assert reader[0] == ["metric", "amount_cents"]
    assert {row[0] for row in reader[1:]} >= {"gross", "refunds", "net"}


async def test_gst_hst_csv_returns_text_csv(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get(f"/v1/reports/gst-hst.csv?{WIDE}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=gst-hst.csv" in res.headers["content-disposition"]
    reader = list(csv.reader(io.StringIO(res.text)))
    assert reader[0] == [
        "tax_collected_cents",
        "pst_cents",
        "qst_cents",
        "taxable_sales_cents",
        "gst_hst_number",
    ]
    assert reader[1][4] == "84720 1539 RT0001"


@pytest.mark.parametrize(
    "path",
    [
        f"/v1/reports/income?{WIDE}",
        f"/v1/reports/income.csv?{WIDE}",
        f"/v1/reports/gst-hst?{WIDE}",
        f"/v1/reports/gst-hst.csv?{WIDE}",
        "/v1/reports/t4a?year=2025",
        "/v1/reports/t4a.csv?year=2025",
        f"/v1/reports/sales-by-item?{WIDE}",
        f"/v1/reports/sales-by-item.csv?{WIDE}",
        "/v1/dashboard/summary",
    ],
)
async def test_staff_forbidden(as_staff: httpx.AsyncClient, path: str) -> None:
    assert (await as_staff.get(path)).status_code == 403


async def test_other_business_income_excluded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    other = Business(
        id=new_id("business"), name="Rival Co", slug=f"rival-{new_id('business')[3:13].lower()}"
    )
    db.add(other)
    await db.flush()
    before = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()
    await _add_payment(db, amount=50000, method="card", paid_at=IN_RANGE, biz=other.id)
    after = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()
    assert after["gross_cents"] == before["gross_cents"]  # other tenant's payment not counted


async def test_malformed_date_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/reports/income?start=not-a-date&end=2026-01-01")
    assert res.status_code == 422


async def test_inverted_range_yields_empty_window(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # end before start is an empty window: a 200 with zero totals, not an error
    await _add_payment(db, amount=12345, method="card", paid_at=IN_RANGE)
    res = await as_owner.get("/v1/reports/income?start=2026-12-31&end=2026-01-01")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["gross_cents"] == 0 and body["net_cents"] == 0 and body["refunds_cents"] == 0
