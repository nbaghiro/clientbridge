"""Webhook surface (#4) — unauthenticated provider callbacks, authenticated by signature."""

import secrets
from typing import Annotated
from urllib.parse import parse_qs

from fastapi import APIRouter, Header, Request, Response

from clientbridge.core.deps import (
    DbSession,
    EmailDep,
    GatewayDep,
    InteracSecretDep,
    PushDep,
    SmsDep,
    SmsWebhookSecretDep,
)
from clientbridge.integrations.payments import WebhookVerificationError
from clientbridge.schemas.payments import InteracWebhookBody
from clientbridge.services.message_service import process_inbound_sms
from clientbridge.services.notification_service import Notifier
from clientbridge.services.payment_service import process_interac_event, process_stripe_event

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    stripe_signature: Annotated[str, Header(alias="Stripe-Signature")] = "",
) -> Response:
    payload = await request.body()
    try:
        outcome = await process_stripe_event(db, gateway, payload, stripe_signature)
    except WebhookVerificationError:
        return Response(status_code=400)
    if outcome is not None:  # post-commit so a notify failure can't roll back the settlement
        notifier = Notifier(email, sms, push)
        if outcome.notify == "payment":
            await notifier.on_payment_succeeded(db, outcome.target_id)
        elif outcome.notify == "gift_card_issued":
            await notifier.on_gift_card_issued(db, outcome.target_id)
        elif outcome.notify == "payment_failed":
            await notifier.on_payment_failed(db, outcome.target_id)
        elif outcome.notify == "subscription_past_due":
            await notifier.on_subscription_past_due(db, outcome.target_id)
        elif outcome.notify == "subscription_canceled":
            await notifier.on_subscription_canceled(db, outcome.target_id)
    return Response(status_code=200)


@router.post("/interac")
async def interac_webhook(
    body: InteracWebhookBody,
    db: DbSession,
    secret: InteracSecretDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    x_interac_secret: Annotated[str, Header(alias="X-Interac-Secret")] = "",
) -> Response:
    if not secret or not secrets.compare_digest(x_interac_secret, secret):
        return Response(status_code=401)
    matched_id = await process_interac_event(db, body.reference_code, body.amount_cents)
    if matched_id is not None:
        await Notifier(email, sms, push).on_payment_succeeded(db, matched_id)
    return Response(status_code=200)


@router.post("/sms")
async def sms_webhook(
    request: Request,
    db: DbSession,
    secret: SmsWebhookSecretDep,
    x_twilio_signature: Annotated[str, Header(alias="X-Twilio-Signature")] = "",
) -> Response:
    if not secret or not secrets.compare_digest(x_twilio_signature, secret):
        return Response(status_code=401)
    form = parse_qs((await request.body()).decode())
    sid = (form.get("MessageSid") or [""])[0]
    if not sid:
        return Response(status_code=400)
    await process_inbound_sms(
        db,
        from_phone=(form.get("From") or [""])[0],
        body=(form.get("Body") or [""])[0],
        message_sid=sid,
    )
    return Response(status_code=200)
