from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.orders import ConnectionTokenOut
from clientbridge.services.order_service import OrderService

router = APIRouter(prefix="/terminal", tags=["terminal"])


@router.post("/connection-token", response_model=ConnectionTokenOut)
async def connection_token(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> ConnectionTokenOut:
    return await OrderService(db, principal, gateway).connection_token()
