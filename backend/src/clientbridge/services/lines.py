"""Shared line and tax helpers for invoices, estimates and orders."""

from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from clientbridge.core.errors import NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_delete
from clientbridge.models.billing import Discounted, Estimate, Invoice, Line, Order
from clientbridge.models.business import Staff
from clientbridge.models.catalog import ENTITLEMENT_KINDS, Item
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.billing import DiscountIn, LineInput, LineOut
from clientbridge.services.tax import TaxResult

LineParent = Literal["estimate", "invoice", "order"]


def parent_fk(parent: LineParent) -> InstrumentedAttribute[str | None]:
    return {"estimate": Line.estimate_id, "invoice": Line.invoice_id, "order": Line.order_id}[
        parent
    ]


def allocate(total: int, weights: list[int]) -> list[int]:
    """Split `total` in whole cents by weight, largest remainder first, so the parts add up."""
    whole = sum(weights)
    if total == 0 or whole <= 0:
        return [0 for _ in weights]
    parts = [total * w // whole for w in weights]
    order = sorted(range(len(weights)), key=lambda i: (-(total * weights[i] % whole), i))
    for i in order[: total - sum(parts)]:
        parts[i] += 1
    return parts


def discount_off(base: int, kind: str | None, value: int | None) -> int:
    """What a percent or amount discount takes off `base`, never more than the base."""
    if kind is None or value is None or base <= 0:
        return 0
    off = (base * value * 2 + 100) // 200 if kind == "percent" else value
    return max(0, min(base, off))


def set_discount(target: Discounted, discount: DiscountIn | None) -> None:
    target.discount_kind = discount.kind if discount else None
    target.discount_value = discount.value if discount else None
    target.discount_reason = discount.reason if discount else None


def discount_of(source: Discounted) -> DiscountIn | None:
    if source.discount_kind is None or not source.discount_value:
        return None
    return DiscountIn.model_validate(
        {
            "kind": source.discount_kind,
            "value": source.discount_value,
            "reason": source.discount_reason,
        }
    )


def gross_cents(line: Line) -> int:
    return int(
        (Decimal(str(line.quantity)) * line.unit_amount_cents).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
    )


def price_lines(lines: list[Line], document: Discounted | None) -> None:
    """Line discounts first, then the document's shared across included lines by value."""
    bases: list[int] = []
    for ln in lines:
        gross = gross_cents(ln)
        ln.discount_cents = discount_off(gross, ln.discount_kind, ln.discount_value)
        bases.append(gross - ln.discount_cents if included(ln) else 0)
    off = (
        discount_off(sum(bases), document.discount_kind, document.discount_value)
        if document is not None
        else 0
    )
    for ln, share in zip(lines, allocate(off, bases), strict=True):
        ln.sale_discount_cents = share
        ln.amount_cents = gross_cents(ln) - ln.discount_cents - share


def discount_total(lines: list[Line]) -> int:
    return sum(ln.discount_cents + ln.sale_discount_cents for ln in lines if included(ln))


async def replace_lines(
    db: AsyncSession,
    business_id: str,
    parent: LineParent,
    parent_id: str,
    inputs: list[LineInput],
    document: Discounted | None = None,
) -> list[Line]:
    """Delete a parent's lines and rebuild them from `inputs`, priced net of discounts."""
    if parent != "estimate" and any(inp.optional for inp in inputs):
        raise Unprocessable("only an estimate can offer optional add-ons")
    await db.execute(scoped_delete(Line, business_id).where(parent_fk(parent) == parent_id))
    items = await _line_items(db, business_id, inputs)
    await _assert_staff(db, business_id, {inp.staff_id for inp in inputs if inp.staff_id})
    await _assert_bookings(db, business_id, {inp.booking_id for inp in inputs if inp.booking_id})
    lines: list[Line] = []
    for i, inp in enumerate(inputs):
        item = items.get(inp.item_id) if inp.item_id else None
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
            tax_class=inp.tax_class or (item.tax_class if item else "standard"),
            position=i,
            optional=inp.optional,
            staff_id=inp.staff_id,
            for_pickup=False,
        )
        set_discount(line, inp.discount)
        db.add(line)
        lines.append(line)
    price_lines(lines, document)
    await db.flush()
    return lines


async def _assert_staff(db: AsyncSession, business_id: str, ids: set[str]) -> None:
    if not ids:
        return
    rows = await db.execute(
        scoped(Staff, business_id).with_only_columns(Staff.id).where(Staff.id.in_(ids))
    )
    if len(set(rows.scalars().all())) != len(ids):
        raise NotFound("staff member not found")


async def _assert_bookings(db: AsyncSession, business_id: str, ids: set[str]) -> None:
    if not ids:
        return
    rows = await db.execute(
        scoped(Booking, business_id, soft_delete=True)
        .with_only_columns(Booking.id)
        .where(Booking.id.in_(ids))
    )
    if len(set(rows.scalars().all())) != len(ids):
        raise NotFound("booking not found")


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
        staff_id=ln.staff_id,
        discount=discount_of(ln),
        discount_cents=ln.discount_cents,
        sale_discount_cents=ln.sale_discount_cents,
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
