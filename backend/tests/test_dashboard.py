from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def _add_payment(db: AsyncSession, *, kind: str, amount: int, paid_at: datetime) -> None:
    cid = await _client_id(db)
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            client_id=cid,
            kind=kind,
            amount_cents=amount,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=f"pi_{new_id('payment')[3:14]}",
            status="succeeded",
            paid_at=paid_at,
        )
    )
    await db.flush()


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def test_summary_returns_three_money_figures(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.get("/v1/dashboard/summary")
    assert res.status_code == 200
    body = res.json()
    assert {"today_revenue_cents", "awaiting_payment_cents", "gst_hst_set_aside_cents"} <= set(body)


async def test_summary_excludes_other_business(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    before = (await as_owner.get("/v1/dashboard/summary")).json()
    # a succeeded payment today in a DIFFERENT business must not inflate our figures
    other = await factory.business()
    other_client = await factory.client(business=other)
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=other.id,
            client_id=other_client.id,
            kind="payment",
            amount_cents=999_00,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=f"pi_{new_id('payment')[3:14]}",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    await db.flush()
    after = (await as_owner.get("/v1/dashboard/summary")).json()
    assert after["today_revenue_cents"] == before["today_revenue_cents"]
    assert after["awaiting_payment_cents"] == before["awaiting_payment_cents"]
    assert after["gst_hst_set_aside_cents"] == before["gst_hst_set_aside_cents"]


async def test_today_revenue_counts_todays_succeeded_payment(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            client_id=await _client_id(db),
            kind="payment",
            amount_cents=5000,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=f"pi_{new_id('payment')[3:14]}",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    await db.flush()
    after = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    assert after - before == 5000


async def test_awaiting_payment_counts_outstanding_balance(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get("/v1/dashboard/summary")).json()["awaiting_payment_cents"]
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _client_id(db),
        number=9500,
        status="sent",
        currency="CAD",
        subtotal_cents=7000,
        tax_total_cents=0,
        total_cents=7000,
        balance_cents=7000,
    )
    db.add(inv)
    await db.flush()
    after = (await as_owner.get("/v1/dashboard/summary")).json()["awaiting_payment_cents"]
    assert after - before == 7000


async def test_staff_cannot_see_dashboard(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/dashboard/summary")).status_code == 403


async def test_refund_today_reduces_revenue(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    before = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    await _add_payment(db, kind="payment", amount=5000, paid_at=datetime.now(UTC))
    await _add_payment(db, kind="refund", amount=1500, paid_at=datetime.now(UTC))
    after = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    assert after - before == 3500  # 5000 received minus 1500 refunded


async def test_old_payment_excluded_from_today(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    await _add_payment(
        db, kind="payment", amount=9999, paid_at=datetime.now(UTC) - timedelta(days=2)
    )
    after = (await as_owner.get("/v1/dashboard/summary")).json()["today_revenue_cents"]
    assert after == before  # paid before today's start → not counted


async def test_filing_date_only_when_tax_registered(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(is_tax_registered=False))
    await db.flush()
    assert (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_filing_due"] is None
    await db.execute(update(Business).where(Business.id == BIZ).values(is_tax_registered=True))
    await db.flush()
    due = (await as_owner.get("/v1/dashboard/summary")).json()["gst_hst_filing_due"]
    assert due is not None and due[4:5] == "-"  # an ISO date string
