from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.repositories.catalog import ItemRepository
from clientbridge.schemas.catalog import ItemCreate, ItemUpdate
from clientbridge.services.base import BaseService


class CatalogService(BaseService):
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        super().__init__(db, principal)
        self.repo = ItemRepository(db, principal.business_id)

    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Item], int]:
        items = await self.repo.list(limit=limit, offset=offset)
        total = await self.repo.count()
        return items, total

    async def get(self, item_id: str) -> Item:
        item = await self.repo.get(item_id)
        if item is None:
            raise NotFound("item not found")
        return item

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
            tax_rate_id=data.tax_rate_id,
            category=data.category,
            color=data.color,
            online_bookable=data.online_bookable,
            active=data.active,
        )
        await self.repo.add(item)
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
