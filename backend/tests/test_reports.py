import csv
import io
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Order, TaxRate
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.payments import Payment, PayoutAllocation
from clientbridge.services.report_service import ReportService

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
    kind: str,
    amount: int,
    method: str,
    paid_at: datetime,
    biz: str = BIZ,
    client_id: str | None = None,
) -> None:
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=biz,
            client_id=client_id,
            kind=kind,
            amount_cents=amount,
            currency="CAD",
            method=method,
            provider="stripe",
            provider_ref=f"pi_{new_id('payment')}",  # full ULID keeps provider_ref unique
            status="succeeded",
            paid_at=paid_at,
        )
    )
    await db.flush()


async def _add_invoice(
    db: AsyncSession,
    *,
    number: int,
    status: str,
    subtotal: int,
    tax: int,
    paid_at: datetime | None,
) -> None:
    db.add(
        Invoice(
            id=new_id("invoice"),
            business_id=BIZ,
            client_id=await _client_id(db),
            number=number,
            status=status,
            currency="CAD",
            subtotal_cents=subtotal,
            tax_total_cents=tax,
            total_cents=subtotal + tax,
            amount_paid_cents=subtotal + tax if status == "paid" else 0,
            balance_cents=0 if status == "paid" else subtotal + tax,
            paid_at=paid_at,
        )
    )
    await db.flush()


async def _add_order(
    db: AsyncSession,
    *,
    status: str,
    subtotal: int,
    tax: int,
    paid_at: datetime | None,
    staff_id: str = "st_owner",
) -> None:
    db.add(
        Order(
            id=new_id("order"),
            business_id=BIZ,
            staff_id=staff_id,
            status=status,
            currency="CAD",
            subtotal_cents=subtotal,
            tax_total_cents=tax,
            total_cents=subtotal + tax,
            amount_paid_cents=subtotal + tax if status == "paid" else 0,
            balance_cents=0 if status == "paid" else subtotal + tax,
            paid_at=paid_at,
        )
    )
    await db.flush()


async def _add_alloc(
    db: AsyncSession, *, staff_id: str, amount: int, status: str, created_at: datetime
) -> None:
    db.add(
        PayoutAllocation(
            id=new_id("payout_allocation"),
            business_id=BIZ,
            staff_id=staff_id,
            source_type="booking",
            source_id=new_id("booking"),
            amount_cents=amount,
            status=status,
            created_at=created_at,
        )
    )
    await db.flush()


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


def test_provincial_split_by_jurisdiction() -> None:
    # BC: GST 5% + PST 7% → $12.00 tax = 500 federal + 700 PST, no QST
    bc = [TaxRate(jurisdiction="GST", rate_bps=500), TaxRate(jurisdiction="PST", rate_bps=700)]
    assert ReportService._provincial_split(1200, bc) == (700, 0)
    # QC: GST 5% + QST 9.975% (computed precisely) → of $14.98, QST ≈ 998, rest federal
    qc = [TaxRate(jurisdiction="GST", rate_bps=500), TaxRate(jurisdiction="QST", rate_bps=998)]
    pst, qst = ReportService._provincial_split(1498, qc)
    assert (pst, qst) == (0, 998)
    # ON: HST-only → nothing provincial (all federal)
    on = [TaxRate(jurisdiction="HST", rate_bps=1300)]
    assert ReportService._provincial_split(1300, on) == (0, 0)


