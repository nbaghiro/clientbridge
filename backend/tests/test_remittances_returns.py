"""GST/HST and PST returns filed apart, with input tax credits, and the filing periods read."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.schemas.payments import RemittanceIn, TaxFilings
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.remittances import RemittanceService
from clientbridge.services.reports import add_months, due_date, period_of
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, Factory
from tests.helpers import key as retry_key

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
        headers=retry_key(),
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
        headers=retry_key(),
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
    assert (
        await as_owner.post("/v1/payments/remittances", json=federal, headers=retry_key())
    ).status_code == 201
    again = await as_owner.post(
        "/v1/payments/remittances", json=federal, headers={"Idempotency-Key": "refile-q1-federal"}
    )
    assert again.status_code == 409
    every = await as_owner.post("/v1/payments/remittances", json=Q1, headers=retry_key())
    assert every.status_code == 409
    provincial = {**Q1, "family": "provincial"}
    assert (
        await as_owner.post("/v1/payments/remittances", json=provincial, headers=retry_key())
    ).status_code == 201


async def test_credits_above_collected_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500})
    res = await as_owner.post(
        "/v1/payments/remittances",
        json={**Q1, "family": "federal", "itc_cents": 501},
        headers=retry_key(),
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_itc"


async def test_credits_on_a_provincial_return_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/payments/remittances",
        json={**Q1, "family": "provincial", "itc_cents": 100},
        headers=retry_key(),
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_itc"


async def test_filed_in_the_future_422(as_owner: httpx.AsyncClient) -> None:
    tomorrow = (clock.today(UTC) + timedelta(days=2)).isoformat()
    res = await as_owner.post(
        "/v1/payments/remittances",
        json={**Q1, "family": "federal", "filed_on": tomorrow},
        headers=retry_key(),
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_filed_on"


async def test_filed_before_the_period_ended_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/payments/remittances",
        json={**Q1, "family": "federal", "filed_on": Q1["period_end"]},
        headers=retry_key(),
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_filed_on"


async def test_more_refunded_than_collected_files_a_refund_claim(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    gst, bank = await _balance(db, "tax", "GST"), await _balance(db, "bank")
    await ledger.post(
        db,
        BIZ,
        event="refund",
        ref="test:refund-above-tax",
        legs=[Leg("business", BIZ, "tax", 300, "GST"), Leg("business", BIZ, "bank", -300)],
        occurred_at=IN_Q1,
    )
    await db.commit()
    federal = {**Q1, "family": "federal"}
    credits = await as_owner.post(
        "/v1/payments/remittances", json={**federal, "itc_cents": 1}, headers=retry_key()
    )
    assert (credits.status_code, credits.json()["error"]) == (422, "invalid_itc")
    res = await as_owner.post("/v1/payments/remittances", json=federal, headers=retry_key())
    assert res.status_code == 201, res.text
    assert (res.json()["by_code"], res.json()["total_cents"]) == ({"GST": -300}, -300)
    assert (await _balance(db, "tax", "GST"), await _balance(db, "bank")) == (gst, bank)


async def test_a_family_with_nothing_owed_files_a_nil_return(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _invoice(db, issued_at=IN_Q1, tax={"GST": 500})
    gst = await _balance(db, "tax", "GST")
    res = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "provincial"}, headers=retry_key()
    )
    assert res.status_code == 201, res.text
    assert (res.json()["by_code"], res.json()["total_cents"]) == ({}, 0)
    assert await _balance(db, "tax", "GST") == gst
    federal = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "federal"}, headers=retry_key()
    )
    assert federal.status_code == 201 and federal.json()["total_cents"] == 500


async def _last_period(db: AsyncSession) -> tuple[date, date]:
    tz = (await db.execute(select(Business.timezone).where(Business.id == BIZ))).scalar_one()
    start, _ = period_of(clock.today(ZoneInfo(tz)), "quarterly")
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
        headers=retry_key(),
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
    await _invoice(db, issued_at=clock.now() - timedelta(days=40), tax={"GST": 100})
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
    res = await as_owner.post(
        "/v1/payments/remittances", json={**Q1, "family": "federal"}, headers=retry_key()
    )
    assert res.status_code == 201, res.text
    assert (res.json()["by_code"], res.json()["total_cents"]) == ({}, 0)
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


async def _federal(api: httpx.AsyncClient, start: date) -> tuple[str, str | None]:
    body = (await api.get("/v1/payments/remittances")).json()
    period = next(p for p in body["periods"] if p["start"] == start.isoformat())
    return period["federal_status"], body["next_due"]


async def test_a_one_day_return_leaves_the_rest_of_its_period_due(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=True))
    start, end = await _last_period(db)
    first_day = datetime.combine(start, datetime.min.time(), tzinfo=UTC) + timedelta(hours=20)
    await _invoice(db, issued_at=first_day, tax={"GST": 300})
    await _invoice(db, issued_at=first_day + timedelta(days=30), tax={"GST": 4000})
    status, due = await _federal(as_owner, start)
    assert (status, due) == ("due", due_date(end, "quarterly").isoformat())

    one_day = {"period_start": start.isoformat(), "period_end": start.isoformat()}
    filed = await as_owner.post(
        "/v1/payments/remittances", json={**one_day, "family": "federal"}, headers=retry_key()
    )
    assert filed.status_code == 201, filed.text
    assert await _federal(as_owner, start) == (status, due)

    rest = {
        "period_start": (start + timedelta(days=1)).isoformat(),
        "period_end": end.isoformat(),
        "family": "federal",
    }
    assert (
        await as_owner.post("/v1/payments/remittances", json=rest, headers=retry_key())
    ).status_code == 201
    status, due = await _federal(as_owner, start)
    assert status == "filed"
    assert due != due_date(end, "quarterly").isoformat()


async def test_a_nil_return_files_a_period_with_no_tax(db: AsyncSession, factory: Factory) -> None:
    other = await factory.business()
    other.tax_registered = True
    user = await factory.user()
    staff = await factory.staff(business=other, user=user, role="owner")
    await factory.client(business=other)
    principal = Principal(user_id=user.id, business_id=other.id, staff_id=staff.id, role="owner")
    await _invoice(
        db, issued_at=datetime(2026, 5, 15, 18, tzinfo=UTC), tax={"GST": 500}, business_id=other.id
    )
    service = RemittanceService(db, principal)
    q2 = {"period_start": "2026-04-01", "period_end": "2026-06-30", "family": "federal"}
    q3 = {"period_start": "2026-07-01", "period_end": "2026-09-30", "family": "federal"}
    assert (await service.record(RemittanceIn.model_validate(q2), None)).total_cents == 500

    def status(filings: TaxFilings, start: str) -> str:
        return next(p.federal_status for p in filings.periods if p.start.isoformat() == start)

    before = await service.filings()
    assert status(before, "2026-07-01") == "due"
    assert before.next_due == due_date(date(2026, 9, 30), "quarterly")
    bank = await ledger.balance(
        db, other.id, owner_type="business", owner_id=other.id, category="bank"
    )

    nil = await service.record(RemittanceIn.model_validate(q3), None)
    assert (nil.total_cents, nil.by_code, nil.itc_cents) == (0, {}, 0)
    after = await service.filings()
    assert status(after, "2026-07-01") == "filed"
    assert after.next_due == due_date(date(2026, 12, 31), "quarterly")
    filed = next(r for r in await service.filed_returns() if r.period_start == date(2026, 7, 1))
    assert (filed.by_code, filed.paid_cents, filed.family) == ({}, 0, "federal")
    assert (
        await ledger.balance(
            db, other.id, owner_type="business", owner_id=other.id, category="bank"
        )
        == bank
    )
    with pytest.raises(Conflict):
        await service.record(RemittanceIn.model_validate(q3), None)


def _unfiled(filings: dict[str, list[dict[str, object]]], family: str) -> int:
    return sum(
        int(str(p[f"{family}_cents"]))
        for p in filings["periods"]
        if p[f"{family}_status"] != "filed"
    )


async def test_tax_dated_into_a_filed_period_goes_on_the_next_return(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    start, end = await _last_period(db)
    mid = datetime.combine(start + timedelta(days=20), datetime.min.time(), tzinfo=UTC)
    await _invoice(db, issued_at=mid, tax={"GST": 4000})
    window = {"period_start": start.isoformat(), "period_end": end.isoformat()}
    filed = await as_owner.post(
        "/v1/payments/remittances", json={**window, "family": "federal"}, headers=retry_key()
    )
    assert filed.status_code == 201, filed.text
    before = (await as_owner.get("/v1/payments/remittances")).json()

    # a renewal paid after its period was filed is dated to the period's start
    await _invoice(db, issued_at=mid, tax={"GST": 500, "PST": 300})
    after = (await as_owner.get("/v1/payments/remittances")).json()
    renewal = (
        await db.execute(
            select(Invoice.id).where(Invoice.business_id == BIZ, Invoice.number == 9900 + 800)
        )
    ).scalar_one()
    legs = (
        await db.execute(
            select(Account.category, Account.code, Entry.occurred_at)
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.ref == f"invoice:{renewal}")
        )
    ).all()
    assert {"tax", "revenue"} <= {category for category, _, _ in legs}
    # only the filed GST moves to the return in progress; the sale and its PST stay on their day
    for category, code, at in legs:
        assert (at.date() > end) == (category == "tax" and code == "GST"), (category, code)
    filed_period = next(p for p in after["periods"] if p["start"] == start.isoformat())
    assert filed_period["federal_status"] == "filed"
    assert filed_period["federal_cents"] == filed.json()["by_code"]["GST"]
    assert after["periods"][0]["federal_cents"] == before["periods"][0]["federal_cents"] + 500
    assert (
        filed_period["provincial_cents"]
        == next(p for p in before["periods"] if p["start"] == start.isoformat())["provincial_cents"]
        + 300
    )
    for family in ("federal", "provincial"):
        assert after[f"{family}_set_aside_cents"] == _unfiled(after, family)

    # PST in that period isn't filed yet, so PST dated into it stays there
    await _invoice(db, issued_at=mid, tax={"PST": 200})
    last = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in last["periods"] if p["start"] == start.isoformat())
    assert period["provincial_cents"] == filed_period["provincial_cents"] + 200
    for family in ("federal", "provincial"):
        assert last[f"{family}_set_aside_cents"] == _unfiled(last, family)


async def test_a_refund_claim_left_after_part_of_a_period_is_filed_stays_due(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    start, end = await _last_period(db)
    second = add_months(start, 1)
    at = datetime.combine(start + timedelta(days=5), datetime.min.time(), tzinfo=UTC)
    await _invoice(db, issued_at=at + timedelta(hours=20), tax={"GST": 1000})
    await ledger.post(
        db,
        BIZ,
        event="refund",
        ref="test:refund-after-part",
        legs=[
            # more than the seed collects in the rest of the period
            Leg("business", BIZ, "tax", 1_000_000, "GST"),
            Leg("business", BIZ, "bank", -1_000_000),
        ],
        occurred_at=datetime.combine(second + timedelta(days=5), datetime.min.time(), tzinfo=UTC)
        + timedelta(hours=20),
    )
    await db.commit()
    month = {
        "period_start": start.isoformat(),
        "period_end": (second - timedelta(days=1)).isoformat(),
        "family": "federal",
    }
    part = await as_owner.post("/v1/payments/remittances", json=month, headers=retry_key())
    assert part.status_code == 201, part.text
    filings = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in filings["periods"] if p["start"] == start.isoformat())
    # the rest of the period claims tax back, so it is still due rather than filed
    assert (period["federal_status"], period["federal_cents"] < 0) == ("due", True)
    assert filings["federal_set_aside_cents"] == _unfiled(filings, "federal")

    whole = {"period_start": start.isoformat(), "period_end": end.isoformat(), "family": "federal"}
    rest = await as_owner.post("/v1/payments/remittances", json=whole, headers=retry_key())
    assert rest.status_code == 201, rest.text
    assert rest.json()["total_cents"] == period["federal_cents"]
    after = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in after["periods"] if p["start"] == start.isoformat())
    assert period["federal_status"] == "filed"
    assert after["federal_set_aside_cents"] == _unfiled(after, "federal")


async def test_a_partly_filed_period_owes_and_files_only_the_rest(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    start, end = await _last_period(db)
    first_month_end = add_months(start, 1) - timedelta(days=1)
    for days, pst in ((5, 700), (40, 300)):
        at = datetime.combine(start + timedelta(days=days), datetime.min.time(), tzinfo=UTC)
        await _invoice(db, issued_at=at + timedelta(hours=20), tax={"PST": pst})
    family = {"family": "provincial"}
    month = {"period_start": start.isoformat(), "period_end": first_month_end.isoformat()}
    part = await as_owner.post(
        "/v1/payments/remittances", json={**month, **family}, headers=retry_key()
    )
    assert part.status_code == 201, part.text
    filings = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in filings["periods"] if p["start"] == start.isoformat())
    assert period["provincial_status"] == "due"
    assert filings["provincial_set_aside_cents"] == _unfiled(filings, "provincial")

    whole = {"period_start": start.isoformat(), "period_end": end.isoformat(), **family}
    rest = await as_owner.post("/v1/payments/remittances", json=whole, headers=retry_key())
    assert rest.status_code == 201, rest.text
    assert rest.json()["period_start"] == (first_month_end + timedelta(days=1)).isoformat()
    assert rest.json()["total_cents"] == period["provincial_cents"]
    again = await as_owner.post("/v1/payments/remittances", json=whole, headers=retry_key())
    assert (again.status_code, again.json()["error"]) == (409, "return_filed")
    inside = await as_owner.post(
        "/v1/payments/remittances", json={**month, **family}, headers=retry_key()
    )
    assert (inside.status_code, inside.json()["error"]) == (409, "return_filed")
    after = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in after["periods"] if p["start"] == start.isoformat())
    assert period["provincial_status"] == "filed"
    assert after["provincial_set_aside_cents"] == _unfiled(after, "provincial")


async def test_returns_inside_a_period_leave_gaps_that_file_together(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    start, end = await _last_period(db)
    second = add_months(start, 1)
    third = add_months(start, 2)
    for first_day, gst in ((start, 1000), (second, 400), (third, 500)):
        at = datetime.combine(first_day + timedelta(days=5), datetime.min.time(), tzinfo=UTC)
        await _invoice(db, issued_at=at + timedelta(hours=20), tax={"GST": gst})
    middle = {
        "period_start": second.isoformat(),
        "period_end": (third - timedelta(days=1)).isoformat(),
        "family": "federal",
    }
    inside = await as_owner.post("/v1/payments/remittances", json=middle, headers=retry_key())
    assert inside.status_code == 201, inside.text
    filings = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in filings["periods"] if p["start"] == start.isoformat())
    assert period["federal_status"] == "due"
    assert filings["federal_set_aside_cents"] == _unfiled(filings, "federal")

    whole = {"period_start": start.isoformat(), "period_end": end.isoformat(), "family": "federal"}
    remaining = period["federal_cents"]
    over = await as_owner.post(
        "/v1/payments/remittances",
        json={**whole, "itc_cents": remaining + 1},
        headers=retry_key(),
    )
    assert (over.status_code, over.json()["error"]) == (422, "invalid_itc")
    credits = remaining - 100
    rest = await as_owner.post(
        "/v1/payments/remittances",
        json={**whole, "itc_cents": credits, "confirmation": "CRA-REST"},
        headers=retry_key(),
    )
    assert rest.status_code == 201, rest.text
    body = rest.json()
    assert (body["period_start"], body["period_end"]) == (start.isoformat(), end.isoformat())
    assert (body["itc_cents"], body["total_cents"]) == (credits, 100)

    after = (await as_owner.get("/v1/payments/remittances")).json()
    period = next(p for p in after["periods"] if p["start"] == start.isoformat())
    assert period["federal_status"] == "filed"
    assert after["federal_set_aside_cents"] == _unfiled(after, "federal")
    first, last = sorted(
        (r["period_start"], r["by_code"]["GST"], r["itc_cents"])
        for r in period["returns"]
        if r["confirmation"] == "CRA-REST"
    )
    assert (first[0], last[0]) == (start.isoformat(), third.isoformat())
    # the credits go against the earlier gap's tax first, the rest against the later one
    assert first[2] == min(credits, first[1])
    assert last[2] == credits - first[2]
