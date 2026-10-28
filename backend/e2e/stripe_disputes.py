"""Open, lose or escalate a dispute on an intent the run owns."""

import argparse
import json

import stripe

from clientbridge.core.db import engine
from clientbridge.integrations.stripe import (
    close_stripe_client,
)
from e2e.stripe_cleanup import submit_evidence
from e2e.stripe_context import run_state, validate_context
from e2e.stripe_evidence import charge_evidence
from e2e.stripe_relay import registered_tags


async def owned_intent(account: str, state: dict[str, object], intent_id: str) -> str:
    """The charge of an intent this run's fixtures own."""
    intent = await stripe.PaymentIntent.retrieve_async(intent_id, stripe_account=account)
    if intent.livemode or not isinstance(intent.customer, str):
        raise ValueError("intent is not a sandbox intent of a customer")
    registered_tags(state, intent.customer)
    if not isinstance(intent.latest_charge, str):
        raise ValueError("the owned intent has no charge")
    return intent.latest_charge


async def dispute_action(action: str, intent_id: str) -> dict[str, object]:
    account = await validate_context()
    _, state = run_state(account)
    charge_id = await owned_intent(account, state, intent_id)
    if action in ("lose", "escalate"):
        listed = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
        disputes = [dispute async for dispute in listed.auto_paging_iter()]
        if len(disputes) != 1:
            raise ValueError("the owned charge does not have exactly one dispute")
        await submit_evidence(
            account, disputes[0], "lose" if action == "lose" else "escalate", str(state["run_id"])
        )
    return await charge_evidence(account, charge_id)


async def disputes_main(argv: list[str]) -> None:
    """Escalate or lose the dispute on an owned charge with Stripe's evidence values, or read it."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe disputes")
    parser.add_argument("action", choices=("show", "escalate", "lose"))
    parser.add_argument("intent_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await dispute_action(args.action, args.intent_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()
