"""Hourly reconciliation: the ledger's Stripe balance against Stripe's, per connected account."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import AccountBalance
from clientbridge.models.business import Business
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.services import ledger
from clientbridge.services.payments import run_reconcile_payments
from tests.conftest import BIZ, Factory, FakePaymentGateway
from tests.helpers import client_id


async def _connect(db: AsyncSession, business_id: str, account: str) -> None:
    await db.execute(
        update(Business).where(Business.id == business_id).values(stripe_account_id=account)
    )
    await db.commit()


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

    async def transactions(
        account_id: str, *, since: int | None = None, source: str | None = None
    ) -> list[dict[str, object]]:
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
    assert findings[0].changes == {"residual_cents": 500}
    assert await run_reconcile_payments(db, gateway) == 1
    assert len(await _drifts(db, BIZ)) == 1


async def test_balance_finding_keeps_one_alert_while_both_balances_move(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_moving")
    await _stripe_holds(db, gateway, "acct_moving", 300)
    await run_reconcile_payments(db, gateway)
    await _stripe_journal(db, "fee:moving", 700)
    await _stripe_holds(db, gateway, "acct_moving", 300)
    await run_reconcile_payments(db, gateway)
    (finding,) = await _drifts(db, BIZ)
    assert finding.changes == {"residual_cents": 300}


async def test_a_failing_source_is_found_once_and_explains_the_balance(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_failing")
    await _stripe_holds(db, gateway, "acct_failing", 1234)
    gateway.transactions["acct_failing"] = [
        {"id": "txn_boom", "source": "ch_unreadable", "net": 1234, "currency": "cad"}
    ]
    for _ in range(2):
        await run_reconcile_payments(db, gateway)
    (failed,) = await _findings(db, "ledger.transaction_failed")
    assert failed.entity_id == "ch_unreadable"
    assert failed.changes["stripe_cents"] == 1234
    assert await _drifts(db, BIZ) == []


async def test_each_run_reads_from_its_cursor_with_a_day_of_overlap(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_cursor")
    stamp = int(clock.now().timestamp())
    gateway.transactions["acct_cursor"] = [
        _fee("txn_fee_new", stamp),
        _fee("txn_fee_old", stamp - 60),
    ]
    await _stripe_holds(db, gateway, "acct_cursor", -200)
    await run_reconcile_payments(db, gateway)
    assert await _drifts(db, BIZ) == []
    (cursor,) = await _findings(db, "ledger.reconciled")
    assert cursor.changes == {"transaction_id": "txn_fee_new", "created": stamp}
    await run_reconcile_payments(db, gateway)
    assert await _drifts(db, BIZ) == []
    assert [call for call in gateway.transaction_calls if call[0] == "acct_cursor"] == [
        ("acct_cursor", None, None),
        ("acct_cursor", stamp - 86400, None),
    ]
    assert len(await _findings(db, "ledger.reconciled")) == 1  # an unmoved cursor writes nothing


async def test_a_source_older_than_the_window_is_compared_whole(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_window")
    now = int(clock.now().timestamp())
    created, failed = now - 10 * 86400, now - 3600
    await _cursor(db, now - 600)
    gateway.objects[("acct_window", "payout", "po_old")] = {
        "id": "po_old",
        "amount": 5000,
        "currency": "cad",
        "status": "failed",
        "created": created,
        "arrival_date": created + 86400,
    }
    gateway.transactions["acct_window"] = [
        {
            "id": "txn_po_back",
            "source": "po_old",
            "net": 5000,
            "currency": "cad",
            "created": failed,
        },
        {"id": "txn_po", "source": "po_old", "net": -5000, "currency": "cad", "created": created},
    ]
    await _stripe_holds(db, gateway, "acct_window", 0)
    await run_reconcile_payments(db, gateway)
    assert await _drifts(db, BIZ) == []
    assert ("acct_window", None, "po_old") in gateway.transaction_calls
    returned = await db.scalars(
        select(Entry.occurred_at).where(Entry.ref == "payout:po_old:failed")
    )
    assert {at.timestamp() for at in returned} == {failed}


async def test_an_open_finding_is_checked_again_after_the_window_passes_it(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recheck")
    now = int(clock.now().timestamp())
    old = now - 10 * 86400
    gateway.transactions["acct_recheck"] = [
        _fee("txn_fee_recent", now),
        {"id": "txn_po_late", "source": "po_late", "net": -5000, "currency": "cad", "created": old},
    ]
    await _stripe_holds(db, gateway, "acct_recheck", -5100)
    await run_reconcile_payments(db, gateway)
    assert [finding.entity_id for finding in await _findings(db, "ledger.transaction_failed")] == [
        "po_late"
    ]
    gateway.objects[("acct_recheck", "payout", "po_late")] = {
        "id": "po_late",
        "amount": 5000,
        "currency": "cad",
        "status": "in_transit",
        "created": old,
        "arrival_date": old + 86400,
    }
    await run_reconcile_payments(db, gateway)
    assert ("acct_recheck", None, "po_late") in gateway.transaction_calls
    assert await _drifts(db, BIZ) == []
    assert len(await _findings(db, "ledger.drift_resolved")) == 1


async def test_the_least_recently_reconciled_business_goes_first_within_the_budget(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_recent")
    await _cursor(db, int(clock.now().timestamp()))
    other = await Factory(db).business()
    other.stripe_account_id = "acct_waiting"
    other.stripe_requirements = {"card_status": "active"}
    other_id = other.id
    await db.commit()
    gateway.balances["acct_waiting"] = AccountBalance(0, 0)
    await run_reconcile_payments(db, gateway, budget=timedelta(0))
    reconciled = await db.scalars(
        select(Audit.business_id).where(
            Audit.action == "ledger.reconciled", Audit.business_id.in_((BIZ, other_id))
        )
    )
    assert sorted(reconciled) == sorted([BIZ, other_id])


def _fee(identity: str, created: int) -> dict[str, object]:
    return {
        "id": identity,
        "source": None,
        "type": "stripe_fee",
        "net": -100,
        "currency": "cad",
        "created": created,
    }


async def _cursor(db: AsyncSession, created: int) -> None:
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=BIZ,
            action="ledger.reconciled",
            entity_type="business",
            entity_id=BIZ,
            changes={"transaction_id": "txn_before", "created": created},
        )
    )
    await db.commit()


async def _stripe_journal(db: AsyncSession, ref: str, cents: int) -> None:
    await ledger.post(
        db,
        BIZ,
        event="fee",
        ref=ref,
        legs=[
            ledger.Leg("business", BIZ, "stripe", cents),
            ledger.Leg("business", BIZ, "processing_fee", -cents),
        ],
    )


async def _findings(db: AsyncSession, action: str) -> list[Audit]:
    return list(
        await db.scalars(select(Audit).where(Audit.business_id == BIZ, Audit.action == action))
    )


async def _stripe_holds(
    db: AsyncSession, gateway: FakePaymentGateway, account: str, unbooked: int
) -> None:
    gateway.balances[account] = AccountBalance(await _ledger_stripe(db) + unbooked, 0)


async def test_a_closed_account_is_not_reconciled(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _connect(db, BIZ, "acct_closed_recon")
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_requirements={"disabled_reason": "closed"})
    )
    await db.commit()
    await run_reconcile_payments(db, gateway)
    assert [c for c in gateway.transaction_calls if c[0] == "acct_closed_recon"] == []


async def test_a_failing_business_alerts_once_a_day_not_every_hour(
    db: AsyncSession, gateway: FakePaymentGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _connect(db, BIZ, "acct_down")

    async def unavailable(
        account_id: str, *, since: int | None = None, source: str | None = None
    ) -> list[dict[str, object]]:
        raise httpx.ConnectError("provider unavailable")

    monkeypatch.setattr(gateway, "balance_transactions", unavailable)
    await run_reconcile_payments(db, gateway)
    await run_reconcile_payments(db, gateway)
    assert len(await _findings(db, "ledger.reconciliation_failed")) == 1


async def test_a_pending_refund_is_expected_until_it_settles(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """Stripe debits a PAD refund while it is pending (sandbox check 1); we book it on success."""
    await _connect(db, BIZ, "acct_pad_refund")
    charge = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await client_id(db),
        kind="payment",
        amount_cents=5000,
        currency="CAD",
        method="bank_eft",
        provider="stripe",
        provider_ref="pi_pad_refunded",
        status="succeeded",
        paid_at=clock.now(),
    )
    db.add(charge)
    await db.flush()
    await ledger.post_payment(db, charge)
    refund = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=charge.client_id,
        kind="refund",
        parent_payment_id=charge.id,
        amount_cents=2000,
        currency="CAD",
        method="bank_eft",
        provider="stripe",
        provider_ref="pyr_pad_pending",
        status="pending",
    )
    db.add(refund)
    await db.commit()
    gateway.objects[("acct_pad_refund", "refund", "pyr_pad_pending")] = {
        "id": "pyr_pad_pending",
        "payment_intent": "pi_pad_refunded",
        "amount": 2000,
        "status": "pending",
        "created": int(clock.now().timestamp()),
    }
    gateway.transactions["acct_pad_refund"] = [
        {
            "id": "txn_pad_refund",
            "source": "pyr_pad_pending",
            "type": "payment_refund",
            "status": "pending",
            "amount": -2000,
            "fee": 0,
            "net": -2000,
            "currency": "cad",
            "created": int(clock.now().timestamp()),
        }
    ]
    await _stripe_holds(db, gateway, "acct_pad_refund", -2000)
    await run_reconcile_payments(db, gateway)
    assert await _findings(db, "ledger.transaction_drift") == []
    await _cursor(db, int(clock.now().timestamp()) + 10 * 86400)
    gateway.objects[("acct_pad_refund", "refund", "pyr_pad_pending")]["status"] = "succeeded"
    await run_reconcile_payments(db, gateway)
    assert ("acct_pad_refund", None, "pyr_pad_pending") in gateway.transaction_calls
    await db.refresh(refund)
    assert refund.status == "succeeded"
    assert await _findings(db, "ledger.transaction_drift") == []
