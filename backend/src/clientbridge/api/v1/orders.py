from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.orders import CheckoutOut, OrderCreate, OrderOut, OrderUpdate
from clientbridge.services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(
    data: OrderCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OrderOut:
    return await OrderService(db, principal, gateway).create_order(data, idempotency_key)


@router.patch("/{order_id}", response_model=OrderOut)
async def update_order(
    order_id: str,
    data: OrderUpdate,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> OrderOut:
    return await OrderService(db, principal, gateway).update_order(order_id, data)


@router.post("/{order_id}/checkout", response_model=CheckoutOut)
async def checkout_order(
    order_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CheckoutOut:
    return await OrderService(db, principal, gateway).checkout(order_id, idempotency_key)


@router.post("/{order_id}/void", response_model=OrderOut)
async def void_order(
    order_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> OrderOut:
    return await OrderService(db, principal, gateway).void_order(order_id)
