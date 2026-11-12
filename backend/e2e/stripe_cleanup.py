"""Put an owned payment intent back: settle its disputes, then refund or cancel it."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Literal

import stripe

# a refund that failed for one of these leaves Stripe refusing any later refund to the card
CARD_REFUSALS = ("expired_or_canceled_card", "lost_or_stolen_card")

type Verdict = Literal["lose", "win", "escalate", "close"]

# Stripe's sandbox evidence values; winning evidence on an inquiry closes it without escalating
EVIDENCE: dict[Verdict, str] = {
    "lose": "losing_evidence",
    "win": "winning_evidence",
    "escalate": "escalate_inquiry_evidence",
    "close": "winning_evidence",
}
INQUIRY: tuple[Verdict, ...] = ("escalate", "close")
# the statuses a dispute may already be in when its verdict is asked for again
PENDING: dict[Verdict, tuple[str, ...]] = {
    "lose": ("under_review", "won", "lost"),
    "win": ("under_review", "won", "lost"),
    "escalate": (),
    "close": ("warning_under_review", "warning_closed"),
}


def decided(action: Verdict, status: str) -> bool:
    if action == "escalate":
        return not status.startswith("warning_")
    if action == "close":
        return status == "warning_closed"
    return status in ("won", "lost")


async def unlocked[T](request: Callable[[], Awaitable[T]]) -> T:
    """Retries Stripe's lock_timeout, returned while Stripe itself is still updating the object."""
    # a dispute can hold its charge for most of a minute while Stripe processes it
    for attempt in range(9):
        try:
            return await request()
        except stripe.RateLimitError as exc:
            # the SDK leaves a 429's code off exc.code and keeps it on exc.error
            if exc.error is None or exc.error.code != "lock_timeout" or attempt == 8:
                raise
            await asyncio.sleep(min(2**attempt, 10))
    raise AssertionError("unreachable")


async def submit_evidence(
    account: str, dispute: stripe.Dispute, action: Verdict, run: str
) -> stripe.Dispute:
    """Stripe's sandbox evidence values decide a test dispute or inquiry."""
    if dispute.livemode:
        raise ValueError("live dispute evidence is forbidden")
    ready = "warning_needs_response" if action in INQUIRY else "needs_response"
    if dispute.status == ready:
        dispute_id = dispute.id
        # the same key retries safely while Stripe still holds the dispute
        dispute = await unlocked(
            lambda: stripe.Dispute.modify_async(
                dispute_id,
                evidence={"uncategorized_text": EVIDENCE[action]},
                submit=True,
                stripe_account=account,
                idempotency_key=f"browser:{run}:{dispute_id}:{action}",
            )
        )
    elif dispute.status not in PENDING[action]:
        raise ValueError(f"cannot {action} a dispute that is {dispute.status}")
    deadline = time.monotonic() + 120
    while not decided(action, dispute.status):
        if time.monotonic() > deadline:
            raise TimeoutError("the sandbox dispute did not settle")
        await asyncio.sleep(2)
        with suppress(stripe.RateLimitError):
            dispute = await stripe.Dispute.retrieve_async(dispute.id, stripe_account=account)
    return dispute


async def settle_disputes(
    account: str, charge_id: str, metadata: dict[str, str], *, apply: bool
) -> int | None:
    """What lost disputes took from an owned charge, losing any still open; None if only planned."""
    listed = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
    disputes = [dispute async for dispute in listed.auto_paging_iter()]
    if any(dispute.livemode or dispute.charge != charge_id for dispute in disputes):
        raise ValueError("dispute does not belong to the owned charge")
    open_disputes = [d for d in disputes if d.status in ("needs_response", "under_review")]
    if open_disputes and not apply:
        return None
    for dispute in open_disputes:
        disputes.remove(dispute)
        disputes.append(
            await submit_evidence(account, dispute, "lose", metadata["clientbridge_qa_run"])
        )
    return sum(dispute.amount for dispute in disputes if dispute.status == "lost")


