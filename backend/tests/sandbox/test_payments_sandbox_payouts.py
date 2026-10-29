"""A real manual payout: in transit when Stripe creates it, in the bank once Stripe pays it."""

import asyncio

import httpx
import pytest
import stripe
from sqlalchemy.ext.asyncio import AsyncSession
from tests.conftest import BIZ
from tests.sandbox.conftest import StripeEvents, StripeRun
from tests.sandbox.test_payments_sandbox import confirm, deliver, open_invoice

from clientbridge.services import ledger

pytestmark = [pytest.mark.sandbox, pytest.mark.slow, pytest.mark.wall_clock]


async def _balance(db: AsyncSession, category: str) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category=category)


async def _available(run: StripeRun) -> int:
    balance = await stripe.Balance.retrieve_async(stripe_account=run.account)
    return sum(funds.amount for funds in balance.available if funds.currency == "cad")


async def _cover(run: StripeRun, amount: int) -> None:
    """Refunds and lost disputes draw on the pair's balance; top it up so the payout fits."""
    short = amount - await _available(run)
    if short <= 0:
        return
    topup = await stripe.PaymentIntent.create_async(
        amount=short * 2 + 500,
        currency="cad",
        payment_method="pm_card_bypassPending",
        automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
        confirm=True,
        metadata={"clientbridge_qa": run.namespace},
        stripe_account=run.account,
        idempotency_key=f"{run.namespace}:payout-topup",
    )
    assert topup.status == "succeeded"
    # Stripe updates the available balance a few seconds after the charge succeeds
    async with asyncio.timeout(60):
        while await _available(run) < amount:
            await asyncio.sleep(2)


async def test_a_manual_payout_moves_through_transit_to_the_bank(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    account = await stripe.Account.retrieve_async(stripe_run.account)
    payouts = account.settings.payouts if account.settings else None
    interval = payouts.schedule.interval if payouts is not None else "daily"
    await stripe.Account.modify_async(
        stripe_run.account, settings={"payouts": {"schedule": {"interval": "manual"}}}
    )
    try:
        _, _, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
        assert payment.provider_ref is not None
        stripe_run.kept.add(payment.provider_ref)
        # this test card's funds skip the pending balance, so the charge can be paid out at once
        intent = await confirm(stripe_run, payment, "pm_card_bypassPending")
        await deliver(as_owner, *(await stripe_events.next("payment_intent.succeeded")))
        assert isinstance(intent.latest_charge, str)
        charge = await stripe.Charge.retrieve_async(
            intent.latest_charge, expand=["balance_transaction"], stripe_account=stripe_run.account
        )
        assert isinstance(charge.balance_transaction, stripe.BalanceTransaction)
        net = charge.balance_transaction.net
        await _cover(stripe_run, net)
        transit, bank = await _balance(db, "transit"), await _balance(db, "bank")
        payout = await stripe.Payout.create_async(
            amount=net,
            currency="cad",
            stripe_account=stripe_run.account,
            idempotency_key=f"{stripe_run.namespace}:payout",
        )
        stripe_events.owned.add(payout.id)
        await deliver(as_owner, *(await stripe_events.next("payout.created")))
        # test mode may report the payout paid on creation, which books both journals at once
        assert await ledger.journal_for(db, BIZ, f"payout:{payout.id}") is not None
        await deliver(as_owner, *(await stripe_events.next("payout.paid", within=300)))
        assert await ledger.journal_for(db, BIZ, f"payout:{payout.id}:paid") is not None
        assert await _balance(db, "transit") == transit
        assert await _balance(db, "bank") - bank == net
    finally:
        await stripe.Account.modify_async(
            stripe_run.account,
            settings={"payouts": {"schedule": {"interval": interval or "daily"}}},
        )
