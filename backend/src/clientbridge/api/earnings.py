from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.earnings import EarningIdsIn, EarningsOut
from clientbridge.services.earnings import EarningService

router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.post("/approve", response_model=EarningsOut)
async def approve_earnings(
    data: EarningIdsIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EarningsOut:
    return await EarningService(db, principal).approve_many(data.ids, idempotency_key)


@router.post("/pay", response_model=EarningsOut)
async def pay_earnings(
    data: EarningIdsIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EarningsOut:
    return await EarningService(db, principal).pay_many(data.ids, idempotency_key)
