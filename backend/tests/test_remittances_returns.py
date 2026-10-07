"""GST/HST and PST returns filed apart, with input tax credits, and the filing periods read."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.services import ledger
from clientbridge.services.reports import add_months, due_date, period_of
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory

Q1 = {"period_start": "2021-01-01", "period_end": "2021-03-31"}
IN_Q1 = datetime(2021, 2, 15, 18, tzinfo=UTC)


async def _invoice(
    db: AsyncSession, *, issued_at: datetime, tax: dict[str, int], business_id: str = BIZ
) -> None:
    client_id = (
        (await db.execute(select(Client.id).where(Client.business_id == business_id).limit(1)))
        .scalars()
        .first()
    )
    assert client_id
    total_tax = sum(tax.values())
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=business_id,
        client_id=client_id,
        number=9900 + total_tax,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=total_tax,
        total_cents=10000 + total_tax,
        issued_at=issued_at,
    )
    db.add(invoice)
    await db.flush()
    await ledger.post_invoice(db, invoice, TaxResult(10000, total_tax, 10000 + total_tax, tax, []))
    await db.commit()


async def _balance(db: AsyncSession, category: str, code: str = "") -> int:
    return await ledger.balance(
        db, BIZ, owner_type="business", owner_id=BIZ, category=category, code=code
    )


async def test_gst_with_credits_and_pst_file_apart(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 63895, "PST": 3808})
    set_aside = (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_set_aside_cents"]
    gst, pst, bank, itc = (
        await _balance(db, "tax", "GST"),
        await _balance(db, "tax", "PST"),
        await _balance(db, "bank"),
        await _balance(db, "itc", "GST"),
    )

    federal = await as_owner.post(
        "/v1/payments/remittances",
        json={
            **Q1,
            "family": "federal",
            "itc_cents": 1500,
            "confirmation": "CRA 6601 2290 7731",
            "filed_on": "2021-04-20",
        },
    )
    assert federal.status_code == 201, federal.text
    body = federal.json()
    assert body["by_code"] == {"GST": 63895}
    assert body["itc_cents"] == 1500
    assert body["total_cents"] == 62395
    assert await _balance(db, "tax", "GST") == gst + 63895
    assert await _balance(db, "tax", "PST") == pst
    assert await _balance(db, "itc", "GST") == itc - 1500
    assert await _balance(db, "bank") == bank - 62395

    provincial = await as_owner.post(
        "/v1/payments/remittances",
        json={**Q1, "family": "provincial", "confirmation": "eTaxBC 10-2283-901"},
    )
    assert provincial.status_code == 201, provincial.text
    assert provincial.json()["by_code"] == {"PST": 3808}
    assert provincial.json()["total_cents"] == 3808
    assert await _balance(db, "tax", "PST") == pst + 3808
    assert await _balance(db, "bank") == bank - 62395 - 3808
    after = (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_set_aside_cents"]
    assert set_aside - after == 63895 + 3808


async def test_family_overlap_is_per_family(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500, "PST": 700})
    federal = {**Q1, "family": "federal"}
    assert (await as_owner.post("/v1/payments/remittances", json=federal)).status_code == 201
    again = await as_owner.post(
        "/v1/payments/remittances", json=federal, headers={"Idempotency-Key": "refile"}
    )
    assert again.status_code == 409
    every = await as_owner.post("/v1/payments/remittances", json=Q1)
    assert every.status_code == 409
    provincial = {**Q1, "family": "provincial"}
    assert (await as_owner.post("/v1/payments/remittances", json=provincial)).status_code == 201


async def test_credits_above_collected_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500})
    res = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "federal", "itc_cents": 501}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_itc"


async def test_credits_on_a_provincial_return_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "provincial", "itc_cents": 100}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_itc"


async def test_filed_in_the_future_422(as_owner: httpx.AsyncClient) -> None:
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    res = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "federal", "filed_on": tomorrow}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_filed_on"


async def test_family_with_nothing_owed_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500})
    res = await as_owner.post("/v1/payments/remittances", json={**Q1, "family": "provincial"})
    assert res.status_code == 409


async def _last_period(db: AsyncSession) -> tuple[date, date]:
    tz = (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    start, _ = period_of(datetime.now(ZoneInfo(tz)).date(), "quarterly")
    return period_of(add_months(start, -1), "quarterly")


async def test_filings_list_periods_and_returns(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=True))
    start, end = await _last_period(db)
    mid = datetime.combine(start + timedelta(days=20), datetime.min.time(), tzinfo=UTC)
    await _invoice(db, issued_at=mid, tax={"GST": 4000, "PST": 1200})
    before = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in before["periods"] if p["start"] == start.isoformat())
    assert period["federal_status"] == "due"
    assert period["provincial_status"] == "due"
    assert period["federal_cents"] >= 4000
    assert period["due"] == due_date(end, "quarterly").isoformat()
    assert before["frequency"] == "quarterly"
    assert before["next_due"] is not None

    window = {"period_start": start.isoformat(), "period_end": end.isoformat()}
    filed = await as_owner.post(
        "/v1/payments/remittances",
        json={**window, "family": "federal", "confirmation": "CRA 1"},
    )
    assert filed.status_code == 201, filed.text
    after = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in after["periods"] if p["start"] == start.isoformat())
    assert period["federal_status"] == "filed"
    assert period["provincial_status"] == "due"
    assert period["returns"][0]["confirmation"] == "CRA 1"
    assert (
        after["federal_set_aside_cents"]
        == before["federal_set_aside_cents"] - (filed.json()["by_code"]["GST"])
    )
    summary = (await as_owner.get("/v1/dashboard/summary")).json()
    assert summary["gst_hst_filing_due"] == after["next_due"]


async def test_monthly_filers_get_monthly_periods(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch("/v1/business", json={"filing_frequency": "monthly"})
    assert res.status_code == 200, res.text
    assert res.json()["filing_frequency"] == "monthly"
    kept = await as_owner.patch("/v1/business", json={"filing_frequency": None})
    assert kept.json()["filing_frequency"] == "monthly"
    await _invoice(db, issued_at=datetime.now(UTC) - timedelta(days=40), tax={"GST": 100})
    periods = (await as_owner.get("/v1/payments/remittances")).json()["periods"]
    first, second = periods[0], periods[1]
    assert first["start"][8:] == "01"
    assert date.fromisoformat(second["end"]) + timedelta(days=1) == date.fromisoformat(
        first["start"]
    )


async def test_staff_cannot_read_filings_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/payments/remittances")).status_code == 403


async def test_unauthenticated_401(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/v1/payments/remittances")).status_code == 401


async def test_other_business_returns_stay_apart(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    await factory.client(business=other)
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 777}, business_id=other.id)
    res = await as_owner.post("/v1/payments/remittances", json={**Q1, "family": "federal"})
    assert res.status_code == 409
    filings = (await as_owner.get("/v1/payments/remittances")).json()
    assert all(r["by_code"].get("GST") != 777 for p in filings["periods"] for r in p["returns"])


async def test_replayed_return_posts_once(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500})
    itc = await _balance(db, "itc", "GST")
    headers = {"Idempotency-Key": "file-gst-q1"}
    body = {**Q1, "family": "federal", "itc_cents": 100}
    first = await as_owner.post("/v1/payments/remittances", json=body, headers=headers)
    again = await as_owner.post("/v1/payments/remittances", json=body, headers=headers)
    assert first.status_code == again.status_code == 201
    assert first.json() == again.json()
    assert await _balance(db, "itc", "GST") == itc - 100
