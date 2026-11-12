"""Read the leased QA merchant for browser cases, and put back what a case changed on it."""

import argparse
import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import replace

import stripe

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import RequirementError, StripeGateway, close_stripe_client
from clientbridge.models.business import Business
from clientbridge.services.business import apply_account_status, kyc_status
from e2e.stripe_context import BUSINESS, guard, validate_context


def _dict(value: object) -> dict[str, object]:
    return {str(key): item for key, item in value.items()} if isinstance(value, dict) else {}


async def intent(intent_id: str) -> dict[str, object]:
    account = guard()
    found = await stripe.PaymentIntent.retrieve_async(intent_id, stripe_account=account)
    if found.livemode:
        raise ValueError("live payment evidence is forbidden")
    metadata = _dict(found.to_dict().get("metadata"))
    if metadata.get("business_id") != BUSINESS:
        raise ValueError("intent belongs to another business")
    return {
        "id": found.id,
        "status": found.status,
        "amount": found.amount,
        "currency": found.currency,
        "metadata": metadata,
        "charge": found.latest_charge if isinstance(found.latest_charge, str) else None,
        "cancellation_reason": found.cancellation_reason,
    }


async def balance() -> dict[str, object]:
    account = guard()
    found = await stripe.Balance.retrieve_async(stripe_account=account)
    if found.livemode:
        raise ValueError("live balance evidence is forbidden")

    def cad(rows: list[stripe.Balance.Available] | list[stripe.Balance.Pending]) -> int:
        return sum(row.amount for row in rows if row.currency == "cad")

    return {"available": cad(found.available), "pending": cad(found.pending)}


# a whole run's refunds and lost disputes (about $90 by STR-E08) draw on it before STR-E08 pays out
PAYOUT_FLOAT_CENTS = 30000