async def settled(account: str, refund: stripe.Refund, *, slow: bool) -> stripe.Refund:
    """Bank debit and Klarna refunds go back through them, so Stripe holds them pending briefly."""
    deadline = time.monotonic() + 300
    while slow and refund.status == "pending" and time.monotonic() < deadline:
        await asyncio.sleep(5)
        refund = await stripe.Refund.retrieve_async(refund.id, stripe_account=account)
    return refund


async def cleanup_intent(
    account: str,
    intent: stripe.PaymentIntent,
    metadata: dict[str, str],
    *,
    apply: bool = True,
) -> dict[str, object]:
    if intent.livemode:
        raise ValueError("live provider cleanup is forbidden")
    if intent.status == "succeeded":
        if not isinstance(intent.latest_charge, str):
            raise ValueError("successful intent has no charge")
        charge = await stripe.Charge.retrieve_async(intent.latest_charge, stripe_account=account)
        if charge.livemode or charge.payment_intent != intent.id or charge.amount != intent.amount:
            raise ValueError("charge does not match the owned intent")
        method = (charge.to_dict().get("payment_method_details") or {}).get("type")
        slow = method in ("acss_debit", "klarna")
        lost = 0
        if charge.to_dict().get("disputed"):
            lost = await settle_disputes(account, charge.id, metadata, apply=apply)
            if lost is None:
                return {"intent": intent.id, "status": "planned_dispute_loss"}
        refunds = await stripe.Refund.list_async(charge=charge.id, stripe_account=account)
        refunded = 0
        bank_failed = False
        card_refuses = False
        async for listed in refunds.auto_paging_iter():
            refund = await settled(account, listed, slow=slow)
            if refund.status == "succeeded":
                refunded += refund.amount
            elif refund.status == "failed":
                bank_failed = True
                card_refuses |= refund.failure_reason in CARD_REFUSALS
            elif refund.status != "canceled":
                raise ValueError("owned charge has an unsettled refund; retry after settlement")
        remaining = charge.amount - charge.amount_refunded - lost
        if lost and remaining <= 0:
            if refunded != charge.amount_refunded:
                raise ValueError("charge and settled refunds disagree")
            return {"intent": intent.id, "status": "dispute_lost"}
        if remaining == 0:
            if refunded != charge.amount:
                raise ValueError("fully refunded charge lacks settled refund evidence")
            return {"intent": intent.id, "status": "already_refunded"}
        if remaining < 0 or refunded != charge.amount_refunded:
            raise ValueError("charge and settled refunds disagree")
        if card_refuses:
            # Stripe refuses another refund to a card that failed one, so the charge stays
            return {"intent": intent.id, "status": "refund_refused", "amount_cents": remaining}
        if not apply:
            return {
                "intent": intent.id,
                "status": "planned_refund",
                "amount_cents": remaining,
            }
        try:
            refund = await stripe.Refund.create_async(
                payment_intent=intent.id,
                amount=remaining,
                refund_application_fee=True,
                metadata=metadata,
                stripe_account=account,
                idempotency_key=f"browser:{metadata['clientbridge_qa_run']}:{intent.id}:cleanup:{remaining}",
            )
        except stripe.InvalidRequestError:
            # a card whose bank already failed a refund takes no more; the sandbox keeps the rest
            if bank_failed:
                return {"intent": intent.id, "status": "refund_refused", "amount_cents": remaining}
            raise
        refund = await settled(account, refund, slow=slow)
        if refund.status != "succeeded":
            raise ValueError("owned refund is not settled; cleanup needs retry")
        return {"intent": intent.id, "refund": refund.id, "status": refund.status}
    if intent.status == "canceled":
        return {"intent": intent.id, "status": "already_canceled"}
    if intent.status in (
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "requires_capture",
    ):
        if not apply:
            return {"intent": intent.id, "status": "planned_cancel"}
        canceled = await stripe.PaymentIntent.cancel_async(intent.id, stripe_account=account)
        if canceled.status != "canceled":
            raise ValueError("owned intent cancellation did not complete")
        return {"intent": intent.id, "status": canceled.status}
    raise ValueError("owned intent is processing; defer cleanup rather than guessing")
