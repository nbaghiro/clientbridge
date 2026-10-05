from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.earnings import EarningOut
from clientbridge.services.earnings import EarningService

router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.post("/{earning_id}/approve", response_model=EarningOut)
async def approve_earning(
    earning_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EarningOut:
    return await EarningService(db, principal).approve(earning_id, idempotency_key)


@router.post("/{earning_id}/pay", response_model=EarningOut)
async def pay_earning(
    earning_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EarningOut:
    return await EarningService(db, principal).pay(earning_id, idempotency_key)
