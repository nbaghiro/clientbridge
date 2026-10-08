from typing import Annotated

from fastapi import APIRouter, Depends, Header

from clientbridge.core.deps import DbSession, GatewayDep
from clientbridge.core.ratelimit import public_booking_rate_limit
from clientbridge.schemas.orders import PublicOrderAlerts, PublicOrderStatus
from clientbridge.services.public_orders import PublicOrderService

router = APIRouter(prefix="/order", tags=["public-orders"])
RateLimited = Annotated[None, Depends(public_booking_rate_limit)]


@router.get("/{token}", response_model=PublicOrderStatus)
async def order_status(token: str, db: DbSession, _: RateLimited) -> PublicOrderStatus:
    return await PublicOrderService(db).view(token)


@router.patch("/{token}/alerts", response_model=PublicOrderStatus)
async def order_alerts(
    token: str, data: PublicOrderAlerts, db: DbSession, _: RateLimited
) -> PublicOrderStatus:
    return await PublicOrderService(db).alerts(token, data)


@router.post("/{token}/cancel", response_model=PublicOrderStatus)
async def cancel_order(
    token: str,
    db: DbSession,
    gateway: GatewayDep,
    _: RateLimited,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> PublicOrderStatus:
    return await PublicOrderService(db).cancel(token, gateway, idempotency_key)
