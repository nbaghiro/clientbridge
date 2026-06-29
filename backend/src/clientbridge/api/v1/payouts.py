from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.payouts import PayoutAllocationOut
from clientbridge.services.payout_service import PayoutService

router = APIRouter(prefix="/payouts", tags=["payouts"])


@router.post("/allocations/{allocation_id}/approve", response_model=PayoutAllocationOut)
async def approve_allocation(
    allocation_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PayoutAllocationOut:
    return await PayoutService(db, principal).approve_allocation(allocation_id, idempotency_key)


@router.post("/allocations/{allocation_id}/pay", response_model=PayoutAllocationOut)
async def pay_allocation(
    allocation_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PayoutAllocationOut:
    return await PayoutService(db, principal).pay_allocation(allocation_id, idempotency_key)
