import argparse
import asyncio
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import get_args
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import Base, SessionLocal, engine
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, StockMovement
from clientbridge.models.clients import Subject
from clientbridge.models.scheduling import Booking, Hours, Recurrence, Slot, Weekday
from scripts.demo_context import DemoContext


def validate_graph(ctx: DemoContext) -> list[str]:
    errors: list[str] = []
    items = {r.id: r for r in ctx.all(Item)}
    slots = {r.id: r for r in ctx.all(Slot)}
    pets = {r.id: r for r in ctx.all(Subject)}
    bookings = ctx.all(Booking)
    hours = ctx.all(Hours)
    zone = ZoneInfo(ctx.get(Business, ctx.business_id).timezone)
    slot_pets: dict[str, set[str]] = {s: set() for s in slots}
    for booking in bookings:
        slot = slots[booking.slot_id]
        if booking.subject_id:
            slot_pets[slot.id].add(booking.subject_id)
            pet = pets[booking.subject_id]
            if pet.client_id != booking.client_id:
                errors.append(f"{booking.id}: pet owner mismatch")
            if (slot.item_id == "it_cat") != (
                pet.attributes.get("species") == "cat"
            ) and slot.item_id in {"it_cat", "it_groom_sm", "it_groom_lg"}:
                errors.append(f"{booking.id}: incompatible species")
            if (
                slot.item_id == "it_groom_sm"
                and float(str(pet.attributes.get("weight_kg", 0))) > 11.34
            ):
                errors.append(f"{booking.id}: small dog weight limit")
        if booking.confirmed_at and booking.confirmed_at > ctx.now:
            errors.append(f"{booking.id}: future confirmation")
        if booking.status == "completed" and (
            not booking.completed_at
            or booking.completed_at < slot.ends_at
            or slot.ends_at > ctx.now
        ):
            errors.append(f"{booking.id}: completion chronology")
        if booking.status in {"pending", "confirmed"} and slot.ends_at < ctx.now:
            errors.append(f"{booking.id}: stale upcoming booking; reseed the isolated demo")
    active = [s for s in slots.values() if s.status != "canceled"]
    for index, slot in enumerate(active):
        local, end = slot.starts_at.astimezone(zone), slot.ends_at.astimezone(zone)
        dated = [
            h
            for h in hours
            if h.staff_id == slot.staff_id and h.basis == "date" and h.date == local.date()
        ]
        windows = dated or [
            h
            for h in hours
            if h.staff_id == slot.staff_id
            and h.basis == "recurring"
            and h.weekday == local.weekday()
        ]
        if not any(
            h.available
            and h.start_time
            and h.end_time
            and h.start_time <= local.time()
            and end.time() <= h.end_time
            for h in windows
        ):
            errors.append(f"{slot.id}: outside working hours")
        if (
            sum(
                b.status not in {"canceled", "waitlisted"} for b in bookings if b.slot_id == slot.id
            )
            > slot.capacity
        ):
            errors.append(f"{slot.id}: over capacity")
        for other in active[index + 1 :]:
            if (
                slot.staff_id != other.staff_id
                and slot.resource_id != other.resource_id
                and not slot_pets[slot.id] & slot_pets[other.id]
            ):
                continue
            left, right = items[slot.item_id], items[other.item_id]
            if slot.starts_at - timedelta(
                minutes=left.buffer_before_min or 0
            ) < other.ends_at + timedelta(
                minutes=right.buffer_after_min or 0
            ) and other.starts_at - timedelta(
                minutes=right.buffer_before_min or 0
            ) < slot.ends_at + timedelta(minutes=left.buffer_after_min or 0):
                errors.append(f"{slot.id}/{other.id}: staff, resource or pet conflict")
    for recurrence in ctx.all(Recurrence):
        occurrences = [s for s in slots.values() if s.recurrence_id == recurrence.id]
        if recurrence.count and len(occurrences) != recurrence.count:
            errors.append(f"{recurrence.id}: occurrence count mismatch")
        if any(
            get_args(Weekday)[s.starts_at.astimezone(zone).weekday()]
            not in (recurrence.byday or [])
            for s in occurrences
        ):
            errors.append(f"{recurrence.id}: weekday mismatch")
    documents: list[Invoice | Estimate] = [*ctx.all(Invoice), *ctx.all(Estimate)]
    for doc in documents:
        field = "invoice_id" if isinstance(doc, Invoice) else "estimate_id"
        lines = [
            r
            for r in ctx.all(Line)
            if getattr(r, field) == doc.id and (not r.optional or r.selected)
        ]
        if (
            not lines
            or sum(r.amount_cents for r in lines) != doc.subtotal_cents
            or sum(r.tax_amount_cents for r in lines) != doc.tax_total_cents
            or doc.subtotal_cents + doc.tax_total_cents != doc.total_cents
        ):
            errors.append(f"{doc.id}: document totals do not match selected lines")
    for card in ctx.all(GiftCard):
        if card.payment_id and card.expires_at:
            errors.append(f"{card.id}: purchased cash gift card expires")
    for item in items.values():
        if (
            item.track_stock
            and sum(m.quantity for m in ctx.all(StockMovement) if m.item_id == item.id)
            != item.stock_on_hand
        ):
            errors.append(f"{item.id}: stock cache mismatch")
    return errors


