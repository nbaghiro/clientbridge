"""Filing a sales-tax return moves the period's tax payable to the bank, once per period."""

from datetime import UTC, date, datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.ledger import Entry
from clientbridge.schemas.payments import RemittanceIn
from clientbridge.services import ledger
from clientbridge.services.remittances import RemittanceService
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory

Q1 = {"period_start": "2021-01-01", "period_end": "2021-03-31"}
IN_Q1 = datetime(2021, 2, 15, 18, tzinfo=UTC)


async def _invoice(
    db: AsyncSession, *, business_id: str, client_id: str, number: int, tax: dict[str, int]
) -> None:
    total_tax = sum(tax.values())
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=business_id,
        client_id=client_id,
        number=number,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=total_tax,
        total_cents=10000 + total_tax,
        issued_at=IN_Q1,
    )
    db.add(invoice)
    await db.flush()
    await ledger.post_invoice(db, invoice, TaxResult(10000, total_tax, 10000 + total_tax, tax, []))


async def _q1_tax(db: AsyncSession) -> None:
    client_id = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert client_id
    await _invoice(db, business_id=BIZ, client_id=client_id, number=9801, tax={"GST": 500})
    await _invoice(db, business_id=BIZ, client_id=client_id, number=9802, tax={"PST": 700})
    await db.commit()  # a rejected filing rolls the request back; keep the setup


async def _remittances(db: AsyncSession, business_id: str = BIZ) -> int:
    return (
        await db.execute(
            select(func.count(func.distinct(Entry.journal_id))).where(
                Entry.business_id == business_id, Entry.event == "remittance"
            )
        )
    ).scalar_one()


async def test_filing_moves_tax_payable_to_the_bank(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _q1_tax(db)
    q1 = f"start={Q1['period_start']}&end={Q1['period_end']}"
    payable = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    set_aside = (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_set_aside_cents"]
    report = (await as_owner.get(f"/v1/reports/gst-hst?{q1}")).json()
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")

    res = await as_owner.post("/v1/payments/remittances", json=Q1)
    assert res.status_code == 201, res.text
    assert res.json()["by_code"] == {"GST": 500, "PST": 700}
    assert res.json()["total_cents"] == 1200

    after = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    assert payable - after == 1200
    dash = (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_set_aside_cents"]
    assert set_aside - dash == 1200
    assert (
        await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")
        == bank - 1200
    )
    # the return still reports what was collected; filing it is not a negative sale
    assert (await as_owner.get(f"/v1/reports/gst-hst?{q1}")).json() == report


async def test_overlapping_or_refiled_period_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _q1_tax(db)
    assert (await as_owner.post("/v1/payments/remittances", json=Q1)).status_code == 201
    again = await as_owner.post(
        "/v1/payments/remittances", json=Q1, headers={"Idempotency-Key": "another-filing"}
    )
    assert again.status_code == 409
    overlap = {"period_start": "2021-03-01", "period_end": "2021-05-31"}
    assert (await as_owner.post("/v1/payments/remittances", json=overlap)).status_code == 409
    assert await _remittances(db) == 1


async def test_period_with_no_tax_owed_409(as_owner: httpx.AsyncClient) -> None:
    empty = {"period_start": "2020-01-01", "period_end": "2020-03-31"}
    res = await as_owner.post("/v1/payments/remittances", json=empty)
    assert res.status_code == 409
    assert res.json()["message"] == "no tax is owed for this period"


async def test_period_ending_before_it_starts_422(as_owner: httpx.AsyncClient) -> None:
    backwards = {"period_start": "2021-03-31", "period_end": "2021-01-01"}
    res = await as_owner.post("/v1/payments/remittances", json=backwards)
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_period"


async def test_staff_cannot_file_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _q1_tax(db)
    assert (await as_staff.post("/v1/payments/remittances", json=Q1)).status_code == 403
    assert await _remittances(db) == 0


async def test_replayed_filing_posts_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _q1_tax(db)
    headers = {"Idempotency-Key": "file-q1"}
    first = await as_owner.post("/v1/payments/remittances", json=Q1, headers=headers)
    retry = await as_owner.post("/v1/payments/remittances", json=Q1, headers=headers)
    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert await _remittances(db) == 1


async def test_other_business_tax_is_not_filed(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    stranger = await factory.client(business=other)
    await _invoice(db, business_id=other.id, client_id=stranger.id, number=1, tax={"GST": 9999})
    await _q1_tax(db)
    res = await as_owner.post("/v1/payments/remittances", json=Q1)
    assert res.json()["by_code"] == {"GST": 500, "PST": 700}
    assert await _remittances(db, other.id) == 0


async def test_period_that_has_not_ended_is_422(as_owner: httpx.AsyncClient) -> None:
    today = date.today().isoformat()
    res = await as_owner.post(
        "/v1/payments/remittances", json={"period_start": "2021-01-01", "period_end": today}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_period"


async def test_two_businesses_can_file_the_same_period(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    factory = Factory(db)
    other = await factory.business()
    user = await factory.user()
    staff = await factory.staff(business=other, user=user, role="owner")
    client = await factory.client(business=other)
    await _invoice(db, business_id=other.id, client_id=client.id, number=1, tax={"GST": 300})
    principal = Principal(user_id=user.id, business_id=other.id, staff_id=staff.id, role="owner")
    filed = await RemittanceService(db, principal).record(RemittanceIn.model_validate(Q1), None)
    assert filed.total_cents == 300
    await _q1_tax(db)
    res = await as_owner.post("/v1/payments/remittances", json=Q1)
    assert res.status_code == 201, res.text
