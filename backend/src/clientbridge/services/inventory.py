from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import Item, StockMovement
from clientbridge.models.payments import Payment
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
            correction = data.quantity < 0
            if correction and data.unit_cost_cents is not None:
                raise Unprocessable("a count correction has no unit cost")
            if data.unit_cost_cents is not None:
                item.cost_cents = data.unit_cost_cents
            await _move(
                self.db,
                item,
                data.quantity,
                "correction" if correction else "restock",
                note=data.note,
                created_by=self.principal.user_id,
                unit_cost_cents=data.unit_cost_cents,
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
            request={"item_id": item_id, "data": data},
        )


async def sync_parent_stock(
    db: AsyncSession, business_id: str, parent: LineParent, parent_id: str, status: str
) -> None:
    """Move a sale's tracked stock out once when paid and back once when fully refunded."""
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
    unit_cost_cents: int | None = None,
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
            unit_cost_cents=unit_cost_cents,
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


async def assert_parent_stock(
    db: AsyncSession, business_id: str, parent: LineParent, parent_id: str
) -> None:
    model = Order if parent == "order" else Invoice
    document = await db.scalar(
        scoped(model, business_id).where(model.id == parent_id).with_for_update()
    )
    strict = isinstance(document, Order) and document.source == "online"
    sold = select(StockMovement.line_id).where(
        StockMovement.reason == "sale", StockMovement.line_id.is_not(None)
    )
    lines = list(
        await db.scalars(
            scoped(Line, business_id).where(
                parent_fk(parent) == parent_id, Line.item_id.is_not(None), ~Line.id.in_(sold)
            )
        )
    )
    wanted: dict[str, int] = {}
    for line in lines:
        if line.item_id is not None:
            units = int(Decimal(str(line.quantity)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            wanted[line.item_id] = wanted.get(line.item_id, 0) + max(units, 0)
    items = list(
        await db.scalars(
            scoped(Item, business_id)
            .where(Item.id.in_(wanted), Item.track_stock.is_(True))
            .order_by(Item.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if not items:
        return
    active = (
        scoped(Payment, business_id)
        .where(
            Payment.kind == "payment",
            Payment.status.in_(("pending", "failed", "succeeded")),
            or_(Payment.order_id == Line.order_id, Payment.invoice_id == Line.invoice_id),
        )
        .exists()
    )
    held = dict(
        (
            await db.execute(
                scoped(Line, business_id)
                .with_only_columns(Line.item_id, func.sum(func.round(Line.quantity)))
                .where(
                    Line.item_id.in_(wanted),
                    ~Line.id.in_(sold),
                    active,
                    or_(parent_fk(parent).is_(None), parent_fk(parent) != parent_id),
                )
                .group_by(Line.item_id)
            )
        )
        .tuples()
        .all()
    )
    for item in items:
        available = (item.stock_on_hand or 0) - int(held.get(item.id, 0))
        if (strict or int(held.get(item.id, 0)) > 0) and wanted[item.id] > available:
            raise Conflict("not enough stock available for this sale", code="out_of_stock")
