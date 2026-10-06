import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod
from clientbridge.schemas.entitlements import (
    GiftCardOut,
    GiftCardPurchase,
    GiftCardPurchaseOut,
    GiftCardRedeem,
    PackageOut,
    PackagePurchase,
    PackagePurchaseOut,
    SubscriptionCreate,
    SubscriptionOut,
)
from clientbridge.services import ledger
from clientbridge.services.payments import (
    ensure_customer,
    ensure_subscription_price,
    map_subscription_status,
    open_entitlement_payment,
    resolve_saved_method_ref,
)
from clientbridge.services.tax import tax_for_amount

_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  # base32, no easily-confused 0/1/8/9


def _gift_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(12))


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
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        fee_bps = get_settings().platform_fee_bps
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.purchaser_client_id
        )

        async def run(cmd: Command) -> GiftCardPurchaseOut:
            card_id = new_id("gift_card")
            payment, client_secret = await open_entitlement_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                client=client,
                amount=face,  # a gift certificate is not taxed at sale (taxed on redemption)
                currency="CAD",
                fee_bps=fee_bps,
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
        )

    async def redeem_gift_card(
        self, data: GiftCardRedeem, idempotency_key: str | None = None
    ) -> GiftCardOut:
        self._assert_admin()
        card = await self._by_code(data.code, lock=True)

        async def run(cmd: Command) -> GiftCardOut:
            remaining = await ledger.gift_card_balance(self.db, card)
            if ledger.gift_card_status(card, remaining) != "active":
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


async def activate_purchased_gift_card(db: AsyncSession, payment_id: str) -> str | None:
    """Activate the gift card a settled purchase paid for; returns its id."""
    card = (
        await db.execute(select(GiftCard).where(GiftCard.payment_id == payment_id))
    ).scalar_one_or_none()
    if card is not None and card.status == "pending":
        card.status = "active"
        await db.flush()
        return card.id
    return None


async def void_purchased_gift_card(db: AsyncSession, payment_id: str) -> None:
    """Void the gift card a refunded purchase charge paid for (pending/active → void)."""
    card = (
        await db.execute(select(GiftCard).where(GiftCard.payment_id == payment_id))
    ).scalar_one_or_none()
    if card is not None and card.status in ("pending", "active"):
        card.status = "void"
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
        if item.kind != "package":
            raise Conflict("item is not a package")
        if item.session_count is None:
            raise AppError(
                "package item has no session count", status_code=422, code="invalid_package"
            )
        sessions_total = item.session_count
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        amount = (await tax_for_amount(self.db, self.biz, item.price_cents)).total_cents
        fee_bps = get_settings().platform_fee_bps
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.client_id
        )

        async def run(cmd: Command) -> PackagePurchaseOut:
            package_id = new_id("package")
            payment, client_secret = await open_entitlement_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                client=client,
                amount=amount,
                currency=item.currency,
                fee_bps=fee_bps,
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
                sessions_total=sessions_total,
                status="pending",
                payment_id=payment.id,
                expires_at=(
                    datetime.now(UTC) + timedelta(days=item.validity_days)
                    if item.validity_days
                    else None
                ),
            )
            self.db.add(package)
            await self.db.flush()
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
        sessions_total=package.sessions_total,
        sessions_used=await ledger.sessions_used(db, package),
        status=package.status,
    )


async def activate_purchased_package(db: AsyncSession, payment_id: str) -> None:
    """Activate the package a settled purchase charge paid for (pending → active)."""
    package = (
        await db.execute(select(Package).where(Package.payment_id == payment_id))
    ).scalar_one_or_none()
    if package is not None and package.status == "pending":
        package.status = "active"
        await db.flush()


async def void_purchased_package(db: AsyncSession, payment_id: str) -> None:
    """Void the package a refunded purchase charge paid for (pending/active → canceled)."""
    package = (
        await db.execute(select(Package).where(Package.payment_id == payment_id))
    ).scalar_one_or_none()
    if package is not None and package.status in ("pending", "active"):
        package.status = "canceled"
        await db.flush()


class SubscriptionService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def create_subscription(
        self, data: SubscriptionCreate, idempotency_key: str | None = None
    ) -> SubscriptionOut:
        self._assert_admin()
        business = await self._business()
        if business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before creating subscriptions")
        account_id = business.stripe_account_id
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
                idempotency_key=f"sub_{self.biz}_{data.client_id}_{item.id}",
            )
            row = Subscription(
                id=new_id("subscription"),
                business_id=self.biz,
                client_id=data.client_id,
                item_id=item.id,
                status=map_subscription_status(result.status),
                current_period_start=result.current_period_start,
                current_period_end=result.current_period_end,
                payment_method_id=pm.id,
                provider_ref=result.id,
            )
            self.db.add(row)
            try:
                await self.db.flush()  # unique provider_ref + one-active-per-client+item guards
            except IntegrityError as exc:
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
        )

    async def cancel_subscription(
        self, subscription_id: str, idempotency_key: str | None = None
    ) -> SubscriptionOut:
        self._assert_admin()
        business = await self._business()
        sub = await self._subscription(subscription_id)
        if sub.status == "canceled":
            raise Conflict("subscription is already canceled")
        account_id = business.stripe_account_id
        provider_ref = sub.provider_ref

        async def run(cmd: Command) -> SubscriptionOut:
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
        current_period_start=sub.current_period_start,
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
