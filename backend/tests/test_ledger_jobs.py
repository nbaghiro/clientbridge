"""Nightly reconciliation: the ledger's Stripe balance against Stripe's, per connected account."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business
from clientbridge.models.platform import Audit
from clientbridge.services import ledger
from clientbridge.tasks.ledger import run_reconcile_ledger
from tests.conftest import BIZ, Factory, FakePaymentGateway


async def _connect(db: AsyncSession, business_id: str, account: str) -> None:
    await db.execute(
        update(Business).where(Business.id == business_id).values(stripe_account_id=account)
    )
    await db.flush()


async def _drifts(db: AsyncSession, business_id: str) -> list[Audit]:
    rows = await db.execute(
        select(Audit).where(Audit.business_id == business_id, Audit.action == "ledger.drift")
    )
    return list(rows.scalars().all())


async def _ledger_stripe(db: AsyncSession) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")


async def test_matching_balance_records_no_drift(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recon_ok")
    gateway.balance_cents = await _ledger_stripe(db)
    await run_reconcile_ledger(db, gateway)
    assert await _drifts(db, BIZ) == []


async def test_mismatch_is_audited_with_both_figures(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recon_off")
    ours = await _ledger_stripe(db)
    gateway.balance_cents = ours + 1234
    assert await run_reconcile_ledger(db, gateway) >= 1
    (drift,) = await _drifts(db, BIZ)
    assert drift.changes == {"ledger_cents": ours, "stripe_cents": ours + 1234}


async def test_unconnected_business_is_skipped(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    other = await Factory(db).business()
    gateway.balance_cents = 999
    await run_reconcile_ledger(db, gateway)
    assert await _drifts(db, other.id) == []