async def test_income_summary_nets_payments_and_refunds(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()
    await _add_payment(db, kind="payment", amount=10000, method="card", paid_at=IN_RANGE)
    await _add_payment(db, kind="payment", amount=5000, method="interac", paid_at=IN_RANGE)
    await _add_payment(db, kind="refund", amount=2000, method="card", paid_at=IN_RANGE)
    await _add_payment(db, kind="payment", amount=99999, method="card", paid_at=OUT_RANGE)
    after = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()

    assert after["gross_cents"] - before["gross_cents"] == 15000
    assert after["refunds_cents"] - before["refunds_cents"] == 2000
    assert after["net_cents"] - before["net_cents"] == 13000  # out-of-range 99999 excluded
    assert after["by_method"]["card"] - before["by_method"].get("card", 0) == 8000  # 10000 - 2000
    assert after["by_method"]["interac"] - before["by_method"].get("interac", 0) == 5000


async def test_gst_hst_return_sums_paid_invoice_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()
    await _add_invoice(db, number=9601, status="paid", subtotal=10000, tax=1200, paid_at=IN_RANGE)
    await _add_invoice(db, number=9602, status="sent", subtotal=4000, tax=500, paid_at=None)
    await _add_invoice(db, number=9603, status="paid", subtotal=8000, tax=777, paid_at=OUT_RANGE)
    after = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()

    # BC = GST 5% + PST 7%; the $12.00 tax splits 500 GST/HST + 700 PST (not all federal)
    assert after["tax_collected_cents"] - before["tax_collected_cents"] == 500
    assert after["pst_cents"] - before["pst_cents"] == 700
    assert after["qst_cents"] - before["qst_cents"] == 0
    assert after["taxable_sales_cents"] - before["taxable_sales_cents"] == 10000
    assert after["gst_hst_number"] == "84720 1539 RT0001"


async def test_gst_hst_return_includes_paid_orders(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()
    await _add_order(db, status="paid", subtotal=5000, tax=600, paid_at=IN_RANGE)
    await _add_order(db, status="open", subtotal=3000, tax=400, paid_at=None)  # unpaid → excluded
    await _add_order(db, status="paid", subtotal=2000, tax=250, paid_at=OUT_RANGE)  # out of range
    after = (await as_owner.get(f"/v1/reports/gst-hst?{WIDE}")).json()

    # the $6.00 order tax splits 250 GST/HST + 350 PST
    assert after["tax_collected_cents"] - before["tax_collected_cents"] == 250
    assert after["pst_cents"] - before["pst_cents"] == 350
    assert after["taxable_sales_cents"] - before["taxable_sales_cents"] == 5000


async def test_gst_hst_period_bounds_use_business_timezone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    tz = ZoneInfo(
        (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    )
    # 23:00 on the last day of Q2 in the business tz is still Q2 locally, but next-day UTC.
    paid_at = datetime(2026, 6, 30, 23, 0, tzinfo=tz).astimezone(UTC)
    q2, q3 = "start=2026-04-01&end=2026-06-30", "start=2026-07-01&end=2026-09-30"
    q2_before = (await as_owner.get(f"/v1/reports/gst-hst?{q2}")).json()
    q3_before = (await as_owner.get(f"/v1/reports/gst-hst?{q3}")).json()
    await _add_invoice(db, number=9610, status="paid", subtotal=10000, tax=1300, paid_at=paid_at)
    q2_after = (await as_owner.get(f"/v1/reports/gst-hst?{q2}")).json()
    q3_after = (await as_owner.get(f"/v1/reports/gst-hst?{q3}")).json()

    # files in Q2 (business tz), not the adjacent Q3 it would land in under UTC bounds
    # 1300 tax splits 542 GST/HST + 758 PST (round(1300*7/12)); Q3 sees nothing
    assert q2_after["tax_collected_cents"] - q2_before["tax_collected_cents"] == 542
    assert q2_after["pst_cents"] - q2_before["pst_cents"] == 758
    assert q3_after["tax_collected_cents"] - q3_before["tax_collected_cents"] == 0


async def test_t4a_sums_payable_allocations_in_year(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    staff_id = await _new_payee(db, name="Wade Payee")
    await _add_alloc(db, staff_id=staff_id, amount=4000, status="approved", created_at=IN_2025)
    await _add_alloc(db, staff_id=staff_id, amount=6000, status="paid", created_at=IN_2025)
    await _add_alloc(db, staff_id=staff_id, amount=999, status="pending", created_at=IN_2025)
    await _add_alloc(db, staff_id=staff_id, amount=8888, status="approved", created_at=IN_2024)

    rows = (await as_owner.get("/v1/reports/t4a?year=2025")).json()
    row = next(r for r in rows if r["staff_id"] == staff_id)
    assert row["total_cents"] == 10000  # approved 4000 + paid 6000; pending & prior-year excluded
    assert row["name"] == "Wade Payee"


async def test_t4a_csv_has_header_and_values(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    staff_id = await _new_payee(db, name="Csv Payee")
    await _add_alloc(db, staff_id=staff_id, amount=7000, status="paid", created_at=IN_2025)

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
    await _add_payment(
        db, kind="payment", amount=50000, method="card", paid_at=IN_RANGE, biz=other.id
    )
    after = (await as_owner.get(f"/v1/reports/income?{WIDE}")).json()
    assert after["gross_cents"] == before["gross_cents"]  # other tenant's payment not counted


async def test_malformed_date_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/reports/income?start=not-a-date&end=2026-01-01")
    assert res.status_code == 422


async def test_inverted_range_yields_empty_window(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # end < start collapses the window to nothing — an otherwise in-range payment is excluded and
    # the report is empty (documented behavior: a 200 with zeroed totals, not an error).
    await _add_payment(db, kind="payment", amount=12345, method="card", paid_at=IN_RANGE)
    res = await as_owner.get("/v1/reports/income?start=2026-12-31&end=2026-01-01")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["gross_cents"] == 0 and body["net_cents"] == 0 and body["refunds_cents"] == 0
