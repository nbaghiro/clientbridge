from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.billing import Line, Order
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.schemas.orders import (
    CheckoutOut,
    ConnectionTokenOut,
    OrderCreate,
    OrderOut,
    OrderPayIn,
    OrderPickupIn,
    OrderUpdate,
)
from clientbridge.services import ledger
from clientbridge.services.lines import (
    apply_totals,
    fetch_lines,
    line_out,
    replace_lines,
    tax_for_lines,
)
from clientbridge.services.payments import (
    open_order_card_payment,
    open_terminal_payment,
    resolve_saved_method_ref,
)

_PICKUP_STEPS = {"unfulfilled": 0, "ready": 1, "picked_up": 2}


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
                receipt_email=data.receipt_email,
                receipt_phone=data.receipt_phone,
            )
            self.db.add(order)
            await self.db.flush()
            lines = await replace_lines(self.db, self.biz, "order", order.id, data.lines)
            await self._apply_totals(order, lines)
            await self.db.flush()
            cmd.record("order.create", entity_type="order", entity_id=order.id)
            return await _out(self.db, order, lines)

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
        if await _status(self.db, order) != "open":
            raise Conflict("only an open order can be edited")
        if await self._has_active_payment(order_id):
            raise Conflict("can't edit an order after checkout has started")
        if data.client_id is not None:
            await self._client(data.client_id)

        async def run(cmd: Command) -> OrderOut:
            lines = (
                await replace_lines(self.db, self.biz, "order", order.id, data.lines)
                if data.lines is not None
                else await fetch_lines(self.db, self.biz, "order", order.id)
            )
            for key in ("client_id", "receipt_email", "receipt_phone"):
                if key in data.model_fields_set:
                    setattr(order, key, getattr(data, key))
            await self._apply_totals(order, lines)
            await self.db.flush()
            cmd.record("order.update", entity_type="order", entity_id=order.id)
            return await _out(self.db, order, lines)

        return await run_command(
            self.db, self.principal, action="order.update", run=run, response_model=OrderOut
        )

    async def void_order(self, order_id: str) -> OrderOut:
        self._assert_admin()
        order = await self._order(order_id)
        status = await _status(self.db, order)
        if status != "open":
            raise Conflict(f"a {status} order can't be voided")

        async def run(cmd: Command) -> OrderOut:
            order.status = "void"
            await self.db.flush()
            cmd.record("order.void", entity_type="order", entity_id=order.id)
            lines = await fetch_lines(self.db, self.biz, "order", order.id)
            return await _out(self.db, order, lines)

        return await run_command(
            self.db, self.principal, action="order.void", run=run, response_model=OrderOut
        )

    async def checkout(self, order_id: str, idempotency_key: str | None) -> CheckoutOut:
        order = await self._order(order_id)
        if await _status(self.db, order) != "open":
            raise Conflict("only an open order can be checked out")
        if order.total_cents <= 0:
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
                amount=order.total_cents,
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

    async def pay_by_card(
        self, order_id: str, data: OrderPayIn, idempotency_key: str | None
    ) -> CheckoutOut:
        """Pay an open sale online: a saved card of the order's client charges now, otherwise a
        new card is confirmed on the card form. The webhook settles it like a reader payment."""
        order = await self._order(order_id)
        if await _status(self.db, order) != "open":
            raise Conflict("only an open order can be paid")
        if order.total_cents <= 0:
            raise Conflict("order has no balance to charge")
        account_id = await self._account()
        client = await self._client(order.client_id) if order.client_id else None
        if data.payment_method_id is not None and client is None:
            raise Unprocessable("a walk-in sale is paid with a new card")
        method = (
            await resolve_saved_method_ref(self.db, self.biz, data.payment_method_id, client.id)
            if client is not None
            else None
        )

        async def run(cmd: Command) -> CheckoutOut:
            payment, client_secret = await open_order_card_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                order=order,
                client=client,
                amount=order.total_cents,
                fee_bps=get_settings().platform_fee_bps,
                payment_method=method,
                idempotency_key=idempotency_key,
            )
            cmd.record("order.pay", entity_type="order", entity_id=order.id)
            return CheckoutOut(
                order_id=order.id, client_secret=client_secret, payment_id=payment.id
            )

        return await run_command(
            self.db,
            self.principal,
            action="order.pay",
            run=run,
            response_model=CheckoutOut,
            idempotency_key=idempotency_key,
        )

    async def set_pickup(self, order_id: str, data: OrderPickupIn) -> OrderOut:
        """Move a paid online order along: ready for the client, then picked up."""
        order = await self._order(order_id)
        if order.source != "online" or order.pickup_status is None:
            raise Conflict("only an online order is picked up")
        if await _status(self.db, order) != "paid":
            raise Conflict("the order isn't paid yet")
        if _PICKUP_STEPS[data.status] <= _PICKUP_STEPS[order.pickup_status]:
            raise Conflict(f"the order is already {order.pickup_status.replace('_', ' ')}")

        async def run(cmd: Command) -> OrderOut:
            order.pickup_status = data.status
            await self.db.flush()
            cmd.record("order.pickup", entity_type="order", entity_id=order.id)
            lines = await fetch_lines(self.db, self.biz, "order", order.id)
            return await _out(self.db, order, lines)

        return await run_command(
            self.db, self.principal, action="order.pickup", run=run, response_model=OrderOut
        )

    async def _account(self) -> str:
        business = await self.db.get(Business, self.biz)
        if (
            business is None
            or not business.stripe_charges_enabled
            or business.stripe_account_id is None
        ):
            raise Conflict("connect a Stripe account before taking payment")
        return business.stripe_account_id

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
        order.currency = await self._currency(lines)
        apply_totals(order, await tax_for_lines(self.db, self.biz, lines))

    async def _currency(self, lines: list[Line]) -> str:
        """A sale is in its items' currency (CAD when it has only free-text lines)."""
        ids = {ln.item_id for ln in lines if ln.item_id}
        if not ids:
            return "CAD"
        rows = await self.db.execute(
            scoped(Item, self.biz).with_only_columns(Item.currency).where(Item.id.in_(ids))
        )
        currencies = set(rows.scalars().all())
        if len(currencies) > 1:
            raise Unprocessable("one sale can't mix currencies")
        return currencies.pop()

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


async def _status(db: AsyncSession, order: Order) -> str:
    status, _ = await ledger.order_state(db, order)
    return status


async def _out(db: AsyncSession, order: Order, lines: list[Line]) -> OrderOut:
    paid, _ = await ledger.collected(db, order.business_id, "order", order.id)
    status, paid_at = await ledger.order_state(db, order)
    return OrderOut(
        id=order.id,
        business_id=order.business_id,
        client_id=order.client_id,
        staff_id=order.staff_id,
        status=status,
        currency=order.currency,
        subtotal_cents=order.subtotal_cents,
        tax_total_cents=order.tax_total_cents,
        total_cents=order.total_cents,
        amount_paid_cents=paid,
        balance_cents=order.total_cents - paid if status == "open" else 0,
        paid_at=paid_at,
        receipt_email=order.receipt_email,
        receipt_phone=order.receipt_phone,
        source=order.source,
        pickup_status=order.pickup_status,
        lines=[line_out(ln) for ln in lines],
    )