SQL_CHECKS = {
    "refund_chronology": (
        "SELECT r.id FROM payments r JOIN payments p ON p.id=r.parent_payment_id "
        "WHERE r.kind='refund' AND r.status='succeeded' AND "
        "(r.paid_at IS NULL OR p.paid_at IS NULL OR r.paid_at < p.paid_at)"
    ),
    "future_settled_payment": (
        "SELECT id FROM payments WHERE status='succeeded' AND (paid_at IS NULL OR paid_at > :as_of)"
    ),
    "unbalanced_journals": (
        "SELECT journal_id FROM entries GROUP BY journal_id HAVING sum(amount_cents) != 0"
    ),
    "account_cache": (
        "SELECT a.id FROM accounts a LEFT JOIN entries e ON e.account_id=a.id GROUP BY "
        "a.id, a.balance_cents HAVING a.balance_cents != coalesce(sum(e.amount_cents),0)"
    ),
    "invoice_client": (
        "SELECT b.id FROM bookings b JOIN invoices i ON i.id=b.invoice_id WHERE "
        "b.client_id != i.client_id OR b.business_id != i.business_id"
    ),
    "payment_owner": (
        "SELECT p.id FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE "
        "p.client_id != i.client_id OR p.business_id != i.business_id"
    ),
    "review_chronology": (
        "SELECT r.id FROM reviews r JOIN bookings b ON b.id=r.booking_id WHERE "
        "r.submitted_at < b.completed_at OR b.completed_at IS NULL OR r.client_id != "
        "b.client_id"
    ),
    "duplicate_reviews": (
        "SELECT booking_id FROM reviews WHERE booking_id IS NOT NULL "
        "GROUP BY booking_id HAVING count(*) > 1"
    ),
    "pickup_visibility": (
        "SELECT l.id FROM lines l JOIN orders o ON o.id=l.order_id WHERE "
        "o.source='online' AND (not l.for_pickup OR o.status_token IS NULL)"
    ),
    "broadcast_content": "SELECT id FROM broadcasts WHERE body IS NULL OR length(trim(body))=0",
    "future_overdue_notice": "SELECT id FROM invoices WHERE overdue_notified_at > :as_of",
    "incomplete_signatures": (
        "SELECT id FROM signatures WHERE status='signed' AND (signed_body IS NULL OR "
        "signer_name IS NULL OR signed_at IS NULL OR method IS NULL)"
    ),
}


async def validate_database(
    db: AsyncSession, *, as_of: datetime | None = None
) -> dict[str, object]:
    ctx = DemoContext(as_of or datetime.now(UTC), "bz_birchbark", "us_dev")
    for model in (
        Business,
        Item,
        Subject,
        Booking,
        Slot,
        Hours,
        Recurrence,
        Invoice,
        Estimate,
        Line,
        GiftCard,
        StockMovement,
    ):
        table = model.__table__
        condition = (
            table.c.id.in_(["bz_birchbark", "bz_demo_second"])
            if model is Business
            else table.c.business_id.in_(["bz_birchbark", "bz_demo_second"])
        )
        ctx.rows.extend((await db.scalars(select(model).where(condition))).all())
    errors = validate_graph(ctx)
    for table in Base.metadata.tables.values():
        if "business_id" not in table.c:
            continue
        for column in table.c:
            for fk in column.foreign_keys:
                parent = fk.column.table
                if "business_id" in parent.c and table is not parent:
                    query = (
                        select(table.c.id)
                        .join(parent, column == fk.column)
                        .where(
                            table.c.business_id.in_(["bz_birchbark", "bz_demo_second"]),
                            table.c.business_id != parent.c.business_id,
                        )
                    )
                    errors.extend(
                        f"{table.name}/{row_id}: cross-business parent"
                        for row_id in (await db.scalars(query)).all()
                    )
    scope = ", ".join(
        f"{table.name} AS (SELECT * FROM public.{table.name} "
        "WHERE business_id IN ('bz_birchbark', 'bz_demo_second'))"
        for table in Base.metadata.tables.values()
        if "business_id" in table.c
    )
    for name, sql in SQL_CHECKS.items():
        failures = (
            (await db.execute(text(f"WITH {scope} {sql}"), {"as_of": ctx.now})).scalars().all()
        )
        errors.extend(f"{name}: {value}" for value in failures)
    return {
        "ok": not errors,
        "as_of": ctx.now.isoformat(),
        "errors": errors,
        "counts": dict(Counter(type(row).__name__ for row in ctx.rows)),
    }


async def main(as_of: datetime | None) -> None:
    async with SessionLocal() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        report = await validate_database(db, as_of=as_of)
    await engine.dispose()
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", type=datetime.fromisoformat)
    args = parser.parse_args()
    asyncio.run(main(args.as_of))
