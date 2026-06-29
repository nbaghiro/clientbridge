"""Shared, parent-agnostic line + tax engine for invoices, estimates, and orders.

The `Line` model is parent-agnostic (parent_type ∈ invoice|estimate|order); these helpers build/
fetch its rows and run the pure tax engine, so the totals logic can't drift between billing and POS.
"""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_delete
from clientbridge.models.billing import Line
from clientbridge.models.identity import Business
from clientbridge.schemas.billing import LineInput
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
    lines: list[Line] = []
    for i, inp in enumerate(inputs):
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
            position=i,
        )
        db.add(line)
        lines.append(line)
    await db.flush()
    return lines


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


async def tax_for_amount(db: AsyncSession, business_id: str, amount_cents: int) -> TaxResult:
    """Tax breakdown for a single taxable amount (e.g. a subscription item's price) via the line
    engine. The transient line is discarded; only the rolled-up TaxResult is returned."""
    return await tax_for_lines(db, business_id, [Line(amount_cents=amount_cents)])


async def tax_for_lines(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """Run the tax engine for a parent's lines, writing each line's tax_amount_cents. The caller
    applies the subtotal/tax/total rollups to its parent (invoice/estimate/order)."""
    rates = await rates_for_business(db, business_id)
    registered = bool(
        (
            await db.execute(select(Business.is_tax_registered).where(Business.id == business_id))
        ).scalar_one()
    )
    result = compute_tax(
        [TaxLine(amount_cents=ln.amount_cents) for ln in lines],
        [TaxComponent(jurisdiction=r.jurisdiction, rate_bps=r.rate_bps) for r in rates],
        registered=registered,
    )
    for ln, line_tax in zip(lines, result.lines, strict=True):
        ln.tax_amount_cents = line_tax.tax_cents
    return result
