import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.payments import Payment, Payout, PayoutAllocation
from clientbridge.models.scheduling import Booking, Session

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _seed_client(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _seed_item(db: AsyncSession) -> str:
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    return iid


def _payout_event(account: str, payout_id: str, amount: int) -> str:
    return json.dumps(
        {
            "id": f"evt_{payout_id}",
            "type": "payout.paid",
            "account": account,
            "data": {"object": {"id": payout_id, "amount": amount, "arrival_date": 1700000000}},
        }
    )


async def test_payout_paid_mirrors_payout(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_po"))
    await db.flush()
    res = await api.post(
        "/webhooks/stripe", content=_payout_event("acct_po", "po_1", 50000), headers=GOOD
    )
    assert res.status_code == 200
    payout = (await db.execute(select(Payout).where(Payout.provider_ref == "po_1"))).scalar_one()
    assert payout.business_id == BIZ
    assert payout.amount_cents == 50000
    assert payout.status == "paid"


async def test_remittance_sums_tax_on_paid_invoices(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    cid = await _seed_client(db)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9200,
        status="paid",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=1200,
        total_cents=11200,
        amount_paid_cents=11200,
        balance_cents=0,
    )
    db.add(inv)
    await db.flush()
    after = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    assert after - before == 1200


async def test_payee_staff_allocation_on_paid_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_alloc", stripe_charges_enabled=True)
    )
    await db.execute(
        update(Staff)
        .where(Staff.id == "st_diego")
        .values(is_payee=True, rate_type="percent", default_rate=60.0)
    )
    await db.flush()
    cid = await _seed_client(db)
    item_id = await _seed_item(db)
    sess = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=item_id,
        staff_id="st_diego",
        starts_at=datetime(2030, 1, 1, 15, tzinfo=UTC),
        ends_at=datetime(2030, 1, 1, 16, tzinfo=UTC),
        capacity=1,
        booked_count=1,
        status="scheduled",
    )
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=sess.id,
        staff_id="st_diego",
        client_id=cid,
        status="confirmed",
        source="manual",
        price_cents=10000,
    )
    db.add(sess)
    await db.flush()  # parent session before its FK-dependent booking
    db.add(booking)
    await db.flush()
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9300,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=0,
        total_cents=10000,
        balance_cents=10000,
    )
    db.add(inv)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            parent_type="invoice",
            parent_id=inv.id,
            description="Service",
            booking_id=booking.id,
            quantity=1,
            unit_amount_cents=10000,
            amount_cents=10000,
            position=0,
        )
    )
    await db.flush()

    pay = (await as_owner.post(f"/v1/payments/invoice/{inv.id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {
            "id": "evt_alloc",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi, "application_fee_amount": 0}},
        }
    )
    await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)

    alloc = (
        await db.execute(select(PayoutAllocation).where(PayoutAllocation.source_id == booking.id))
    ).scalar_one()
    assert alloc.staff_id == "st_diego"
    assert alloc.amount_cents == 6000  # 60% of the $100 line
    assert alloc.basis == "percent"
    assert alloc.status == "pending"
