"""Place the client of an unpaid intent this run owns in Canada, wherever the browser runs."""

import argparse
import json

import stripe
from stripe.params import PaymentIntentModifyParamsShippingAddress

from clientbridge.core.db import engine
from clientbridge.integrations.stripe import close_stripe_client
from e2e.stripe_context import run_state, validate_context
from e2e.stripe_relay import registered_tags

CANADA: PaymentIntentModifyParamsShippingAddress = {
    "line1": "1 Front St W",
    "city": "Toronto",
    "state": "ON",
    "postal_code": "M5V 2T6",
    "country": "CA",
}


async def place_in_canada(intent_id: str) -> dict[str, object]:
    account = await validate_context()
    _, state = run_state(account)
    intent = await stripe.PaymentIntent.retrieve_async(intent_id, stripe_account=account)
    if (
        intent.livemode
        or not isinstance(intent.customer, str)
        or intent.status != "requires_payment_method"
    ):
        raise ValueError("only an unpaid sandbox intent of a customer can be placed")
    registered_tags(state, intent.customer)
    # Stripe offers Klarna by the shipping country before the browser's, and CI runs in the US
    placed = await stripe.PaymentIntent.modify_async(
        intent_id,
        shipping={"name": "QA client", "address": CANADA},
        stripe_account=account,
    )
    return {"intent": placed.id, "country": "CA"}


async def intents_main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe intents")
    parser.add_argument("action", choices=("canada",))
    parser.add_argument("intent_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await place_in_canada(args.intent_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()
