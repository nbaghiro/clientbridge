import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_can_act_as, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.entitlements import (
    GiftCardOut,
    GiftCardPurchase,
    GiftCardPurchaseOut,
    GiftCardRedeem,
    PackageCover,
    PackageOut,
    PackagePurchase,
    PackagePurchaseOut,
    SubscriptionCreate,
    SubscriptionOut,
)
from clientbridge.services import ledger
from clientbridge.services.bookings import assert_subject
from clientbridge.services.business import merchant_account
from clientbridge.services.earnings import accrue_covered_visit
from clientbridge.services.payments import (
    cancel_open_deposits,
    complete_when_done,
    ensure_customer,
    ensure_subscription_price,
    map_subscription_status,
    open_entitlement_payment,
    resolve_saved_method_ref,
    subscription_fee_percent,
    subscription_terms,
)
from clientbridge.services.tax import tax_for_amount

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  # base32, no easily-confused 0/1/8/9


def _gift_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(12))


def _charge_account(business: Business, data: GiftCardPurchase | PackagePurchase) -> str | None:
    """The Stripe account to charge, or None for cash taken at the desk."""
    if data.cash:
        if data.payment_method_id is not None:
            raise Unprocessable("a sale is paid in cash or by card, not both")
        return None
    if not business.stripe_charges_enabled or business.stripe_account_id is None:
        raise Conflict("set up card payments in Setup before taking payments")
    return business.stripe_account_id


async def _record_cash(
    db: AsyncSession, business_id: str, client_id: str, amount: int, currency: str
) -> Payment:
    """Cash taken at the desk for a package or gift card: settled now, nothing to charge."""
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client_id,
        kind="payment",
        amount_cents=amount,
        currency=currency,
        method="cash",
        provider="manual",
        status="succeeded",
        paid_at=clock.now(),
    )
    db.add(payment)
    await db.flush()
    return payment


async def _settle_cash(db: AsyncSession, payment: Payment) -> None:
    """Book the cash and activate what it bought, once the entitlement row points at it."""
    await ledger.post_payment(db, payment)
    await activate_purchased_package(db, payment.business_id, payment.id)
    await activate_purchased_gift_card(db, payment.business_id, payment.id)


