from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Line
from clientbridge.models.catalog import Item, StockMovement
from clientbridge.schemas.catalog import ItemOut, RestockIn
from clientbridge.services.lines import LineParent, parent_fk


class StockService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def restock(
        self, item_id: str, data: RestockIn, idempotency_key: str | None = None
    ) -> ItemOut:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can restock items"
        )

        async def run(cmd: Command) -> ItemOut:
            item = await _locked_item(self.db, self.biz, item_id)
            if item is None:
                raise NotFound("item not found")
            if not item.track_stock:
                raise Conflict("turn on stock tracking for this product first")
            await _move(
                self.db,
                item,
                data.quantity,
                "restock",
                note=data.note,
                created_by=self.principal.user_id,
            )
            cmd.record("item.restock", entity_type="item", entity_id=item.id)
            await self.db.refresh(item)
            return ItemOut.model_validate(item)

        return await run_command(
            self.db,
            self.principal,
            action="item.restock",
            run=run,
            response_model=ItemOut,
            idempotency_key=idempotency_key,
        )


async def sync_parent_stock(
    db: AsyncSession, business_id: str, parent: LineParent, parent_id: str, status: str
) -> None:
    """Move stock for a sale's tracked products as its status settles: out once when it is paid,
    back once when it is fully refunded. Stock may go below zero; it never blocks a sale."""
    if status not in ("paid", "refunded"):
        return
    rows = await db.execute(
        scoped(Line, business_id)
        .add_columns(Item.id)
        .join(Item, Item.id == Line.item_id)
        .where(
            parent_fk(parent) == parent_id,
            Item.track_stock.is_(True),
        )
        .order_by(Item.id)
    )
    for line, item_id in rows.tuples().all():
        units = int(Decimal(str(line.quantity)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        if units <= 0:
            continue
        if status == "paid":
            await _move_once(db, business_id, item_id, line.id, "sale", -units)
        elif await _has_movement(db, line.id, "sale"):
            await _move_once(db, business_id, item_id, line.id, "refund", units)


async def _move_once(
    db: AsyncSession, business_id: str, item_id: str, line_id: str, reason: str, quantity: int
) -> None:
    item = await _locked_item(db, business_id, item_id)
    if item is None:
        return
    inserted = await db.execute(
        insert(StockMovement)
        .values(
            id=new_id("stock_movement"),
            business_id=business_id,
            item_id=item_id,
            line_id=line_id,
            reason=reason,
            quantity=quantity,
        )
        .on_conflict_do_nothing(
            index_elements=["line_id", "reason"], index_where=StockMovement.line_id.isnot(None)
        )
        .returning(StockMovement.id)
    )
    if inserted.scalar_one_or_none() is not None:
        item.stock_on_hand = (item.stock_on_hand or 0) + quantity
        await db.flush()


async def _move(
    db: AsyncSession,
    item: Item,
    quantity: int,
    reason: str,
    *,
    note: str | None = None,
    created_by: str | None = None,
) -> None:
    db.add(
        StockMovement(
            id=new_id("stock_movement"),
            business_id=item.business_id,
            item_id=item.id,
            reason=reason,
            quantity=quantity,
            note=note,
            created_by=created_by,
        )
    )
    item.stock_on_hand = (item.stock_on_hand or 0) + quantity
    await db.flush()


async def _has_movement(db: AsyncSession, line_id: str, reason: str) -> bool:
    found = await db.execute(
        select(StockMovement.id).where(
            StockMovement.line_id == line_id, StockMovement.reason == reason
        )
    )
    return found.scalar_one_or_none() is not None


async def _locked_item(db: AsyncSession, business_id: str, item_id: str) -> Item | None:
    rows = await db.execute(
        scoped(Item, business_id)
        .where(Item.id == item_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return rows.scalar_one_or_none()
