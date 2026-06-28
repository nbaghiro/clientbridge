"""Webhook surface (#4) — unauthenticated provider callbacks, authenticated by signature."""

from typing import Annotated

from fastapi import APIRouter, Header, Request, Response

from clientbridge.core.deps import DbSession, GatewayDep, InteracSecretDep
from clientbridge.integrations.payments import WebhookVerificationError
from clientbridge.schemas.payments import InteracWebhookBody
from clientbridge.services.payment_service import process_interac_event, process_stripe_event

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    db: DbSession,
    gateway: GatewayDep,
    stripe_signature: Annotated[str, Header(alias="Stripe-Signature")] = "",
) -> Response:
    payload = await request.body()
    try:
        await process_stripe_event(db, gateway, payload, stripe_signature)
    except WebhookVerificationError:
        return Response(status_code=400)
    return Response(status_code=200)


@router.post("/interac")
async def interac_webhook(
    body: InteracWebhookBody,
    db: DbSession,
    secret: InteracSecretDep,
    x_interac_secret: Annotated[str, Header(alias="X-Interac-Secret")] = "",
) -> Response:
    if not secret or x_interac_secret != secret:
        return Response(status_code=401)
    await process_interac_event(db, body.reference_code, body.amount_cents)
    return Response(status_code=200)
