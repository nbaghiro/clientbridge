"""Ask Stripe to resend only a genuine succeeded event belonging to this browser fixture."""

import argparse
import asyncio
import json
import os
import subprocess

import stripe

from clientbridge.integrations.stripe import close_stripe_client
from scripts.e2e_stripe_browser import guard
from scripts.e2e_stripe_deposits import deposit_tags, load_deposit
from scripts.e2e_stripe_setup import identity, state_path, tags


def delivery_tags(state: dict[str, object], intent: dict[str, object]) -> dict[str, str]:
    metadata = intent.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("event lacks owned fixture metadata")
    if isinstance(booking_id := metadata.get("booking_id"), str):
        deposit = load_deposit(state, booking_id)
        if metadata.get("invoice_id") or not deposit.customer:
            raise ValueError("ambiguous deposit event lineage")
        customer = deposit.customer
        expected = deposit_tags(str(state["run_id"]), deposit.booking, deposit.client)
    else:
        rows = state.get("fixtures")
        if not isinstance(rows, list):
            raise ValueError("invalid invoice fixture manifest")
        fixture = next((row for row in rows if row["invoice"] == metadata.get("invoice_id")), None)
        if fixture is None:
            raise ValueError("event does not belong to a registered invoice")
        customer = fixture.get("customer")
        expected = tags(str(state["run_id"]), fixture["invoice"], fixture["client"])
    if (
        not isinstance(customer, str)
        or metadata.get("business_id") != state["business"]
        or intent.get("customer") != customer
        or intent.get("amount") != 2000
        or intent.get("currency") != "cad"
    ):
        raise ValueError("event does not belong to the exact registered fixture")
    return expected


async def resend(event_id: str) -> None:
    account = guard()
    state = json.loads(state_path().read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("delivery manifest belongs to another run")
    event = await stripe.Event.retrieve_async(event_id, stripe_account=account)
    payload = event.to_dict()
    if event.livemode or event.type != "payment_intent.succeeded":
        raise ValueError("only a genuine sandbox succeeded event can be redelivered")
    intent = payload["data"]["object"]
    expected = delivery_tags(state, intent)
    customer = await stripe.Customer.retrieve_async(intent["customer"], stripe_account=account)
    if customer.livemode or customer.to_dict().get("metadata") != expected:
        raise ValueError("event customer does not carry exact run ownership")
    # Stripe defaults to the local CLI endpoint when no registered endpoint is specified.
    subprocess.run(
        ["stripe", "events", "resend", event_id, "--account", account, "--confirm"],
        env={**os.environ, "STRIPE_API_KEY": os.environ["STRIPE_TEST_SECRET_KEY"]},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=True,
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("event_id")
    args = parser.parse_args()
    try:
        await resend(args.event_id)
    finally:
        await close_stripe_client()


if __name__ == "__main__":
    asyncio.run(main())