async def fund() -> dict[str, object]:
    """Top the available balance up to the payout float with a charge that skips pending."""
    funded = 0
    # the balance gains each charge's net, so a charge for the shortfall can land short of the float
    for _ in range(3):
        before = await balance()
        available = before["available"]
        if not isinstance(available, int):
            raise ValueError("balance has no available amount")
        short = PAYOUT_FLOAT_CENTS - available
        if short <= 0:
            return {"funded_cents": funded, **before}
        # a margin for the fee, and never under Stripe's 50-cent minimum charge
        amount = max(short + short // 20 + 50, 100)
        intent = await stripe.PaymentIntent.create_async(
            amount=amount,
            currency="cad",
            payment_method="pm_card_bypassPending",
            automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
            confirm=True,
            metadata={"clientbridge_qa": "payout-float"},
            stripe_account=guard(),
        )
        if intent.livemode or intent.status != "succeeded":
            raise ValueError(f"the payout float charge did not succeed: {intent.status}")
        funded += amount
        await _landed(available)
    raise ValueError("the payout float charges never brought the balance up to the float")


async def _landed(before: int) -> None:
    for _ in range(30):
        available = (await balance())["available"]
        if isinstance(available, int) and available > before:
            return
        # Stripe's balance shows the charge a few seconds after it succeeds
        await asyncio.sleep(2)
    raise ValueError("the payout float charge never reached the available balance")


async def charge(charge_id: str) -> dict[str, object]:
    account = guard()
    found = await stripe.Charge.retrieve_async(
        charge_id, expand=["balance_transaction"], stripe_account=account
    )
    transaction = found.balance_transaction
    if found.livemode or not isinstance(transaction, stripe.BalanceTransaction):
        raise ValueError("charge has no test-mode balance transaction")
    return {
        "id": found.id,
        "amount": found.amount,
        "method": _dict(found.to_dict().get("payment_method_details")).get("type"),
        "balance_transaction": transaction.id,
        "net": transaction.net,
        "fee": transaction.fee,
        "status": transaction.status,
    }


async def payout(payout_id: str) -> dict[str, object]:
    account = guard()
    found = await stripe.Payout.retrieve_async(payout_id, stripe_account=account)
    if found.livemode:
        raise ValueError("live payout evidence is forbidden")
    return {
        "id": found.id,
        "amount": found.amount,
        "currency": found.currency,
        "status": found.status,
        "automatic": found.automatic,
        "method": found.method,
        "arrival_date": found.arrival_date,
    }


async def payouts() -> dict[str, object]:
    account = guard()
    listed = await stripe.Payout.list_async(limit=20, stripe_account=account)
    if any(item.livemode for item in listed.data):
        raise ValueError("live payout evidence is forbidden")
    return {
        "payouts": [
            {"id": item.id, "status": item.status, "arrival_date": item.arrival_date}
            for item in listed.data
        ]
    }


async def schedule() -> dict[str, object]:
    account = guard()
    found = await stripe.Account.retrieve_async(account)
    payouts = _dict(_dict(found.to_dict().get("settings")).get("payouts"))
    return _dict(payouts.get("schedule"))


async def restore_schedule(interval: str) -> dict[str, object]:
    account = await validate_context()
    if interval not in ("daily", "weekly", "monthly"):
        raise ValueError("restore only an automatic schedule")
    await stripe.Account.modify_async(
        account, settings={"payouts": {"schedule": {"interval": interval}}}
    )
    return await schedule()


async def manual_schedule() -> dict[str, object]:
    account = await validate_context()
    await stripe.Account.modify_async(
        account, settings={"payouts": {"schedule": {"interval": "manual"}}}
    )
    return await schedule()


async def pay_out(amount: str) -> dict[str, object]:
    """A manual payout by API, since Stripe's component hides Pay out until the last one lands."""
    account = await validate_context()
    if not amount.isdigit() or int(amount) <= 0:
        raise ValueError("a payout needs a positive amount in cents")
    created = await stripe.Payout.create_async(
        amount=int(amount),
        currency="cad",
        metadata={"clientbridge_qa": "payout-case"},
        stripe_account=account,
    )
    if created.livemode:
        raise ValueError("live payouts are forbidden")
    return await payout(created.id)


async def account() -> dict[str, object]:
    found = guard()
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    status = await gateway.get_account(found)
    return {
        "charges_enabled": status.charges_enabled,
        "payouts_enabled": status.payouts_enabled,
        "past_due": status.past_due,
        "currently_due": status.currently_due,
        "disabled_reason": status.disabled_reason,
    }


async def banks() -> dict[str, object]:
    account = guard()
    found = await stripe.Account.list_external_accounts_async(
        account, object="bank_account", limit=100
    )
    return {
        "banks": [
            {"id": bank.id, "last4": bank.last4, "default": bank.default_for_currency}
            for bank in found.data
        ]
    }


async def mirror(state: str) -> dict[str, object]:
    """Mirror a paused, held, rejected or bank state onto the run's business, or read it back."""
    account = await validate_context()
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS, with_for_update=True)
        if business is None or business.stripe_account_id != account:
            raise ValueError("the run's business is not bound to the leased merchant")
        status = await gateway.get_account(account)
        if state == "paused":
            status = replace(
                status, payouts_enabled=False, past_due=["external_account"], current_deadline=None
            )
        elif state == "held":
            # held by Stripe with nothing for the business to send
            status = replace(
                status,
                payouts_enabled=False,
                currently_due=[],
                past_due=[],
                current_deadline=None,
                payouts_hold="restricted_other",
            )
        elif state == "rejected":
            # Stripe judged the SIN and still takes payments while it waits for another
            status = replace(
                status,
                currently_due=["identity.individual.id_numbers"],
                past_due=[],
                current_deadline=None,
                requirement_errors=(
                    RequirementError(
                        "identity.individual.id_numbers", "verification_failed_id_number_match"
                    ),
                ),
            )
        elif state == "declined":
            # Stripe errors the bank a payout failed to and leaves the payouts capability on
            status = replace(status, payouts_enabled=False, bank_errored=True)
        elif state == "foreign":
            # every bank in another currency, which Stripe converts payouts into
            status = replace(status, foreign_bank=True)
        apply_account_status(business, status)
        await db.commit()
        return {
            "kyc_status": kyc_status(business),
            "payouts_enabled": business.stripe_payouts_enabled,
            "past_due": business.stripe_requirements.get("past_due"),
        }


COMMANDS: dict[str, Callable[[argparse.Namespace], Awaitable[dict[str, object]]]] = {
    "account": lambda _: account(),
    "banks": lambda _: banks(),
    "intent": lambda args: intent(args.id),
    "charge": lambda args: charge(args.id),
    "payout": lambda args: payout(args.id),
    "payouts": lambda _: payouts(),
    "balance": lambda _: balance(),
    "fund": lambda _: fund(),
    "schedule": lambda _: schedule(),
    "restore-schedule": lambda args: restore_schedule(args.id),
    "manual-schedule": lambda _: manual_schedule(),
    "pay-out": lambda args: pay_out(args.id),
    "mirror": lambda args: mirror(args.id),
}


async def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.merchant")
    parser.add_argument("command", choices=sorted(COMMANDS))
    parser.add_argument("id", nargs="?", default="")
    args = parser.parse_args()
    if args.command == "mirror" and args.id not in (
        "paused",
        "held",
        "rejected",
        "declined",
        "foreign",
        "stripe",
    ):
        parser.error("mirror takes paused, held, rejected, declined, foreign or stripe")
    try:
        print(json.dumps(await COMMANDS[args.command](args)))
    finally:
        await close_stripe_client()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
