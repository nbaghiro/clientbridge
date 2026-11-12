"""Refund an intent the run owns from Stripe's side, as the Dashboard does, or read its refunds."""

import argparse
import json

import stripe

from clientbridge.core.db import engine
from clientbridge.integrations.stripe import close_stripe_client
from e2e.stripe_context import run_state, validate_context
from e2e.stripe_disputes import owned_intent
from e2e.stripe_evidence import charge_events, charge_evidence


async def refund_action(action: str, intent_id: str, amount: int | None) -> dict[str, object]:
    account = await validate_context()
    _, state = run_state(account)
    charge_id = await owned_intent(account, state, intent_id)
    if action == "create":
        if amount is None:
            raise ValueError("a Stripe-side refund needs an amount")
        await stripe.Refund.create_async(
            payment_intent=intent_id, amount=amount, stripe_account=account
        )
    evidence = await charge_evidence(account, charge_id)
    return {**evidence, "events": await charge_events(account, charge_id, "refund.*")}


async def refunds_main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe refunds")
    parser.add_argument("action", choices=("show", "create"))
    parser.add_argument("intent_id")
    parser.add_argument("amount", nargs="?", type=int)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await refund_action(args.action, args.intent_id, args.amount)))
    finally:
        await close_stripe_client()
        await engine.dispose()
