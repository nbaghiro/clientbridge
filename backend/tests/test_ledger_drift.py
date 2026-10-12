"""Ways the books can drift from Stripe's balance; each test states the correct outcome."""

import json
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from tests.conftest import BIZ, FakePaymentGateway
from tests.helpers import (
    business_balance,
    client_id,
    enable_payments,
    owner_balance,
    payment,
    payment_by_ref,
    stripe_event,
)

STRIPE = {"Stripe-Signature": "good"}


async def _charge(db: AsyncSession, pi: str, *, status: str = "succeeded") -> Payment:
    row = Payment(
        id=f"pay_{pi}",
        business_id=BIZ,
        client_id=await client_id(db),
        kind="payment",
        amount_cents=8000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=pi,
        status=status,
        paid_at=datetime.now(UTC) if status == "succeeded" else None,
    )
    db.add(row)
    await db.flush()
    if status == "succeeded":
        await ledger.post_payment(db, row)
    return row


def _refund(pi: str, status: str, **extra: object) -> dict[str, object]:
    return {"id": f"re_{pi}", "payment_intent": pi, "amount": 8000, "status": status, **extra}


def _dispute(pi: str, status: str, txns: list[dict[str, object]]) -> dict[str, object]:
    return {
        "id": f"dp_{pi}",
        "payment_intent": pi,
        "amount": 8000,
        "status": status,
        "balance_transactions": txns,
    }


async def test_refund_that_fails_after_succeeding_returns_the_money(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Stripe can fail a card refund up to 30 days after it succeeded; the balance gets it back."""
    await _charge(db, "pi_rf")
    before = await business_balance(db, "stripe")
    await stripe_event(api, "refund.created", _refund("pi_rf", "succeeded"))
    assert await business_balance(db, "stripe") == before - 8000
    await stripe_event(
        api,
        "refund.updated",
        _refund(
            "pi_rf",
            "failed",
            failure_reason="expired_or_canceled_card",
            failure_balance_transaction="txn_rf_back",
        ),
    )
    refund = await payment_by_ref(db, "re_pi_rf")
    assert refund.status == "failed"
    assert await business_balance(db, "stripe") == before


async def test_won_dispute_reinstates_what_stripe_reinstated(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A win returns the amount and the countered fee; the ledger follows Stripe's transactions."""
    await _charge(db, "pi_won")
    before = await business_balance(db, "stripe")
    pulled = {"id": "txn_dp_out", "amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_won", "needs_response", [pulled])
    )
    assert await business_balance(db, "stripe") == before - 9500
    back = {"id": "txn_dp_in", "amount": 8000, "fee": -1500, "net": 9500}
    await stripe_event(api, "charge.dispute.closed", _dispute("pi_won", "won", [pulled, back]))
    assert await business_balance(db, "stripe") == before


async def test_lost_dispute_writes_the_sale_off(api: httpx.AsyncClient, db: AsyncSession) -> None:
    """A lost chargeback is uncollectable: no receivable on the client, no revenue from the sale."""
    row = await _charge(db, "pi_lost")
    assert row.client_id is not None
    revenue = await business_balance(db, "revenue")
    pulled = {"id": "txn_lost_out", "amount": -8000, "fee": 1500, "net": -9500}
    await stripe_event(
        api, "charge.dispute.created", _dispute("pi_lost", "needs_response", [pulled])
    )
    await stripe_event(api, "charge.dispute.closed", _dispute("pi_lost", "lost", [pulled]))
    assert await owner_balance(db, "client", row.client_id, "receivable") == 0
    assert await business_balance(db, "revenue") == revenue + 8000


def _payout(payout_id: str, status: str) -> dict[str, object]:
    arrival = int(datetime(2026, 10, 14, tzinfo=UTC).timestamp())
    return {
        "id": payout_id,
        "amount": 5000,
        "currency": "cad",
        "status": status,
        "arrival_date": arrival,
    }


async def test_payout_leaves_the_stripe_balance_when_created(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Stripe books the payout's balance transaction at creation, days before it is paid."""
    await enable_payments(db)
    before = await business_balance(db, "stripe")
    await stripe_event(api, "payout.created", _payout("po_new", "pending"))
    assert await business_balance(db, "stripe") == before - 5000


async def test_canceled_payout_comes_back(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    before = await business_balance(db, "stripe")
    await stripe_event(api, "payout.created", _payout("po_cxl", "pending"))
    await stripe_event(api, "payout.canceled", _payout("po_cxl", "canceled"))
    assert await ledger.journal_for(db, BIZ, "payout:po_cxl") is not None
    assert await business_balance(db, "stripe") == before


async def test_charge_without_a_readable_balance_transaction_is_retried(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No balance transaction yet means no fee figures; booking the charge gross is wrong."""
    await enable_payments(db)
    pay_id = (await _charge(db, "pi_nofee", status="pending")).id

    async def unreadable(account_id: str, *, payment_intent_id: str) -> ChargeFees | None:
        return None

    monkeypatch.setattr(gateway, "get_payment_fees", unreadable)
    await db.commit()
    body = json.dumps(
        {
            "id": "evt_nofee",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_nofee"}},
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers=STRIPE)
    await db.rollback()
    assert res.status_code == 503
    assert (await payment(db, pay_id)).status == "pending"


async def test_account_balance_cannot_leave_its_entries(db: AsyncSession) -> None:
    """balance_cents is a cache of SUM(entries); nothing may move it on its own."""
    await _charge(db, "pi_cache")
    with pytest.raises(DBAPIError):
        await db.execute(
            text(
                "UPDATE accounts SET balance_cents = balance_cents + 1"
                " WHERE business_id = :biz AND owner_type = 'business'"
                " AND owner_id = :biz AND category = 'stripe'"
            ),
            {"biz": BIZ},
        )
