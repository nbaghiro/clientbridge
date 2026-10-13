"""Webhook surface (#4) — unauthenticated provider callbacks, authenticated by signature."""

import secrets
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import parse_qsl

from fastapi import APIRouter, Header, Request, Response

from clientbridge.core.config import get_settings
from clientbridge.core.deps import (
    AuthEmailSecretDep,
    DbSession,
    EmailDep,
    GatewayDep,
    PushDep,
    ResendWebhookSecretDep,
    SmsDep,
    TwilioAuthTokenDep,
)
from clientbridge.integrations.resend import valid_resend_signature
from clientbridge.integrations.stripe import WebhookVerificationError
from clientbridge.integrations.twilio import valid_twilio_signature
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services.messaging import (
    EmailEventPending,
    process_email_event,
    process_inbound_sms,
)
from clientbridge.services.notifications import Notifier, send_auth_email
from clientbridge.services.payments import WebhookOutcome, process_stripe_event

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
        await _notify(Notifier(email, sms, push), db, outcome)
    return Response(status_code=200)


async def _notify(notifier: Notifier, db: DbSession, outcome: WebhookOutcome) -> None:
    match outcome.notify:
        case "payment":
            await notifier.on_payment_succeeded(db, outcome.target_id)
        case "gift_card_issued":
            await notifier.on_gift_card_issued(db, outcome.target_id)
        case "payment_failed":
            await notifier.on_payment_failed(db, outcome.target_id)
        case "refund":
            await notifier.on_refund(db, outcome.target_id)
        case "refund_failed":
            await notifier.on_refund_failed(db, outcome.target_id)
        case "payment_disputed":
            await notifier.on_payment_disputed(db, outcome.target_id)
        case "subscription_past_due":
            await notifier.on_subscription_past_due(db, outcome.target_id)
        case "subscription_canceled":
            await notifier.on_subscription_canceled(db, outcome.target_id)


@router.post("/sms")
async def sms_webhook(
    request: Request,
    db: DbSession,
    auth_token: TwilioAuthTokenDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    x_twilio_signature: Annotated[str, Header(alias="X-Twilio-Signature")] = "",
) -> Response:
    form = parse_qsl((await request.body()).decode(), keep_blank_values=True)
    query = f"?{request.url.query}" if request.url.query else ""
    url = f"{get_settings().api_base_url.rstrip('/')}{request.url.path}{query}"
    if not valid_twilio_signature(auth_token, url, form, x_twilio_signature):
        return Response(status_code=401)
    fields = dict(form)
    sid = fields.get("MessageSid", "")
    if not sid:
        return Response(status_code=400)
    message_id = await process_inbound_sms(
        db, from_phone=fields.get("From", ""), body=fields.get("Body", ""), message_sid=sid
    )
    if message_id is not None:
        await Notifier(email, sms, push).on_inbound_message(db, message_id)
    return Response(status_code=200)


@router.post("/auth-email")
async def auth_email_webhook(
    body: AuthEmailIn,
    secret: AuthEmailSecretDep,
    email: EmailDep,
    x_webhook_secret: Annotated[str, Header(alias="X-Webhook-Secret")] = "",
) -> Response:
    if not secret or not secrets.compare_digest(x_webhook_secret, secret):
        return Response(status_code=401)
    await send_auth_email(email, body)
    return Response(status_code=200)


@router.post("/email")
async def email_webhook(
    request: Request,
    db: DbSession,
    secret: ResendWebhookSecretDep,
    svix_id: Annotated[str, Header(alias="svix-id")] = "",
    svix_timestamp: Annotated[str, Header(alias="svix-timestamp")] = "",
    svix_signature: Annotated[str, Header(alias="svix-signature")] = "",
) -> Response:
    payload = await request.body()
    now = datetime.now(UTC)
    if not valid_resend_signature(
        secret, svix_id, svix_timestamp, payload, svix_signature, now=now
    ):
        return Response(status_code=401)
    try:
        await process_email_event(db, svix_id=svix_id, payload=payload)
    except EmailEventPending:
        return Response(status_code=503)
    return Response(status_code=200)
