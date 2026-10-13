from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.plans import PlanChoice, PlanLink, PlanOut
from clientbridge.services import plans
from clientbridge.services.plans import PlanService

router = APIRouter(prefix="/plan", tags=["plan"])

_SAFE = frozenset({"GET", "HEAD", "OPTIONS"})
# a lapsed business can still take its data out
_EXPORTS = frozenset({"/v1/consents/export", "/v1/reports/export"})


async def writable(request: Request, principal: CurrentPrincipal, db: DbSession) -> None:
    """Refuse every write of a lapsed business with 402 plan_required; reads stay open."""
    if request.method in _SAFE or request.url.path in _EXPORTS:
        return
    await plans.assert_writable(db, principal.business_id, datetime.now(UTC))


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
