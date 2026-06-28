from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.payments import Payment

BIZ = "bz_birchbark"


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
