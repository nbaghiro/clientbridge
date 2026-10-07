from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import (
    CurrentPrincipal,
    DbSession,
    EmailDep,
    GatewayDep,
    PushDep,
    SmsDep,
)
from clientbridge.schemas.orders import (
    CheckoutOut,
    OrderCashIn,
    OrderCashOut,
    OrderCheckoutIn,
    OrderCreate,
    OrderOut,
    OrderPayIn,
    OrderPickupIn,
    OrderReceiptIn,
    OrderUpdate,
    PinIn,
)
from clientbridge.services.notifications import Notifier
from clientbridge.services.orders import OrderService

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/held", response_model=list[OrderOut])
async def held_orders(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> list[OrderOut]:
    return await OrderService(db, principal, gateway).held()


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
    data: OrderCheckoutIn | None = None,
) -> CheckoutOut:
    return await OrderService(db, principal, gateway).checkout(order_id, data, idempotency_key)


@router.post("/{order_id}/cash", response_model=OrderCashOut)
async def pay_order_cash(
    order_id: str,
    data: OrderCashIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OrderCashOut:
    result = await OrderService(db, principal, gateway).pay_cash(order_id, data, idempotency_key)
    await Notifier(email, sms, push).on_payment_succeeded(db, result.payment_id)
    return result


@router.post("/{order_id}/receipt", response_model=OrderOut)
async def send_order_receipt(
    order_id: str,
    data: OrderReceiptIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> OrderOut:
    result = await OrderService(db, principal, gateway).send_receipt(order_id, data)
    await Notifier(email, sms, push).on_order_receipt(db, result.id)
    return result


@router.post("/approval-pin", status_code=204)
async def set_approval_pin(
    data: PinIn, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> None:
    await OrderService(db, principal, gateway).set_pin(data)


@router.post("/{order_id}/pay", response_model=CheckoutOut)
async def pay_order(
    order_id: str,
    data: OrderPayIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CheckoutOut:
    return await OrderService(db, principal, gateway).pay_by_card(order_id, data, idempotency_key)


@router.post("/{order_id}/void", response_model=OrderOut)
async def void_order(
    order_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> OrderOut:
    return await OrderService(db, principal, gateway).void_order(order_id)


@router.post("/{order_id}/pickup", response_model=OrderOut)
async def set_order_pickup(
    order_id: str,
    data: OrderPickupIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> OrderOut:
    result = await OrderService(db, principal, gateway).set_pickup(order_id, data)
    if data.status == "ready":
        await Notifier(email, sms, push).on_order_ready(db, result.id)
    return result
