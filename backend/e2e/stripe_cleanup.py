"""Put an owned payment intent back: settle its disputes, then refund or cancel it."""

import asyncio
import time
from contextlib import suppress
from typing import Literal

import stripe

EVIDENCE: dict[Literal["lose", "escalate"], str] = {
    "lose": "losing_evidence",
    "escalate": "escalate_inquiry_evidence",
}


async def submit_evidence(
    account: str, dispute: stripe.Dispute, action: Literal["lose", "escalate"], run: str
) -> stripe.Dispute:
    """Stripe's sandbox evidence values decide a test dispute: lose it, or escalate an inquiry."""
    if dispute.livemode:
        raise ValueError("live dispute evidence is forbidden")
    ready = "warning_needs_response" if action == "escalate" else "needs_response"
    if dispute.status == ready:
        for attempt in range(10):
            try:
                dispute = await stripe.Dispute.modify_async(
                    dispute.id,
                    evidence={"uncategorized_text": EVIDENCE[action]},
                    submit=True,
                    stripe_account=account,
                    idempotency_key=f"browser:{run}:{dispute.id}:{action}",
                )
                break
            except stripe.RateLimitError:
                # Stripe locks a dispute while it processes it; the same key retries safely
                if attempt == 9:
                    raise
                await asyncio.sleep(3)
    elif action == "escalate" or dispute.status not in ("under_review", "won", "lost"):
        raise ValueError(f"cannot {action} a dispute that is {dispute.status}")
    deadline = time.monotonic() + 120
    while (
        dispute.status.startswith("warning_")
        if action == "escalate"
        else dispute.status not in ("won", "lost")
    ):
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
        lost = 0
        if charge.to_dict().get("disputed"):
            lost = await settle_disputes(account, charge.id, metadata, apply=apply)
            if lost is None:
                return {"intent": intent.id, "status": "planned_dispute_loss"}
        refunds = await stripe.Refund.list_async(charge=charge.id, stripe_account=account)
        refunded = 0
        async for refund in refunds.auto_paging_iter():
            if refund.status == "succeeded":
                refunded += refund.amount
            elif refund.status not in ("failed", "canceled"):
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
        if not apply:
            return {
                "intent": intent.id,
                "status": "planned_refund",
                "amount_cents": remaining,
            }
        refund = await stripe.Refund.create_async(
            payment_intent=intent.id,
            amount=remaining,
            refund_application_fee=True,
            metadata=metadata,
            stripe_account=account,
            idempotency_key=f"browser:{metadata['clientbridge_qa_run']}:{intent.id}:cleanup:{remaining}",
        )
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
