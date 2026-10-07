import secrets
import time
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role, is_manager
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter
from clientbridge.core.scoping import scoped
from clientbridge.core.security import hash_password, verify_password
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.billing import Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.orders import (
    CheckoutOut,
    ConnectionTokenOut,
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
    TipIn,
)
from clientbridge.services import ledger
from clientbridge.services.lines import (
    apply_totals,
    discount_of,
    discount_total,
    fetch_lines,
    gross_cents,
    line_out,
    price_lines,
    replace_lines,
    set_discount,
)
from clientbridge.services.payments import (
    TipTerms,
    open_order_card_payment,
    open_terminal_payment,
    resolve_saved_method_ref,
    resolve_tip,
    sync_order,
)
from clientbridge.services.tax import tax_for_lines

_PICKUP_STEPS = {"unfulfilled": 0, "ready": 1, "picked_up": 2}
# a wrong PIN locks the desk out for a while, so four digits can't be guessed in a minute
_pin_attempts = RateLimiter(limit=5, window_s=300.0)


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
                number=await next_order_number(self.db, self.biz),
                status="open",
                receipt_email=data.receipt_email,
                receipt_phone=data.receipt_phone,
                note=data.note,
            )
            set_discount(order, data.discount)
            self.db.add(order)
            await self.db.flush()
            lines = await replace_lines(self.db, self.biz, "order", order.id, data.lines, order)
            await self._settle_terms(order, lines, data.approval_pin)
            cmd.record("order.create", entity_type="order", entity_id=order.id)
            return await order_out(self.db, order, lines)

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
            if "discount" in data.model_fields_set:
                set_discount(order, data.discount)
            for key in ("client_id", "receipt_email", "receipt_phone", "note"):
                if key in data.model_fields_set:
                    setattr(order, key, getattr(data, key))
            if data.lines is not None:
                lines = await replace_lines(self.db, self.biz, "order", order.id, data.lines, order)
            else:
                lines = await fetch_lines(self.db, self.biz, "order", order.id)
                price_lines(lines, order)
            await self._settle_terms(order, lines, data.approval_pin)
            cmd.record("order.update", entity_type="order", entity_id=order.id)
            return await order_out(self.db, order, lines)

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
            await self._link_visits(order, [])
            await self.db.flush()
            cmd.record("order.void", entity_type="order", entity_id=order.id)
            lines = await fetch_lines(self.db, self.biz, "order", order.id)
            return await order_out(self.db, order, lines)

        return await run_command(
            self.db, self.principal, action="order.void", run=run, response_model=OrderOut
        )

    async def checkout(
        self, order_id: str, data: OrderCheckoutIn | None, idempotency_key: str | None
    ) -> CheckoutOut:
        """Open a Tap to Pay (Terminal) charge for what is due, plus any tip."""
        order, due = await self._chargeable(order_id)
        account_id = await self._account()
        tip = await self._tip(order, data)

        async def run(cmd: Command) -> CheckoutOut:
            payment, client_secret = await open_terminal_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                order=order,
                amount=due + tip.cents,
                fee_bps=get_settings().platform_fee_bps,
                idempotency_key=idempotency_key,
                tip=tip,
                due=due,
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
        """Pay an open sale by saved card, or by a new card on the card form."""
        order, due = await self._chargeable(order_id)
        account_id = await self._account()
        client = await self._client(order.client_id) if order.client_id else None
        if data.payment_method_id is not None and client is None:
            raise Unprocessable("a walk-in sale is paid with a new card")
        method = (
            await resolve_saved_method_ref(self.db, self.biz, data.payment_method_id, client.id)
            if client is not None
            else None
        )
        tip = await self._tip(order, data)

        async def run(cmd: Command) -> CheckoutOut:
            payment, client_secret = await open_order_card_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                order=order,
                client=client,
                amount=due + tip.cents,
                fee_bps=get_settings().platform_fee_bps,
                payment_method=method,
                idempotency_key=idempotency_key,
                tip=tip,
                due=due,
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

    async def pay_cash(
        self, order_id: str, data: OrderCashIn, idempotency_key: str | None
    ) -> OrderCashOut:
        """Take cash for what is due plus any tip; the change is what is handed back."""
        await self._order(order_id)

        async def run(cmd: Command) -> OrderCashOut:
            await self.db.execute(select(Order.id).where(Order.id == order_id).with_for_update())
            order, due = await self._chargeable(order_id)
            if await self._has_active_payment(order.id):
                raise Conflict("this sale already has a payment")
            tip = await self._tip(order, data)
            amount = due + tip.cents
            if data.tendered_cents < amount:
                raise Unprocessable("the cash handed over doesn't cover the sale")
            payment = Payment(
                id=new_id("payment"),
                business_id=self.biz,
                client_id=order.client_id,
                kind="payment",
                order_id=order.id,
                amount_cents=amount,
                currency=order.currency,
                method="cash",
                provider="manual",
                tendered_cents=data.tendered_cents,
                tip_cents=tip.cents,
                tip_split=tip.stored(),
                status="succeeded",
                paid_at=datetime.now(UTC),
            )
            self.db.add(payment)
            await self.db.flush()
            await ledger.post_payment(self.db, payment)
            await sync_order(self.db, order.id)
            cmd.record("order.cash", entity_type="payment", entity_id=payment.id)
            return OrderCashOut(
                payment_id=payment.id,
                amount_cents=amount,
                tip_cents=tip.cents,
                change_cents=data.tendered_cents - amount,
            )

        return await run_command(
            self.db,
            self.principal,
            action="order.cash",
            run=run,
            response_model=OrderCashOut,
            idempotency_key=idempotency_key,
        )

    async def held(self) -> list[OrderOut]:
        """Desk sales parked before payment, oldest first; staff read them here, not from sync."""
        rows = await self.db.execute(
            scoped(Order, self.biz)
            .where(
                Order.source == "pos",
                Order.status == "open",
                ledger.order_status_expr() == "open",
            )
            .order_by(Order.created_at)
        )
        return [
            await order_out(self.db, order, await fetch_lines(self.db, self.biz, "order", order.id))
            for order in rows.scalars().all()
        ]

    async def send_receipt(self, order_id: str, data: OrderReceiptIn) -> OrderOut:
        """Choose where a paid sale's receipt goes; the router sends it once this commits."""
        order = await self._order(order_id)
        if await _status(self.db, order) not in ("paid", "refunded"):
            raise Conflict("a receipt is sent once the sale is paid")
        to = data.to.strip()
        if data.channel == "email" and ("@" not in to or "." not in to.split("@")[-1]):
            raise Unprocessable("that email address doesn't look right")
        if data.channel == "sms" and sum(ch.isdigit() for ch in to) < 10:
            raise Unprocessable("that phone number doesn't look right")

        async def run(cmd: Command) -> OrderOut:
            if data.channel == "email":
                order.receipt_email = to
            else:
                order.receipt_phone = to
            order.receipt_channel = data.channel
            order.receipt_sent_at = datetime.now(UTC)
            order.receipt_token = order.receipt_token or secrets.token_urlsafe(16)
            await self.db.flush()
            cmd.record("order.receipt", entity_type="order", entity_id=order.id)
            lines = await fetch_lines(self.db, self.biz, "order", order.id)
            return await order_out(self.db, order, lines)

        return await run_command(
            self.db, self.principal, action="order.receipt", run=run, response_model=OrderOut
        )

    async def set_pin(self, data: PinIn) -> None:
        """An owner's or admin's PIN for approving staff discounts over the limit."""
        assert_role(
            self.principal,
            "owner",
            "admin",
            message="only an owner or admin approves discounts with a PIN",
        )
        user = await self.db.get(User, self.principal.user_id)
        if user is None:
            raise NotFound("user not found")
        user.pin_hash = hash_password(data.pin)
        await self.db.commit()

    async def set_pickup(self, order_id: str, data: OrderPickupIn) -> OrderOut:
        """Move a paid online order along: ready for the client, then picked up."""
        order = await self._order(order_id)
        if order.source != "online" or order.pickup_status is None:
            raise Conflict("only a paid online order is picked up")
        if _PICKUP_STEPS[data.status] <= _PICKUP_STEPS[order.pickup_status]:
            raise Conflict(f"the order is already {order.pickup_status.replace('_', ' ')}")

        async def run(cmd: Command) -> OrderOut:
            now = datetime.now(UTC)
            order.pickup_status = data.status
            if data.status == "ready":
                order.ready_at = now
            else:
                order.picked_up_at = now
            await self.db.flush()
            cmd.record("order.pickup", entity_type="order", entity_id=order.id)
            lines = await fetch_lines(self.db, self.biz, "order", order.id)
            return await order_out(self.db, order, lines)

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
        # The row lock serializes the first Terminal Location mint.
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

    async def _chargeable(self, order_id: str) -> tuple[Order, int]:
        order = await self._order(order_id)
        if await _status(self.db, order) != "open":
            raise Conflict("only an open order can be paid")
        lines = await fetch_lines(self.db, self.biz, "order", order.id)
        if not lines:
            raise Conflict("add something to the sale first")
        return order, order.total_cents - await visit_deposits(self.db, order)

    async def _tip(self, order: Order, data: TipIn | None) -> TipTerms:
        if data is None:
            return TipTerms()
        lines = await fetch_lines(self.db, self.biz, "order", order.id)
        return await resolve_tip(
            self.db, self.biz, data.tip_cents, data.tip_split, lines, order.staff_id
        )

    async def _settle_terms(self, order: Order, lines: list[Line], pin: str | None) -> None:
        order.currency = await self._currency(lines)
        apply_totals(order, await tax_for_lines(self.db, self.biz, lines))
        order.approved_by = await self._approval(lines, pin)
        await self._link_visits(order, lines)
        await self.db.flush()

    async def _approval(self, lines: list[Line], pin: str | None) -> str | None:
        """Who approved a discount over the staff limit; refused when nobody did."""
        off = discount_total(lines)
        if off == 0 or is_manager(self.principal.role):
            return None
        business = await self.db.get(Business, self.biz)
        limit = business.staff_discount_limit_bps if business is not None else 0
        if off * 10000 <= sum(gross_cents(ln) for ln in lines) * limit:
            return None
        if pin is None:
            raise AppError(
                f"discounts over {limit / 100:g}% need an owner or admin to approve them",
                status_code=403,
                code="approval_required",
            )
        if not _pin_attempts.check(f"{self.biz}:{self.principal.staff_id}", time.monotonic()):
            raise AppError(
                "too many PIN attempts, please wait a few minutes",
                status_code=429,
                code="too_many_requests",
            )
        managers = await self.db.execute(
            scoped(Staff, self.biz)
            .with_only_columns(User.id, User.pin_hash)
            .join_from(Staff, User, User.id == Staff.user_id)
            .where(
                Staff.status == "active",
                Staff.role.in_(("owner", "admin")),
                User.pin_hash.is_not(None),
            )
        )
        for user_id, pin_hash in managers.tuples().all():
            if pin_hash is not None and verify_password(pin, pin_hash):
                return str(user_id)
        raise AppError("that PIN isn't right", status_code=403, code="approval_invalid")

    async def _link_visits(self, order: Order, lines: list[Line]) -> None:
        """A visit rung up on this sale points at it, so the desk queue knows it is on a ticket."""
        wanted = {ln.booking_id for ln in lines if ln.booking_id}
        linked = await self.db.execute(
            scoped(Booking, self.biz).where((Booking.order_id == order.id) | Booking.id.in_(wanted))
        )
        for booking in linked.scalars().all():
            if booking.id not in wanted:
                booking.order_id = None
                continue
            if booking.charged_at is not None:
                raise Conflict("this visit has already been paid for")
            if booking.order_id not in (None, order.id):
                other = await self.db.get(Order, booking.order_id)
                if other is not None and other.status != "void":
                    raise Conflict(f"this visit is already on sale S-{other.number}")
            booking.order_id = order.id

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
                scoped(Payment, self.biz)
                .with_only_columns(Payment.id)
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


