from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.billing import Line, Order
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.schemas.orders import (
    CheckoutOut,
    ConnectionTokenOut,
    OrderCreate,
    OrderOut,
    OrderUpdate,
)
from clientbridge.services.lines import (
    apply_totals,
    fetch_lines,
    line_out,
    replace_lines,
    tax_for_lines,
)
from clientbridge.services.payment_service import open_terminal_payment


class OrderService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def create_order(self, data: OrderCreate, idempotency_key: str | None = None) -> OrderOut:
        # POS is staff-operated front-desk work — any authenticated principal may ring a sale.
        if data.client_id is not None:
            await self._client(data.client_id)

        async def run(cmd: Command) -> OrderOut:
            order = Order(
                id=new_id("order"),
                business_id=self.biz,
                client_id=data.client_id,
                staff_id=self.principal.staff_id,
                status="open",
                currency="CAD",
            )
            self.db.add(order)
            await self.db.flush()
            lines = await replace_lines(self.db, self.biz, "order", order.id, data.lines)
            await self._apply_totals(order, lines)
            await self.db.flush()
            cmd.record("order.create", entity_type="order", entity_id=order.id)
            return _out(order, lines)

        return await run_command(
            self.db,
            self.principal,
            action="order.create",
            run=run,
            response_model=OrderOut,
            idempotency_key=idempotency_key,
        )

    async def update_order(self, order_id: str, data: OrderUpdate) -> OrderOut:
        order = await self._order(order_id)
        if order.status != "open":
            raise Conflict("only an open order can be edited")
        if await self._has_active_payment(order_id):
            raise Conflict("can't edit an order after checkout has started")

        async def run(cmd: Command) -> OrderOut:
            lines = (
                await replace_lines(self.db, self.biz, "order", order.id, data.lines)
                if data.lines is not None
                else await fetch_lines(self.db, self.biz, "order", order.id)
            )
            await self._apply_totals(order, lines)
            await self.db.flush()
            cmd.record("order.update", entity_type="order", entity_id=order.id)
            return _out(order, lines)

        return await run_command(
            self.db, self.principal, action="order.update", run=run, response_model=OrderOut
        )

    async def void_order(self, order_id: str) -> OrderOut:
        self._assert_admin()
        order = await self._order(order_id)
        if order.status != "open":
            raise Conflict(f"a {order.status} order can't be voided")

        async def run(cmd: Command) -> OrderOut:
            order.status = "void"
            await self.db.flush()
            cmd.record("order.void", entity_type="order", entity_id=order.id)
            return _out(order, await fetch_lines(self.db, self.biz, "order", order.id))

        return await run_command(
            self.db, self.principal, action="order.void", run=run, response_model=OrderOut
        )

    async def checkout(self, order_id: str, idempotency_key: str | None) -> CheckoutOut:
        order = await self._order(order_id)
        if order.status != "open":
            raise Conflict("only an open order can be checked out")
        if order.balance_cents <= 0:
            raise Conflict("order has no balance to charge")
        business = await self.db.get(Business, self.biz)
        if (
            business is None
            or not business.stripe_charges_enabled
            or business.stripe_account_id is None
        ):
            raise Conflict("connect a Stripe account before taking payment")
        account_id = business.stripe_account_id

        async def run(cmd: Command) -> CheckoutOut:
            payment, client_secret = await open_terminal_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                order=order,
                amount=order.balance_cents,
                fee_bps=get_settings().platform_fee_bps,
                idempotency_key=idempotency_key,
            )
            cmd.record("order.checkout", entity_type="order", entity_id=order.id)
            return CheckoutOut(
                order_id=order.id, client_secret=client_secret, payment_id=payment.id
            )

        return await run_command(
            self.db,
            self.principal,
            action="order.checkout",
            run=run,
            response_model=CheckoutOut,
            idempotency_key=idempotency_key,
        )

    async def connection_token(self) -> ConnectionTokenOut:
        business = (
            await self.db.execute(select(Business).where(Business.id == self.biz).with_for_update())
        ).scalar_one_or_none()
        if business is None or business.stripe_account_id is None:
            raise Conflict("connect a Stripe account first")
        # Mint the Terminal Location once (a reader connects under it) and cache it on the business;
        # the row lock serializes concurrent first-time mints.
        if business.stripe_terminal_location_id is None:
            business.stripe_terminal_location_id = await self.gateway.create_terminal_location(
                business.stripe_account_id,
                display_name=business.name,
                country="CA",
                state=business.province,
            )
            await self.db.commit()
        secret = await self.gateway.create_connection_token(business.stripe_account_id)
        return ConnectionTokenOut(secret=secret, location_id=business.stripe_terminal_location_id)

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can void an order"
        )

    async def _apply_totals(self, order: Order, lines: list[Line]) -> None:
        apply_totals(order, await tax_for_lines(self.db, self.biz, lines))

    async def _order(self, order_id: str) -> Order:
        row = (
            await self.db.execute(scoped(Order, self.biz).where(Order.id == order_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("order not found")
        return row

    async def _has_active_payment(self, order_id: str) -> bool:
        row = (
            await self.db.execute(
                select(Payment.id)
                .where(Payment.order_id == order_id, Payment.status.notin_(("failed", "canceled")))
                .limit(1)
            )
        ).scalar_one_or_none()
        return row is not None

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row


def _out(order: Order, lines: list[Line]) -> OrderOut:
    return OrderOut(
        id=order.id,
        business_id=order.business_id,
        client_id=order.client_id,
        staff_id=order.staff_id,
        status=order.status,
        currency=order.currency,
        subtotal_cents=order.subtotal_cents,
        tax_total_cents=order.tax_total_cents,
        total_cents=order.total_cents,
        amount_paid_cents=order.amount_paid_cents,
        balance_cents=order.balance_cents,
        paid_at=order.paid_at,
        lines=[line_out(ln) for ln in lines],
    )
