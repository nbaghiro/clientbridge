from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from starlette.routing import compile_path

from clientbridge.core import clock
from clientbridge.core.deps import (
    CurrentPrincipal,
    DbSession,
    GatewayDep,
    IdentityDep,
    current_identity,
    current_principal,
    current_user,
)
from clientbridge.schemas.plans import PlanChoice, PlanLink, PlanOut
from clientbridge.services import plans
from clientbridge.services.plans import PlanService

router = APIRouter(prefix="/plan", tags=["plan"])

_SAFE = frozenset({"GET", "HEAD", "OPTIONS"})
# a lapsed business can still buy a plan, fix its address, export, leave, refund and stop billing
LAPSED_WRITES = frozenset(
    {
        ("POST", "/v1/plan/checkout"),
        ("POST", "/v1/plan/change"),
        ("POST", "/v1/plan/portal"),
        ("PATCH", "/v1/business"),
        ("POST", "/v1/onboarding"),
        ("POST", "/v1/devices/register"),
        ("POST", "/v1/devices/unregister"),
        ("POST", "/v1/staff/invites/preview"),
        ("POST", "/v1/staff/invites/accept"),
        ("POST", "/v1/staff/invites/{invite_id}/revoke"),
        ("POST", "/v1/staff/{staff_id}/remove"),
        ("POST", "/v1/consents/export"),
        ("POST", "/v1/reports/export"),
        ("POST", "/v1/threads/{thread_id}/read"),
        ("POST", "/v1/connect/session"),
        ("POST", "/v1/payments/{payment_id}/refund"),
        ("POST", "/v1/subscriptions/{subscription_id}/cancel"),
    }
)
_ALLOWED = [(method, compile_path(path)[0]) for method, path in LAPSED_WRITES]


async def writable(request: Request, db: DbSession, identities: IdentityDep) -> None:
    """Refuse every write of a lapsed business with 402 plan_required; reads stay open."""
    method, path = request.method, request.url.path
    if method in _SAFE or any(m == method and rx.fullmatch(path) for m, rx in _ALLOWED):
        return
    # resolved only here, so the allowed routes that need no sign-in still answer without one
    headers = request.headers
    identity = await current_identity(request, identities, headers.get("x-session-token", ""))
    user = await current_user(identity, identities, db, headers.get("x-expected-user", ""))
    principal = await current_principal(user.id, db, headers.get("x-business-id", ""))
    await plans.assert_writable(db, principal.business_id, clock.now())


PlanWritable = Depends(writable)


@router.get("", response_model=PlanOut)
async def plan_status(principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep) -> PlanOut:
    return await PlanService(db, principal, gateway).status()


@router.post("/checkout", response_model=PlanLink)
async def checkout(
    body: PlanChoice,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    response: Response,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PlanLink:
    response.headers["Cache-Control"] = "no-store"
    return await PlanService(db, principal, gateway).checkout(body, idempotency_key)


@router.post("/change", response_model=PlanOut)
async def change(
    body: PlanChoice,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PlanOut:
    return await PlanService(db, principal, gateway).change(body, idempotency_key)


@router.post("/portal", response_model=PlanLink)
async def portal(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep, response: Response
) -> PlanLink:
    response.headers["Cache-Control"] = "no-store"
    return await PlanService(db, principal, gateway).portal()
