"""Webhook surface (#4) — unauthenticated provider callbacks, authenticated by signature."""

import logging
import secrets
from typing import Annotated
from urllib.parse import parse_qsl

from fastapi import APIRouter, Header, Request, Response

from clientbridge.core import clock
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
from clientbridge.integrations.stripe import WebhookVerificationError, WebhookVersionError
from clientbridge.integrations.twilio import valid_twilio_signature
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services.deliveries import (
    DeliveryQueue,
    QueuedEmail,
    QueuedPush,
    QueuedSms,
    dispatch,
    dispatch_scope,
)
from clientbridge.services.messaging import (
    EmailEventPending,
    inbound_scope,
    process_email_event,
    process_inbound_sms,
)
from clientbridge.services.notifications import Notifier, send_auth_email
from clientbridge.services.payments import (
    WebhookOutcome,
    notify_payment_outcome,
    process_stripe_event,
)

_log = logging.getLogger(__name__)
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
    queue = DeliveryQueue(db, "stripe")
    notifier = Notifier(QueuedEmail(queue), QueuedSms(queue), QueuedPush(queue), raise_errors=True)

    async def notify(outcome: WebhookOutcome) -> None:
        queue.scope = outcome.scope
        queue.business_id = outcome.business_id
        await notify_payment_outcome(notifier, db, outcome)

    try:
        outcome = await process_stripe_event(db, gateway, payload, stripe_signature, notify)
    except WebhookVerificationError as error:
        _log.error("webhook rejected signature: %s", error)
        return Response(status_code=400)
    except WebhookVersionError as error:
        _log.error("webhook rejected version %s", error)
        return Response(status_code=400)
    for identity in queue.ids:
        await dispatch(db, identity, email, sms, push)
    if outcome is not None and outcome.notify == "refund":
        await dispatch_scope(db, f"refund:{outcome.target_id}", email, sms, push)
    return Response(status_code=200)


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
        db,
        from_phone=fields.get("From", ""),
        to_phone=fields.get("To", ""),
        body=fields.get("Body", ""),
        message_sid=sid,
    )
    if message_id is not None:
        await dispatch_scope(db, inbound_scope(message_id), email, sms, push)
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
    now = clock.wall()
    if not valid_resend_signature(
        secret, svix_id, svix_timestamp, payload, svix_signature, now=now
    ):
        return Response(status_code=401)
    try:
        await process_email_event(db, svix_id=svix_id, payload=payload)
    except EmailEventPending:
        return Response(status_code=503)
    return Response(status_code=200)
