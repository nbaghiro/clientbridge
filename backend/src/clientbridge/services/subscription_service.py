from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import PaymentMethod
from clientbridge.schemas.subscriptions import SubscriptionCreate, SubscriptionOut
from clientbridge.services.payment_service import (
    ensure_customer,
    ensure_subscription_price,
    map_subscription_status,
)


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
            return _out(row)

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
            return _out(sub)

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


def _out(sub: Subscription) -> SubscriptionOut:
    return SubscriptionOut(
        id=sub.id,
        client_id=sub.client_id,
        item_id=sub.item_id,
        status=sub.status,
        current_period_start=sub.current_period_start,
        current_period_end=sub.current_period_end,
    )
