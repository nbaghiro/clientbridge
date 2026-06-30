"""Payout-allocation lifecycle (approve → pay), against the seeded DB."""

import json

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payout, PayoutAllocation
from clientbridge.models.platform import AuditLog
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def _alloc(
    db: AsyncSession,
    *,
    business_id: str = BIZ,
    staff_id: str = "st_diego",
    status: str = "pending",
) -> PayoutAllocation:
    alloc = PayoutAllocation(
        id=new_id("payout_allocation"),
        business_id=business_id,
        staff_id=staff_id,
        source_type="booking",
        source_id=new_id("booking"),
        basis="percent",
        rate=60.0,
        amount_cents=6000,
        status=status,
    )
    db.add(alloc)
    await db.flush()
    return alloc


async def test_approve_then_pay(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db)
    approved = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["amount_cents"] == 6000

    paid = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/pay")
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "paid"
    assert paid.json()["staff_id"] == "st_diego"


async def test_approve_unknown_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/payouts/allocations/pal_nope/approve")
    assert res.status_code == 404


async def test_approve_non_pending_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db, status="paid")
    res = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve")
    assert res.status_code == 409


async def test_pay_before_approve_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db)
    res = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/pay")
    assert res.status_code == 409


async def test_staff_cannot_approve_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db)
    res = await as_staff.post(f"/v1/payouts/allocations/{alloc.id}/approve")
    assert res.status_code == 403


async def test_other_business_allocation_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    alloc = await _alloc(db, business_id=other.id, staff_id=staff.id)
    res = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve")
    assert res.status_code == 404


async def test_idempotent_approve_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db)
    headers = {"Idempotency-Key": "pal-approve-1"}
    first = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve", headers=headers)
    second = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve", headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert second.json()["status"] == "approved"


async def test_idempotent_pay_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    alloc = await _alloc(db)
    assert (await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/approve")).status_code == 200
    headers = {"Idempotency-Key": "pal-pay-1"}
    first = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/pay", headers=headers)
    second = await as_owner.post(f"/v1/payouts/allocations/{alloc.id}/pay", headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json() == second.json()
    assert second.json()["status"] == "paid"
    # the replay didn't re-run the money-moving body — exactly one "payout.pay" audit row
    paid_audits = (
        await db.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.entity_id == alloc.id, AuditLog.action == "payout.pay")
        )
    ).scalar_one()
    assert paid_audits == 1


async def test_payout_paid_links_settled_allocations(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_link")
    )
    await db.flush()
    approved = await _alloc(db, status="approved")
    paid = await _alloc(db, status="paid")
    pending = await _alloc(db, status="pending")
    event = json.dumps(
        {
            "id": "evt_payout_link",
            "type": "payout.paid",
            "account": "acct_link",
            "data": {"object": {"id": "po_link", "amount": 12000, "arrival_date": 1700000000}},
        }
    )
    res = await as_owner.post(
        "/webhooks/stripe", content=event, headers={"Stripe-Signature": "good"}
    )
    assert res.status_code == 200, res.text
    payout = (await db.execute(select(Payout).where(Payout.provider_ref == "po_link"))).scalar_one()
    for alloc_id, expected in ((approved.id, payout.id), (paid.id, payout.id), (pending.id, None)):
        linked = (
            await db.execute(
                select(PayoutAllocation.payout_id).where(PayoutAllocation.id == alloc_id)
            )
        ).scalar_one()
        assert linked == expected
