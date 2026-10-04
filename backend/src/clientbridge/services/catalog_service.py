from collections.abc import Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page
from clientbridge.models.catalog import BOOKABLE_KINDS, Item
from clientbridge.schemas.catalog import ItemCreate, ItemUpdate


class CatalogService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Item], int]:
        biz = self.principal.business_id
        items = await scoped_page(self.db, Item, biz, limit=limit, offset=offset)
        return items, await scoped_count(self.db, Item, biz)

    async def get(self, item_id: str) -> Item:
        return await load_item(self.db, self.principal.business_id, item_id, require_active=False)

    async def create(self, data: ItemCreate) -> Item:
        bookable = (
            data.kind in BOOKABLE_KINDS if data.online_bookable is None else data.online_bookable
        )
        item = Item(
            id=new_id("item"),
            business_id=self.principal.business_id,
            created_by=self.principal.user_id,
            kind=data.kind,
            name=data.name,
            description=data.description,
            price_cents=data.price_cents,
            currency=data.currency,
            duration_min=data.duration_min,
            capacity=data.capacity,
            category=data.category,
            color=data.color,
            online_bookable=bookable,
            active=data.active,
            tax_class=data.tax_class,
            sku=data.sku,
            cost_cents=data.cost_cents,
            track_stock=data.track_stock,
            stock_on_hand=0 if data.track_stock else None,
            low_stock_at=data.low_stock_at,
        )
        _assert_shape(item)
        self.db.add(item)
        await self._save(item)
        return item

    async def update(self, item_id: str, data: ItemUpdate) -> Item:
        item = await self.get(item_id)
        changes = data.model_dump(exclude_unset=True)
        for key, value in changes.items():
            setattr(item, key, value)
        if "online_bookable" not in changes and item.kind not in BOOKABLE_KINDS:
            item.online_bookable = False
        if item.track_stock and item.stock_on_hand is None:
            item.stock_on_hand = 0
        _assert_shape(item)
        await self._save(item)
        return item

    async def _save(self, item: Item) -> None:
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise Conflict("another item already uses that SKU") from exc
        await self.db.refresh(item)
        await self.db.commit()

    async def deactivate(self, item_id: str) -> None:
        # Items are referenced by lines/bookings, so "delete" deactivates rather than removing.
        item = await self.get(item_id)
        item.active = False
        await self.db.commit()


async def load_item(
    db: AsyncSession, biz: str, item_id: str, *, require_active: bool = True
) -> Item:
    """Load a catalog item by id (active-only by default), else NotFound. Shared by the booking and
    scheduling flows, which resolve the item they operate on."""
    q = scoped(Item, biz).where(Item.id == item_id)
    if require_active:
        q = q.where(Item.active.is_(True))
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        raise NotFound("item not found")
    return row


def _assert_shape(item: Item) -> None:
    if item.online_bookable and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes can be booked online")
    if item.track_stock and item.kind != "product":
        raise Unprocessable("only products can track stock")


def deposit_cents(item: Item) -> int:
    """The deposit owed for a booking of this item: fixed cents, or a percent of its price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return int(item.deposit_value)
    return round(item.price_cents * float(item.deposit_value) / 100)
