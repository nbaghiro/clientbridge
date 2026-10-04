from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.billing import Order
from clientbridge.models.catalog import Item
from clientbridge.models.identity import Business, Staff
from clientbridge.models.platform import IdempotencyKey
from clientbridge.schemas.billing import LineInput
from clientbridge.schemas.public_shop import (
    PublicShop,
    PublicShopItem,
    PublicShopLine,
    PublicShopOrderCreate,
    PublicShopOrderResult,
)
from clientbridge.services.client_service import find_or_create_by_contact
from clientbridge.services.lines import apply_totals, replace_lines, tax_for_lines
from clientbridge.services.media_service import item_images
from clientbridge.services.payment_service import open_order_card_payment
from clientbridge.services.public_common import public_brand

_SCOPE = "shop.order"


async def shop_items(db: AsyncSession, business_id: str) -> list[PublicShopItem]:
    """A business's products listed for sale online (also offered as booking add-ons)."""
    items = (
        (
            await db.execute(
                scoped(Item, business_id)
                .where(Item.sell_online.is_(True), Item.active.is_(True), Item.kind == "product")
                .order_by(Item.name)
            )
        )
        .scalars()
        .all()
    )
    images = await item_images(db, business_id, [i.id for i in items])
    return [
        PublicShopItem(
            id=i.id,
            name=i.name,
            description=i.description,
            price_cents=i.price_cents,
            currency=i.currency,
            image_url=images.get(i.id),
            in_stock=not i.track_stock or (i.stock_on_hand or 0) > 0,
        )
        for i in items
    ]


async def online_items(
    db: AsyncSession, business_id: str, lines: list[PublicShopLine]
) -> list[tuple[Item, int]]:
    """Each requested product with its quantity (repeats merged); only active products listed for
    sale online in this business."""
    wanted: dict[str, int] = {}
    for line in lines:
        wanted[line.item_id] = wanted.get(line.item_id, 0) + line.quantity
    rows = (
        (
            await db.execute(
                scoped(Item, business_id).where(
                    Item.id.in_(wanted),
                    Item.sell_online.is_(True),
                    Item.active.is_(True),
                    Item.kind == "product",
                )
            )
        )
        .scalars()
        .all()
    )
    found = {i.id: i for i in rows}
    if set(found) != set(wanted):
        raise NotFound("product not found")
    return [(found[item_id], qty) for item_id, qty in wanted.items()]


class PublicShopService:
    """The unauthenticated shop (#4), keyed by ``Business.slug`` like the booking page. An order is
    paid by card online and collected in person; the webhook settles it like any other sale."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def shop(self, slug: str) -> PublicShop:
        business = await self._business(slug)
        return PublicShop(
            business_name=business.name,
            brand=public_brand(business),
            items=await shop_items(self.db, business.id),
            stripe_account_id=_account(business),
        )

    async def order(
        self, slug: str, data: PublicShopOrderCreate, idempotency_key: str
    ) -> PublicShopOrderResult:
        business = await self._business(slug)
        account_id = _account(business)
        if account_id is None:
            raise Conflict("this shop isn't taking online payments yet")
        prior = (
            await self.db.execute(
                select(IdempotencyKey).where(
                    IdempotencyKey.business_id == business.id,
                    IdempotencyKey.scope == _SCOPE,
                    IdempotencyKey.key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            return PublicShopOrderResult.model_validate(prior.response)
        wanted = await online_items(self.db, business.id, data.lines)
        for item, qty in wanted:
            if item.track_stock and (item.stock_on_hand or 0) < qty:
                raise Conflict(f"only {max(item.stock_on_hand or 0, 0)} left of {item.name}")
        if len({item.currency for item, _ in wanted}) > 1:
            raise Unprocessable("one order can't mix currencies")
        client = await find_or_create_by_contact(
            self.db,
            business.id,
            name=data.client.name,
            email=data.client.email,
            phone=data.client.phone,
            source="online_shop",
        )
        order = Order(
            id=new_id("order"),
            business_id=business.id,
            client_id=client.id,
            staff_id=await self._owner_staff(business.id),
            status="open",
            currency=wanted[0][0].currency,
            source="online",
            pickup_status="unfulfilled",
        )
        self.db.add(order)
        await self.db.flush()
        lines = await replace_lines(
            self.db,
            business.id,
            "order",
            order.id,
            [
                LineInput(
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                    item_id=item.id,
                )
                for item, qty in wanted
            ],
        )
        apply_totals(order, await tax_for_lines(self.db, business.id, lines))
        await self.db.flush()
        _, client_secret = await open_order_card_payment(
            self.db,
            self.gateway,
            account_id=account_id,
            business_id=business.id,
            order=order,
            client=client,
            amount=order.total_cents,
            fee_bps=get_settings().platform_fee_bps,
            idempotency_key=idempotency_key,
        )
        result = PublicShopOrderResult(
            order_id=order.id,
            total_cents=order.total_cents,
            currency=order.currency,
            client_secret=client_secret,
            stripe_account_id=account_id,
        )
        self.db.add(
            IdempotencyKey(
                id=new_id("idempotency_key"),
                business_id=business.id,
                scope=_SCOPE,
                key=idempotency_key,
                response=result.model_dump(mode="json"),
            )
        )
        await self.db.commit()
        return result

    async def _owner_staff(self, business_id: str) -> str:
        staff_id = (
            await self.db.execute(
                scoped(Staff, business_id)
                .with_only_columns(Staff.id)
                .where(Staff.role == "owner", Staff.status == "active")
                .order_by(Staff.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if staff_id is None:
            raise NotFound("shop not found")
        return staff_id

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("shop not found")
        return business


def _account(business: Business) -> str | None:
    return business.stripe_account_id if business.stripe_charges_enabled else None
