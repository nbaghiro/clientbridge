from collections.abc import Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page
from clientbridge.models.catalog import BOOKABLE_KINDS, Item
from clientbridge.schemas.catalog import (
    ItemCreate,
    ItemUpdate,
    TaxClassChange,
    TaxClassResult,
)


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

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can edit the catalog"
        )

    async def set_tax_class(
        self, data: TaxClassChange, idempotency_key: str | None
    ) -> TaxClassResult:
        """One tax class for many items; issued documents keep the class copied onto their lines."""
        self._assert_admin()
        ids = set(data.item_ids)
        items = (
            (
                await self.db.execute(
                    scoped(Item, self.principal.business_id).where(Item.id.in_(ids))
                )
            )
            .scalars()
            .all()
        )
        if len(items) != len(ids):
            raise NotFound("item not found")

        async def run(cmd: Command) -> TaxClassResult:
            for item in items:
                if item.tax_class != data.tax_class:
                    cmd.record(
                        "item.tax_class",
                        entity_type="item",
                        entity_id=item.id,
                        changes={"from": item.tax_class, "to": data.tax_class},
                    )
                    item.tax_class = data.tax_class
            await self.db.flush()
            return TaxClassResult(count=len(items))

        return await run_command(
            self.db,
            self.principal,
            action="item.tax_class",
            run=run,
            response_model=TaxClassResult,
            idempotency_key=idempotency_key,
        )

    async def create(self, data: ItemCreate) -> Item:
        self._assert_admin()
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
            sell_online=data.sell_online,
            stock_on_hand=0 if data.track_stock else None,
            low_stock_at=data.low_stock_at,
            buffer_before_min=data.buffer_before_min,
            buffer_after_min=data.buffer_after_min,
            deposit_type=data.deposit_type,
            deposit_value=data.deposit_value,
            session_count=data.session_count,
            validity_days=data.validity_days,
            interval=data.interval,
            frequency=data.frequency,
        )
        _assert_shape(item)
        self.db.add(item)
        await self._save(item)
        return item

    async def update(self, item_id: str, data: ItemUpdate) -> Item:
        self._assert_admin()
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
        self._assert_admin()
        # Items are referenced by lines/bookings, so "delete" deactivates rather than removing.
        item = await self.get(item_id)
        item.active = False
        await self.db.commit()


async def load_item(
    db: AsyncSession, biz: str, item_id: str, *, require_active: bool = True
) -> Item:
    """Load a catalog item by id (active only by default), else NotFound."""
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
    if item.sell_online and item.kind != "product":
        raise Unprocessable("only products can be sold online")
    if item.deposit_type != "none" and item.kind not in BOOKABLE_KINDS:
        raise Unprocessable("only services and classes take a deposit")
    if (
        item.deposit_type == "percent"
        and item.deposit_value is not None
        and item.deposit_value > 100
    ):
        raise Unprocessable("a percentage deposit can't be over 100")
    if item.session_count is not None and item.kind != "package":
        raise Unprocessable("only packages have a session count")
    if (item.interval is not None or item.frequency is not None) and item.kind != "subscription":
        raise Unprocessable("only subscriptions repeat")


def deposit_cents(item: Item) -> int:
    """The deposit owed for a booking of this item: fixed cents, or a percent of its price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return int(item.deposit_value)
    return round(item.price_cents * float(item.deposit_value) / 100)
