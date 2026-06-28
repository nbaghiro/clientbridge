"""Webhook surface (#4) — unauthenticated provider callbacks, authenticated by signature."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Header, Request, Response

from clientbridge.core.deps import (
    DbSession,
    EmailDep,
    GatewayDep,
    InteracSecretDep,
    PushDep,
    SmsDep,
)
from clientbridge.integrations.payments import WebhookVerificationError
from clientbridge.schemas.payments import InteracWebhookBody
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
        settled_id = await process_stripe_event(db, gateway, payload, stripe_signature)
    except WebhookVerificationError:
        return Response(status_code=400)
    if settled_id is not None:  # post-commit so a notify failure can't roll back the settlement
        await Notifier(email, sms, push).on_payment_succeeded(db, settled_id)
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
