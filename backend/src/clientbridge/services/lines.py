"""Shared line and tax helpers for invoices, estimates and orders."""

from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from clientbridge.core.errors import NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_delete
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.catalog import ENTITLEMENT_KINDS, Item
from clientbridge.schemas.billing import LineInput, LineOut
from clientbridge.services.tax import TaxResult

LineParent = Literal["estimate", "invoice", "order"]


def parent_fk(parent: LineParent) -> InstrumentedAttribute[str | None]:
    return {"estimate": Line.estimate_id, "invoice": Line.invoice_id, "order": Line.order_id}[
        parent
    ]


async def replace_lines(
    db: AsyncSession, business_id: str, parent: LineParent, parent_id: str, inputs: list[LineInput]
) -> list[Line]:
    """Delete a parent's lines and rebuild them from `inputs` (amount = qty x unit, half-up)."""
    if parent != "estimate" and any(inp.optional for inp in inputs):
        raise Unprocessable("only an estimate can offer optional add-ons")
    await db.execute(scoped_delete(Line, business_id).where(parent_fk(parent) == parent_id))
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
            estimate_id=parent_id if parent == "estimate" else None,
            invoice_id=parent_id if parent == "invoice" else None,
            order_id=parent_id if parent == "order" else None,
            description=inp.description,
            item_id=inp.item_id,
            booking_id=inp.booking_id,
            quantity=inp.quantity,
            unit_amount_cents=inp.unit_amount_cents,
            amount_cents=int(amount),
            tax_class=inp.tax_class or (item.tax_class if item else "standard"),
            position=i,
            optional=inp.optional,
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
    db: AsyncSession, business_id: str, parent: LineParent, parent_id: str
) -> list[Line]:
    rows = await db.execute(
        scoped(Line, business_id).where(parent_fk(parent) == parent_id).order_by(Line.position)
    )
    return list(rows.scalars().all())


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
        optional=ln.optional,
        selected=ln.selected,
    )


def included(line: Line) -> bool:
    """Every line counts toward its document except an add-on the client didn't pick."""
    return not line.optional or line.selected


def included_totals(lines: list[Line], result: TaxResult) -> TaxResult:
    """The document's totals over its included lines, from a tax result computed for every line."""
    kept = [lt for ln, lt in zip(lines, result.lines, strict=True) if included(ln)]
    subtotal = sum(lt.base_cents for lt in kept)
    tax = sum(lt.tax_cents for lt in kept)
    by_code: dict[str, int] = {}
    for lt in kept:
        for code, cents in lt.by_jurisdiction.items():
            by_code[code] = by_code.get(code, 0) + cents
    return TaxResult(subtotal, tax, subtotal + tax, by_code, kept)


def apply_totals(parent: Invoice | Estimate | Order, result: TaxResult) -> None:
    """Write a tax result's rolled-up subtotal/tax/total onto its billing parent."""
    parent.subtotal_cents = result.subtotal_cents
    parent.tax_total_cents = result.tax_total_cents
    parent.total_cents = result.total_cents
