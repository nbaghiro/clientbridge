import csv
import io
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.payments import Payment, PayoutAllocation

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

    assert after["tax_collected_cents"] - before["tax_collected_cents"] == 1200
    assert after["taxable_sales_cents"] - before["taxable_sales_cents"] == 10000
    assert after["gst_hst_number"] == "84720 1539 RT0001"


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
    assert reader[0] == ["tax_collected_cents", "taxable_sales_cents", "gst_hst_number"]
    assert reader[1][2] == "84720 1539 RT0001"


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
