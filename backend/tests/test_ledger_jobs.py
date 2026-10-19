"""Nightly reconciliation: the ledger's Stripe balance against Stripe's, per connected account."""

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import AccountBalance
from clientbridge.models.business import Business
from clientbridge.models.platform import Audit
from clientbridge.services import ledger
from clientbridge.services.payments import run_reconcile_payments
from tests.conftest import BIZ, Factory, FakePaymentGateway


async def _connect(db: AsyncSession, business_id: str, account: str) -> None:
    await db.execute(
        update(Business).where(Business.id == business_id).values(stripe_account_id=account)
    )
    await db.flush()


async def _drifts(db: AsyncSession, business_id: str) -> list[Audit]:
    rows = await db.execute(
        select(Audit).where(
            Audit.business_id == business_id, Audit.action == "ledger.transaction_drift"
        )
    )
    return list(rows.scalars().all())


async def _ledger_stripe(db: AsyncSession) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")


async def test_matching_balance_records_no_drift(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recon_ok")
    gateway.balance_cents = await _ledger_stripe(db)
    await run_reconcile_payments(db, gateway)
    assert await _drifts(db, BIZ) == []


async def test_mismatch_is_audited_with_both_figures(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recon_off")
    gateway.transactions["acct_recon_off"] = [
        {"id": "txn_missing", "source": None, "net": -1234, "currency": "cad"}
    ]
    gateway.balances["acct_recon_off"] = AccountBalance(await _ledger_stripe(db) - 1234, 0)
    assert await run_reconcile_payments(db, gateway) == 1
    (drift,) = await _drifts(db, BIZ)
    assert drift.changes == {
        "source": "txn_missing",
        "transaction_ids": ["txn_missing"],
        "ledger_cents": 0,
        "stripe_cents": -1234,
    }
    assert list(await db.scalars(select(Audit).where(Audit.action == "ledger.drift"))) == []


async def test_unconnected_business_is_skipped(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    other = await Factory(db).business()
    gateway.balance_cents = 999
    await run_reconcile_payments(db, gateway)
    assert await _drifts(db, other.id) == []


async def test_cached_balances_match_their_entries(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await ledger.post(
        db,
        BIZ,
        event="invoice",
        ref="job:cache",
        legs=[
            ledger.Leg("client", "cl_x", "receivable", 700),
            ledger.Leg("business", BIZ, "revenue", -700),
        ],
    )
    assert await ledger.stale_accounts(db, BIZ) == []
    await _connect(db, BIZ, "acct_cache")
    gateway.balance_cents = await _ledger_stripe(db)
    await run_reconcile_payments(db, gateway)
    rows = await db.execute(
        select(Audit).where(Audit.business_id == BIZ, Audit.action == "ledger.cache_drift")
    )
    assert rows.scalars().all() == []


async def test_one_provider_failure_does_not_skip_other_businesses(
    db: AsyncSession, gateway: FakePaymentGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _connect(db, BIZ, "acct_unavailable")
    other = await Factory(db).business()
    other.stripe_account_id = "acct_available"
    other_id = other.id
    other.stripe_requirements = {"card_status": "active"}
    await db.commit()
    await db.refresh(other)
    assert other.stripe_account_id == "acct_available"
    assert other.stripe_requirements == {"card_status": "active"}

    async def transactions(account_id: str) -> list[dict[str, object]]:
        if account_id == "acct_unavailable":
            raise httpx.ConnectError("provider unavailable")
        return [{"id": "txn_missing", "source": None, "net": -999, "currency": "cad"}]

    gateway.balance_cents = -999
    monkeypatch.setattr(gateway, "balance_transactions", transactions)
    assert await run_reconcile_payments(db, gateway) >= 1
    assert len(await _drifts(db, other_id)) == 1


async def test_reconciliation_detects_a_ledger_only_stripe_journal(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_local_only")
    gateway.balance_cents = await _ledger_stripe(db)
    await ledger.post(
        db,
        BIZ,
        event="fee",
        ref="fee:local_only",
        legs=[
            ledger.Leg("business", BIZ, "stripe", -500),
            ledger.Leg("business", BIZ, "processing_fee", 500),
        ],
    )
    assert await run_reconcile_payments(db, gateway) == 1
    findings = await _drifts(db, BIZ)
    assert len(findings) == 1
    assert findings[0].entity_id == "balance"
    assert findings[0].changes["stripe_cents"] == gateway.balance_cents
    assert findings[0].changes["ledger_cents"] == gateway.balance_cents - 500
    assert await run_reconcile_payments(db, gateway) == 1
    assert len(await _drifts(db, BIZ)) == 1
