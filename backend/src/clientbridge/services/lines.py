"""Shared, parent-agnostic line + tax engine for invoices, estimates, and orders.

The `Line` model is parent-agnostic (parent_type ∈ invoice|estimate|order); these helpers build/
fetch its rows and run the pure tax engine, so the totals logic can't drift between billing and POS.
"""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_delete
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.catalog import ENTITLEMENT_KINDS, Item
from clientbridge.schemas.billing import LineInput, LineOut
from clientbridge.services.business_service import business_tax_registered
from clientbridge.services.tax_rates import rates_for_business
from clientbridge.services.tax_service import TaxComponent, TaxLine, TaxResult, compute_tax


async def replace_lines(
    db: AsyncSession, business_id: str, parent_type: str, parent_id: str, inputs: list[LineInput]
) -> list[Line]:
    """Delete a parent's lines and rebuild them from `inputs` (amount = qty x unit, half-up)."""
    await db.execute(
        scoped_delete(Line, business_id).where(
            Line.parent_type == parent_type, Line.parent_id == parent_id
        )
    )
    items = await _line_items(db, business_id, inputs)
    lines: list[Line] = []
    for i, inp in enumerate(inputs):
        item = items.get(inp.item_id) if inp.item_id else None
        amount = (Decimal(str(inp.quantity)) * inp.unit_amount_cents).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
        line = Line(
            id=new_id("line"),
            business_id=business_id,
            parent_type=parent_type,
            parent_id=parent_id,
            description=inp.description,
            item_id=inp.item_id,
            booking_id=inp.booking_id,
            quantity=inp.quantity,
            unit_amount_cents=inp.unit_amount_cents,
            amount_cents=int(amount),
            tax_class=inp.tax_class or (item.tax_class if item else "standard"),
            position=i,
        )
        db.add(line)
        lines.append(line)
    await db.flush()
    return lines


async def _line_items(
    db: AsyncSession, business_id: str, inputs: list[LineInput]
) -> dict[str, Item]:
    ids = {inp.item_id for inp in inputs if inp.item_id}
    if not ids:
        return {}
    rows = await db.execute(scoped(Item, business_id).where(Item.id.in_(ids)))
    items = {item.id: item for item in rows.scalars().all()}
    if len(items) != len(ids):
        raise NotFound("item not found")
    for item in items.values():
        if item.kind in ENTITLEMENT_KINDS:
            raise Unprocessable(
                f"{item.name} is sold through its own checkout (gift cards, packages and "
                "subscriptions create a balance the client can use), not as a line"
            )
    return items


async def fetch_lines(
    db: AsyncSession, business_id: str, parent_type: str, parent_id: str
) -> list[Line]:
    rows = (
        (
            await db.execute(
                scoped(Line, business_id)
                .where(Line.parent_type == parent_type, Line.parent_id == parent_id)
                .order_by(Line.position)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def line_out(ln: Line) -> LineOut:
    return LineOut(
        id=ln.id,
        description=ln.description,
        quantity=float(ln.quantity),
        unit_amount_cents=ln.unit_amount_cents,
        amount_cents=ln.amount_cents,
        tax_amount_cents=ln.tax_amount_cents,
        tax_class=ln.tax_class,
        item_id=ln.item_id,
        booking_id=ln.booking_id,
        position=ln.position,
    )


async def tax_for_amount(db: AsyncSession, business_id: str, amount_cents: int) -> TaxResult:
    """Tax breakdown for a single taxable amount (e.g. a subscription item's price) via the line
    engine. The transient line is discarded; only the rolled-up TaxResult is returned."""
    return await tax_for_lines(db, business_id, [Line(amount_cents=amount_cents)])


async def tax_breakdown(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """The tax engine's result for these lines, without writing anything back."""
    rates = await rates_for_business(db, business_id)
    registered = await business_tax_registered(db, business_id)
    return compute_tax(
        [
            TaxLine(amount_cents=ln.amount_cents, tax_class=ln.tax_class or "standard")
            for ln in lines
        ],
        [TaxComponent(jurisdiction=r.jurisdiction, rate_bps=r.rate_bps) for r in rates],
        registered=registered,
    )


async def tax_for_lines(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """Run the tax engine for a parent's lines, writing each line's tax_amount_cents. The caller
    applies the subtotal/tax/total rollups to its parent (invoice/estimate/order)."""
    result = await tax_breakdown(db, business_id, lines)
    for ln, line_tax in zip(lines, result.lines, strict=True):
        ln.tax_amount_cents = line_tax.tax_cents
    return result


def apply_totals(parent: Invoice | Estimate | Order, result: TaxResult) -> None:
    """Write a tax result's rolled-up subtotal/tax/total onto its billing parent."""
    parent.subtotal_cents = result.subtotal_cents
    parent.tax_total_cents = result.tax_total_cents
    parent.total_cents = result.total_cents