async def next_order_number(db: AsyncSession, business_id: str) -> int:
    """The next sale number; the business row lock serializes two desks ringing up at once."""
    await db.execute(select(Business.id).where(Business.id == business_id).with_for_update())
    sub = scoped(Order, business_id).subquery()
    current = (await db.execute(select(func.max(sub.c.number)))).scalar_one_or_none()
    return (current or 0) + 1


async def visit_deposits(db: AsyncSession, order: Order) -> int:
    """Deposits held on the visits rung up on an open sale; paying the sale applies them."""
    lines = await fetch_lines(db, order.business_id, "order", order.id)
    held = 0
    for booking_id in dict.fromkeys(ln.booking_id for ln in lines if ln.booking_id):
        booking = await db.get(Booking, booking_id)
        if booking is not None:
            held += await ledger.deposit_held(db, booking)
    return min(held, order.total_cents)


async def _status(db: AsyncSession, order: Order) -> str:
    status, _ = await ledger.order_state(db, order)
    return status


async def order_out(db: AsyncSession, order: Order, lines: list[Line]) -> OrderOut:
    paid, _ = await ledger.collected(db, order.business_id, "order", order.id)
    status, paid_at = await ledger.order_state(db, order)
    tips = await db.execute(
        scoped(Payment, order.business_id)
        .with_only_columns(func.coalesce(func.sum(Payment.tip_cents), 0))
        .where(
            Payment.order_id == order.id, Payment.kind == "payment", Payment.status == "succeeded"
        )
    )
    tip = int(tips.scalar_one())
    applied = await ledger.order_deposit_applied(db, order)
    deposit = applied if status != "open" else await visit_deposits(db, order)
    due = order.total_cents - deposit - (paid - tip) if status == "open" else 0
    return OrderOut(
        id=order.id,
        business_id=order.business_id,
        client_id=order.client_id,
        staff_id=order.staff_id,
        number=order.number,
        status=status,
        currency=order.currency,
        subtotal_cents=order.subtotal_cents,
        tax_total_cents=order.tax_total_cents,
        total_cents=order.total_cents,
        amount_paid_cents=paid,
        balance_cents=max(0, due),
        paid_at=paid_at,
        receipt_email=order.receipt_email,
        receipt_phone=order.receipt_phone,
        source=order.source,
        pickup_status=order.pickup_status,
        ready_at=order.ready_at,
        picked_up_at=order.picked_up_at,
        note=order.note,
        discount=discount_of(order),
        discount_cents=discount_total(lines),
        approved_by=order.approved_by,
        deposit_cents=deposit,
        due_cents=max(0, due),
        tip_cents=tip,
        receipt_channel=order.receipt_channel,
        receipt_sent_at=order.receipt_sent_at,
        lines=[line_out(ln) for ln in lines],
    )