class GiftCardService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def purchase_gift_card(
        self, data: GiftCardPurchase, idempotency_key: str | None = None
    ) -> GiftCardPurchaseOut:
        self._assert_admin()
        face = await self._face_value(data)
        if data.purchaser_client_id is None:
            raise AppError(
                "a purchaser is required to charge a gift card",
                status_code=422,
                code="purchaser_required",
            )
        client = await self._client(data.purchaser_client_id)
        account_id = _charge_account(await self._business(), data)
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.purchaser_client_id
        )

        async def run(cmd: Command) -> GiftCardPurchaseOut:
            card_id = new_id("gift_card")
            client_secret: str | None = None
            if account_id is None:
                payment = await _record_cash(
                    self.db, self.biz, client.id, face, ledger.BUSINESS_CURRENCY
                )
            else:
                payment, client_secret = await open_entitlement_payment(
                    self.db,
                    self.gateway,
                    account_id=account_id,
                    business_id=self.biz,
                    client=client,
                    amount=face,  # a gift certificate is not taxed at sale (taxed on redemption)
                    currency=ledger.BUSINESS_CURRENCY,
                    entitlement_kind="gift_card",
                    entitlement_id=card_id,
                    payment_method=pm_ref,
                    idempotency_key=idempotency_key,
                )
            card = GiftCard(
                id=card_id,
                business_id=self.biz,
                code=_gift_code(),
                item_id=data.item_id,
                initial_cents=face,
                purchaser_client_id=data.purchaser_client_id,
                recipient=data.recipient,
                status="pending",
                payment_id=payment.id,
            )
            self.db.add(card)
            try:
                await self.db.flush()  # (business_id, code) is unique — a collision is a rare retry
            except IntegrityError as exc:
                raise Conflict("gift card code collision — please retry") from exc
            if account_id is None:
                await _settle_cash(self.db, payment)
            cmd.record("gift_card.purchase", entity_type="gift_card", entity_id=card.id)
            return GiftCardPurchaseOut(
                gift_card_id=card.id,
                code=card.code,
                payment_id=payment.id,
                client_secret=client_secret,
            )

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.purchase",
            run=run,
            response_model=GiftCardPurchaseOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def redeem_gift_card(self, data: GiftCardRedeem, idempotency_key: str) -> GiftCardOut:
        self._assert_admin()
        card = await self._by_code(data.code, lock=True)

        async def run(cmd: Command) -> GiftCardOut:
            remaining = await ledger.gift_card_balance(self.db, card)
            expired = card.expires_at is not None and card.expires_at <= clock.now()
            if ledger.gift_card_status(card, remaining) != "active" or expired:
                raise Conflict("only an active gift card can be redeemed")
            if data.amount_cents <= 0 or data.amount_cents > remaining:
                raise Conflict("invalid redemption amount")
            await ledger.post_redemption(self.db, card, data.amount_cents)
            cmd.record("gift_card.redeem", entity_type="gift_card", entity_id=card.id)
            return await _gift_card_out(self.db, card)

        return await run_command(
            self.db,
            self.principal,
            action="gift_card.redeem",
            run=run,
            response_model=GiftCardOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def _face_value(self, data: GiftCardPurchase) -> int:
        if (data.item_id is None) == (data.amount_cents is None):
            raise AppError(
                "provide exactly one of item_id or amount_cents",
                status_code=422,
                code="invalid_gift_card",
            )
        if data.amount_cents is not None:
            return data.amount_cents
        item = await self._item(str(data.item_id))
        if item.kind != "gift":
            raise Conflict("item is not a gift card")
        if item.price_cents <= 0:
            raise Conflict("gift card item has no price")
        return item.price_cents

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage gift cards"
        )

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True)
                .where(Client.id == client_id)
                .with_for_update(read=True, key_share=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(scoped(Item, self.biz).where(Item.id == item_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _by_code(self, code: str, *, lock: bool = False) -> GiftCard:
        query = scoped(GiftCard, self.biz).where(GiftCard.code == code)
        if lock:
            query = query.with_for_update()  # serialize concurrent redemptions (no lost update)
        row = (await self.db.execute(query)).scalar_one_or_none()
        if row is None:
            raise NotFound("gift card not found")
        return row


async def _gift_card_out(db: AsyncSession, card: GiftCard) -> GiftCardOut:
    balance = await ledger.gift_card_balance(db, card)
    return GiftCardOut(
        id=card.id,
        code=card.code,
        initial_cents=card.initial_cents,
        balance_cents=balance,
        status=ledger.gift_card_status(card, balance),
    )


async def activate_purchased_gift_card(
    db: AsyncSession, business_id: str, payment_id: str
) -> str | None:
    """Activate the gift card a settled purchase paid for; returns its id."""
    card = (
        await db.execute(scoped(GiftCard, business_id).where(GiftCard.payment_id == payment_id))
    ).scalar_one_or_none()
    if card is not None and card.status == "pending":
        card.status = "active"
        await db.flush()
        return card.id
    return None


async def void_purchased_gift_card(db: AsyncSession, business_id: str, payment_id: str) -> None:
    """Void the gift card a refunded purchase charge paid for (pending/active → void)."""
    card = (
        await db.execute(scoped(GiftCard, business_id).where(GiftCard.payment_id == payment_id))
    ).scalar_one_or_none()
    if card is not None and card.status in ("pending", "active"):
        card.status = "void"
        await db.flush()


async def restore_purchased_gift_card(db: AsyncSession, business_id: str, payment_id: str) -> None:
    """Reactivate the gift card voided by a refund that Stripe then failed (void → active)."""
    card = (
        await db.execute(scoped(GiftCard, business_id).where(GiftCard.payment_id == payment_id))
    ).scalar_one_or_none()
    if card is not None and card.status == "void":
        card.status = "active"
        await db.flush()


class PackageService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def purchase_package(
        self, data: PackagePurchase, idempotency_key: str | None = None
    ) -> PackagePurchaseOut:
        self._assert_admin()
        client = await self._client(data.client_id)
        item = await self._item(data.item_id)
        if data.subject_id is not None:
            await assert_subject(self.db, self.biz, data.subject_id, client.id)
        if item.kind != "package":
            raise Conflict("item is not a package")
        if item.session_count is None:
            raise AppError(
                "package item has no session count", status_code=422, code="invalid_package"
            )
        sessions_total = item.session_count
        account_id = _charge_account(await self._business(), data)
        amount = (
            await tax_for_amount(self.db, self.biz, item.price_cents, tax_class=item.tax_class)
        ).total_cents
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.client_id
        )

        async def run(cmd: Command) -> PackagePurchaseOut:
            package_id = new_id("package")
            client_secret: str | None = None
            if account_id is None:
                payment = await _record_cash(self.db, self.biz, client.id, amount, item.currency)
            else:
                payment, client_secret = await open_entitlement_payment(
                    self.db,
                    self.gateway,
                    account_id=account_id,
                    business_id=self.biz,
                    client=client,
                    amount=amount,
                    currency=item.currency,
                    entitlement_kind="package",
                    entitlement_id=package_id,
                    payment_method=pm_ref,
                    idempotency_key=idempotency_key,
                )
            package = Package(
                id=package_id,
                business_id=self.biz,
                client_id=data.client_id,
                item_id=item.id,
                subject_id=data.subject_id,
                sessions_total=sessions_total,
                status="pending",
                payment_id=payment.id,
                expires_at=(
                    clock.now() + timedelta(days=item.validity_days) if item.validity_days else None
                ),
            )
            self.db.add(package)
            await self.db.flush()
            if account_id is None:
                await _settle_cash(self.db, payment)
            cmd.record("package.purchase", entity_type="package", entity_id=package.id)
            return PackagePurchaseOut(
                package_id=package.id, payment_id=payment.id, client_secret=client_secret
            )

        return await run_command(
            self.db,
            self.principal,
            action="package.purchase",
            run=run,
            response_model=PackagePurchaseOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def consume_session(
        self, package_id: str, idempotency_key: str | None = None
    ) -> PackageOut:
        self._assert_admin()
        package = await self._package(package_id, lock=True)

        async def run(cmd: Command) -> PackageOut:
            if package.status != "active":
                raise Conflict("only an active package can be consumed")
            used = await ledger.sessions_used(self.db, package)
            if used >= package.sessions_total:
                raise Conflict("no sessions left on this package")
            await ledger.post_consumption(self.db, package)
            if used + 1 >= package.sessions_total:
                package.status = "used"
            await self.db.flush()
            cmd.record("package.consume", entity_type="package", entity_id=package.id)
            return await _package_out(self.db, package)

        return await run_command(
            self.db,
            self.principal,
            action="package.consume",
            run=run,
            response_model=PackageOut,
            idempotency_key=idempotency_key,
            request={"package_id": package_id},
        )

    async def cover_visit(
        self, package_id: str, data: PackageCover, idempotency_key: str | None = None
    ) -> PackageOut:
        """Settle a started visit with one of the client's package sessions, completing it."""
        package = await self._package(package_id, lock=True)
        booking = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True)
                .where(Booking.id == data.booking_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if booking is None:
            raise NotFound("booking not found")
        assert_can_act_as(self.principal, booking.staff_id)
        slot = await self.db.get(Slot, booking.slot_id)
        assert slot is not None

        async def run(cmd: Command) -> PackageOut:
            now = clock.now()
            billed = booking.invoice_id is not None and (
                (invoice := await self.db.get(Invoice, booking.invoice_id)) is not None
                and invoice.status != "void"
            )
            if (
                booking.status != "confirmed"
                or booking.order_id is not None
                or booking.charged_at is not None
                or billed
            ):
                raise Conflict("only an open visit that isn't billed can use a package")
            if booking.deposit_status == "collected":
                raise Conflict("refund or apply this visit's deposit before using a package")
            if slot.starts_at > now:
                raise Conflict("a package covers a visit once it has started")
            covers = (await self._item(package.item_id)).covers_item_id
            if package.client_id != booking.client_id or covers not in (None, slot.item_id):
                raise Conflict("this package is for another client or service")
            if package.subject_id is not None and package.subject_id != booking.subject_id:
                raise Unprocessable(
                    "this package is for another of the client's subjects",
                    code="package_other_subject",
                )
            if package.status != "active" or (
                package.expires_at is not None and package.expires_at <= now
            ):
                raise Conflict("only an active package can cover a visit")
            used = await ledger.sessions_used(self.db, package)
            if used >= package.sessions_total:
                raise Conflict("no sessions left on this package")
            if booking.deposit_status == "pending":
                if not await cancel_open_deposits(self.db, self.gateway, booking):
                    raise Conflict("this visit's deposit has just been paid")
                booking.deposit_status = "none"
            booking.package_id = package.id
            booking.status, booking.completed_at = "completed", now
            await complete_when_done(self.db, slot)
            share = await ledger.post_consumption(self.db, package, booking_id=booking.id)
            await accrue_covered_visit(self.db, booking, share, package.id)
            if used + 1 >= package.sessions_total:
                package.status = "used"
            await self.db.flush()
            cmd.record("package.cover", entity_type="booking", entity_id=booking.id)
            return await _package_out(self.db, package)

        return await run_command(
            self.db,
            self.principal,
            action="package.cover",
            run=run,
            response_model=PackageOut,
            idempotency_key=idempotency_key,
            request={"package_id": package_id, **data.model_dump()},
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage packages"
        )

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(scoped(Item, self.biz).where(Item.id == item_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _package(self, package_id: str, *, lock: bool = False) -> Package:
        query = scoped(Package, self.biz).where(Package.id == package_id)
        if lock:
            query = query.with_for_update()  # serialize concurrent consumes (no over-consumption)
        row = (await self.db.execute(query)).scalar_one_or_none()
        if row is None:
            raise NotFound("package not found")
        return row


async def _package_out(db: AsyncSession, package: Package) -> PackageOut:
    return PackageOut(
        id=package.id,
        client_id=package.client_id,
        item_id=package.item_id,
        subject_id=package.subject_id,
        sessions_total=package.sessions_total,
        sessions_used=await ledger.sessions_used(db, package),
        status=package.status,
    )


async def activate_purchased_package(db: AsyncSession, business_id: str, payment_id: str) -> None:
    """Activate the package a settled purchase charge paid for (pending → active)."""
    package = (
        await db.execute(scoped(Package, business_id).where(Package.payment_id == payment_id))
    ).scalar_one_or_none()
    if package is not None and package.status == "pending":
        package.status = "active"
        await db.flush()


async def void_purchased_package(db: AsyncSession, business_id: str, payment_id: str) -> None:
    """Void the package a refunded purchase charge paid for (pending/active → canceled)."""
    package = (
        await db.execute(scoped(Package, business_id).where(Package.payment_id == payment_id))
    ).scalar_one_or_none()
    if package is not None and package.status in ("pending", "active"):
        package.status = "canceled"
        await db.flush()


async def restore_purchased_package(db: AsyncSession, business_id: str, payment_id: str) -> None:
    """Reactivate the package canceled by a refund that Stripe then failed (canceled → active)."""
    package = (
        await db.execute(scoped(Package, business_id).where(Package.payment_id == payment_id))
    ).scalar_one_or_none()
    if package is not None and package.status == "canceled":
        package.status = "active"
        await db.flush()


class SubscriptionService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def create_subscription(
        self, data: SubscriptionCreate, idempotency_key: str
    ) -> SubscriptionOut:
        self._assert_admin()
        business = await self._business()
        account_id = merchant_account(business)
        if account_id is None:
            raise Conflict("set up card payments in Setup before creating subscriptions")
        client = await self._client(data.client_id)
        item = await self._item(data.item_id)
        if item.kind != "subscription":
            raise Conflict("item is not a subscription")
        if item.interval is None or item.frequency is None:
            raise AppError(
                "subscription item has no interval/frequency",
                status_code=422,
                code="invalid_subscription",
            )
        interval_count, frequency = item.interval, item.frequency
        pm = await self._payment_method(data.payment_method_id, data.client_id)
        if pm.provider_ref is None:
            raise NotFound("payment method not found")
        pm_ref = pm.provider_ref

        async def run(cmd: Command) -> SubscriptionOut:
            # Stripe charges the first period on create, so two creates for a client never overlap
            await self.db.execute(select(Client.id).where(Client.id == client.id).with_for_update())
            live = await self.db.scalar(
                scoped(Subscription, self.biz)
                .with_only_columns(Subscription.id)
                .where(
                    Subscription.client_id == data.client_id,
                    Subscription.item_id == item.id,
                    Subscription.status != "canceled",
                )
            )
            if live is not None:
                raise Conflict("a subscription for this client and item already exists")
            customer_id = await ensure_customer(self.db, self.gateway, account_id, client)
            price_id = await ensure_subscription_price(
                self.db,
                self.gateway,
                account_id,
                item,
                interval_count=interval_count,
                frequency=frequency,
            )
            result = await self.gateway.create_subscription(
                account_id,
                customer_id=customer_id,
                price_id=price_id,
                payment_method_id=pm_ref,
                metadata=subscription_terms(item, data.client_id),
                application_fee_percent=subscription_fee_percent(pm.method),
                idempotency_key=f"sub_{self.biz}_{idempotency_key}",
            )
            row = Subscription(
                id=new_id("subscription"),
                business_id=self.biz,
                client_id=data.client_id,
                item_id=item.id,
                status=map_subscription_status(result.status),
                current_period_end=result.current_period_end,
                payment_method_id=pm.id,
                provider_ref=result.id,
            )
            self.db.add(row)
            try:
                await self.db.flush()  # unique provider_ref + one-active-per-client+item guards
            except IntegrityError as exc:
                # a concurrent create won; end the duplicate Stripe just started billing
                await self.gateway.cancel_subscription(account_id, subscription_id=result.id)
                raise Conflict("a subscription for this client and item already exists") from exc
            cmd.record("subscription.create", entity_type="subscription", entity_id=row.id)
            return _subscription_out(row)

        return await run_command(
            self.db,
            self.principal,
            action="subscription.create",
            run=run,
            response_model=SubscriptionOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def cancel_subscription(
        self, subscription_id: str, idempotency_key: str | None = None
    ) -> SubscriptionOut:
        self._assert_admin()
        business = await self._business()
        sub = await self._subscription(subscription_id)
        account_id = business.stripe_account_id
        provider_ref = sub.provider_ref

        async def run(cmd: Command) -> SubscriptionOut:
            if sub.status == "canceled":
                raise Conflict("subscription is already canceled")
            if provider_ref is not None and account_id is not None:
                await self.gateway.cancel_subscription(account_id, subscription_id=provider_ref)
            sub.status = "canceled"
            await self.db.flush()
            cmd.record("subscription.cancel", entity_type="subscription", entity_id=sub.id)
            return _subscription_out(sub)

        return await run_command(
            self.db,
            self.principal,
            action="subscription.cancel",
            run=run,
            response_model=SubscriptionOut,
            idempotency_key=idempotency_key,
            request={"subscription_id": subscription_id},
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal,
            "owner",
            "admin",
            message="only an owner or admin can manage subscriptions",
        )

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(scoped(Item, self.biz).where(Item.id == item_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _payment_method(self, payment_method_id: str, client_id: str) -> PaymentMethod:
        row = (
            await self.db.execute(
                scoped(PaymentMethod, self.biz).where(
                    PaymentMethod.id == payment_method_id, PaymentMethod.client_id == client_id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("payment method not found")
        if row.method == "bank_eft" and row.mandate_status != "active":
            raise Conflict(
                "the client must complete bank authorization before this account can be charged"
            )
        return row

    async def _subscription(self, subscription_id: str) -> Subscription:
        row = (
            await self.db.execute(
                scoped(Subscription, self.biz).where(Subscription.id == subscription_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("subscription not found")
        return row


def _subscription_out(sub: Subscription) -> SubscriptionOut:
    return SubscriptionOut(
        id=sub.id,
        client_id=sub.client_id,
        item_id=sub.item_id,
        status=sub.status,
        current_period_end=sub.current_period_end,
    )


async def run_expiry_sweeps(db: AsyncSession, now: datetime) -> int:
    """Expire gift cards and packages past their date, booking the unspent balance as revenue."""
    swept = 0
    gift_cards = (
        (
            await db.execute(
                select(GiftCard)
                .where(
                    GiftCard.status == "active",
                    GiftCard.expires_at.is_not(None),
                    GiftCard.expires_at < now,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for gift_card in gift_cards:
        if await ledger.gift_card_balance(db, gift_card) == 0:
            continue
        gift_card.status = "expired"
        await ledger.post_breakage(
            db,
            gift_card.business_id,
            owner_type="gift_card",
            owner_id=gift_card.id,
            category="gift_card",
        )
        swept += 1
    packages = (
        (
            await db.execute(
                select(Package)
                .where(
                    Package.status == "active",
                    Package.expires_at.is_not(None),
                    Package.expires_at < now,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for package in packages:
        package.status = "expired"
        await ledger.post_breakage(
            db, package.business_id, owner_type="package", owner_id=package.id, category="deferred"
        )
        swept += 1
    await db.commit()
    return swept
