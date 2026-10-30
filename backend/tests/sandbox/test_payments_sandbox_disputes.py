"""Real Stripe disputes: the withdrawal, the outcome and our ledger against Stripe's own books."""

import httpx
import pytest
import stripe
from sqlalchemy.ext.asyncio import AsyncSession
from tests.conftest import BIZ
from tests.sandbox.conftest import StripeEvents, StripeRun, unlocked
from tests.sandbox.test_payments_sandbox import confirm, deliver, open_invoice

from clientbridge.models.payments import Payment
from clientbridge.services import ledger

pytestmark = [pytest.mark.sandbox, pytest.mark.wall_clock]


async def _stripe_ledger(db: AsyncSession) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")


async def _disputed(
    api: httpx.AsyncClient, db: AsyncSession, run: StripeRun, events: StripeEvents
) -> tuple[str, Payment, str, int]:
    invoice_id, _, payment = await open_invoice(api, db, run, events)
    before = await _stripe_ledger(db)
    await confirm(run, payment, "pm_card_createDispute")
    await deliver(api, *(await events.next("payment_intent.succeeded")))
    payload, signature = await events.next("charge.dispute.created", within=120)
    await deliver(api, payload, signature)
    dispute = events.gateway.verify_webhook(payload, signature).data["id"]
    assert isinstance(dispute, str)
    await db.refresh(payment)
    assert payment.dispute_status == "needs_response"
    return invoice_id, payment, dispute, before


async def _stripe_net(run: StripeRun, payment: Payment, dispute: dict[str, object]) -> int:
    """What the charge and its dispute moved in Stripe, from Stripe's balance transactions."""
    assert payment.provider_ref is not None
    provider_ref = payment.provider_ref
    intent = await unlocked(
        lambda: stripe.PaymentIntent.retrieve_async(
            provider_ref,
            expand=["latest_charge.balance_transaction"],
            stripe_account=run.account,
        )
    )
    charge = intent.latest_charge
    assert isinstance(charge, stripe.Charge)
    assert isinstance(charge.balance_transaction, stripe.BalanceTransaction)
    moved = dispute["balance_transactions"]
    assert isinstance(moved, list)
    return charge.balance_transaction.net + sum(int(t["net"]) for t in moved)


async def _close(
    api: httpx.AsyncClient, run: StripeRun, events: StripeEvents, dispute: str, evidence: str
) -> dict[str, object]:
    """Submits Stripe's test evidence and returns the dispute as its closing event carries it."""
    # winning_evidence wins and losing_evidence loses
    await unlocked(
        lambda: stripe.Dispute.modify_async(
            dispute,
            evidence={"uncategorized_text": evidence},
            submit=True,
            stripe_account=run.account,
        )
    )
    payload, signature = await events.next("charge.dispute.closed", within=180)
    await deliver(api, payload, signature)
    return events.gateway.verify_webhook(payload, signature).data


async def test_a_lost_dispute_writes_the_invoice_off_and_matches_stripe(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, payment, dispute, before = await _disputed(as_owner, db, stripe_run, stripe_events)
    closed = await _close(as_owner, stripe_run, stripe_events, dispute, "losing_evidence")
    await db.refresh(payment)
    assert payment.dispute_status == "lost"
    assert (await ledger.collected(db, BIZ, "invoice", invoice_id))[0] == 0
    assert await _stripe_ledger(db) - before == await _stripe_net(stripe_run, payment, closed)


async def test_a_won_dispute_restores_the_payment_and_matches_stripe(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, payment, dispute, before = await _disputed(as_owner, db, stripe_run, stripe_events)
    await _close(as_owner, stripe_run, stripe_events, dispute, "winning_evidence")
    await db.refresh(payment)
    assert payment.dispute_status == "won"
    assert (await ledger.collected(db, BIZ, "invoice", invoice_id))[0] == 2000
    # the reinstatement event carries both the withdrawal and the funds Stripe returned
    payload, signature = await stripe_events.next("charge.dispute.funds_reinstated", within=180)
    reinstated = stripe_events.gateway.verify_webhook(payload, signature).data
    assert await _stripe_ledger(db) - before == await _stripe_net(stripe_run, payment, reinstated)
