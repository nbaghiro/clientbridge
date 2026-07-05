from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page
from clientbridge.models.catalog import Item
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
            online_bookable=data.online_bookable,
            active=data.active,
        )
        self.db.add(item)
        await self.db.flush()
        await self.db.refresh(item)
        await self.db.commit()
        return item

    async def update(self, item_id: str, data: ItemUpdate) -> Item:
        item = await self.get(item_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(item, key, value)
        await self.db.flush()
        await self.db.refresh(item)
        await self.db.commit()
        return item

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


def deposit_cents(item: Item) -> int:
    """The deposit owed for a booking of this item: fixed cents, or a percent of its price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return int(item.deposit_value)
    return round(item.price_cents * float(item.deposit_value) / 100)
