from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.earnings import (
    AdjustmentIn,
    EarningIdsIn,
    EarningOut,
    EarningsOut,
    PayIn,
)
from clientbridge.services.earnings import EarningService

router = APIRouter(prefix="/earnings", tags=["earnings"])

IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key")]


@router.post("/approve", response_model=EarningsOut)
async def approve_earnings(
    data: EarningIdsIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> EarningsOut:
    return await EarningService(db, principal).approve_many(data.ids, idempotency_key)


@router.post("/pay", response_model=EarningsOut)
async def pay_earnings(
    data: PayIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> EarningsOut:
    return await EarningService(db, principal).pay_many(data.ids, data.through, idempotency_key)


@router.post("/unapprove", response_model=EarningsOut)
async def unapprove_earnings(
    data: EarningIdsIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> EarningsOut:
    return await EarningService(db, principal).unapprove_many(data.ids, idempotency_key)


@router.post("/unpay", response_model=EarningsOut)
async def unpay_earnings(
    data: EarningIdsIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> EarningsOut:
    return await EarningService(db, principal).unpay_many(data.ids, idempotency_key)


@router.post("/adjustments", response_model=EarningOut, status_code=201)
async def add_adjustment(
    data: AdjustmentIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> EarningOut:
    return await EarningService(db, principal).adjust(data, idempotency_key)
