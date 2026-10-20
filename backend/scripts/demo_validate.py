import argparse
import asyncio
import json
from collections import Counter
from datetime import datetime, timedelta
from typing import get_args
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import Base, SessionLocal, engine
from clientbridge.core.errors import AppError
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import GiftCard, Item, StockMovement
from clientbridge.models.clients import Subject
from clientbridge.models.documents import Contract, FormResponse, Signature
from clientbridge.models.scheduling import Booking, Hours, Recurrence, Slot, Weekday
from clientbridge.schemas.forms import FormDefinition
from clientbridge.schemas.subjects import ATTRIBUTES
from clientbridge.services.public import validate_answers
from scripts.demo_context import DEMO_BUSINESSES, DemoContext


def validate_graph(ctx: DemoContext) -> list[str]:
    errors: list[str] = []
    items = {r.id: r for r in ctx.all(Item)}
    slots = {r.id: r for r in ctx.all(Slot)}
    pets = {r.id: r for r in ctx.all(Subject)}
    bookings = ctx.all(Booking)
    hours = ctx.all(Hours)
    business = ctx.get(Business, ctx.business_id)
    zone = ZoneInfo(business.timezone)
    if business.subject is not None:
        for subject in pets.values():
            try:
                ATTRIBUTES[business.subject].model_validate(subject.attributes)
            except ValidationError:
                errors.append(f"{subject.id}: attributes do not fit the {business.subject} kind")
    slot_pets: dict[str, set[str]] = {s: set() for s in slots}
    for booking in bookings:
        slot = slots[booking.slot_id]
        if booking.starts_at != slot.starts_at or booking.staff_id != slot.staff_id:
            errors.append(f"{booking.id}: start or member differs from its slot")
        if booking.subject_id:
            slot_pets[slot.id].add(booking.subject_id)
            pet = pets[booking.subject_id]
            if pet.client_id != booking.client_id:
                errors.append(f"{booking.id}: subject owner mismatch")
            if (
                business.subject == "pet"
                and (slot.item_id == "it_cat") != (pet.attributes.get("species") == "cat")
                and slot.item_id in {"it_cat", "it_groom_sm", "it_groom_lg"}
            ):
                errors.append(f"{booking.id}: incompatible species")
            if (
                business.subject == "pet"
                and slot.item_id == "it_groom_sm"
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
        if booking.status == "waitlisted" and slot.ends_at < ctx.now:
            errors.append(f"{booking.id}: still waitlisted after the class ended")
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
        seated = sum(
            b.status not in {"canceled", "waitlisted"} for b in bookings if b.slot_id == slot.id
        )
        if seated > slot.capacity:
            errors.append(f"{slot.id}: over capacity")
        waiting = any(b.status == "waitlisted" for b in bookings if b.slot_id == slot.id)
        if waiting and seated < slot.capacity and slot.starts_at > ctx.now:
            errors.append(f"{slot.id}: a seat is open while someone waits for one")
        for other in active[index + 1 :]:
            if slot.staff_id != other.staff_id and not slot_pets[slot.id] & slot_pets[other.id]:
                continue
            left, right = items[slot.item_id], items[other.item_id]
            if slot.starts_at - timedelta(
                minutes=left.buffer_before_min or 0
            ) < other.ends_at + timedelta(
                minutes=right.buffer_after_min or 0
            ) and other.starts_at - timedelta(
                minutes=right.buffer_before_min or 0
            ) < slot.ends_at + timedelta(minutes=left.buffer_after_min or 0):
                errors.append(f"{slot.id}/{other.id}: staff or pet conflict")
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
        if recurrence.until and any(
            s.status != "canceled" and s.starts_at.astimezone(zone).date() > recurrence.until
            for s in occurrences
        ):
            errors.append(f"{recurrence.id}: live visit after the series ends")
    estimates = {r.id: r for r in ctx.all(Estimate)}
    booked = Counter(
        b.estimate_id
        for b in bookings
        if b.estimate_id is not None and b.status != "canceled" and b.deleted_at is None
    )
    for booking in bookings:
        if booking.estimate_id is None:
            continue
        estimate = estimates.get(booking.estimate_id)
        if estimate is None or estimate.client_id != booking.client_id:
            errors.append(f"{booking.id}: booked from another client's or a missing estimate")
        elif estimate.status != "accepted":
            errors.append(f"{booking.id}: booked from an estimate that is not accepted")
    for estimate_id, count in booked.items():
        if count > 1:
            errors.append(f"{estimate_id}: booked {count} times")
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
    for response in ctx.all(FormResponse):
        definition = FormDefinition.model_validate(response.definition)
        if response.status != "submitted":
            continue
        try:
            validate_answers(definition.fields, response.answers)
        except AppError:
            errors.append(f"{response.id}: answers the form would reject")
        if definition.require_signature and not response.signature:
            errors.append(f"{response.id}: submitted without the signature the form requires")
    contracts = {r.id: r for r in ctx.all(Contract)}
    for signature in ctx.all(Signature):
        contract = contracts[signature.contract_id]
        if signature.status == "signed" and (
            not signature.signed_body
            or signature.contract_version is None
            or signature.contract_version > contract.version
            or (
                signature.contract_version == contract.version
                and signature.signed_body != contract.body
            )
        ):
            errors.append(f"{signature.id}: signed text does not match its contract version")
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
    "review_request_chronology": (
        "SELECT r.id FROM review_requests r JOIN bookings b ON b.id=r.booking_id WHERE "
        "r.requested_at < b.completed_at OR b.completed_at IS NULL OR r.client_id != "
        "b.client_id"
    ),
    "duplicate_review_requests": (
        "SELECT booking_id FROM review_requests WHERE booking_id IS NOT NULL "
        "GROUP BY booking_id HAVING count(*) > 1"
    ),
    "pickup_visibility": (
        "SELECT l.id FROM lines l JOIN orders o ON o.id=l.order_id WHERE "
        "o.source='online' AND (not l.for_pickup OR o.status_token IS NULL)"
    ),
    "broadcast_content": "SELECT id FROM broadcasts WHERE body IS NULL OR length(trim(body))=0",
    "future_overdue_notice": "SELECT id FROM invoices WHERE overdue_notified_at > :as_of",
    "people_photo_parent": (
        "SELECT f.id FROM files f WHERE (f.parent_type IN ('client', 'user') AND f.uploaded_at "
        "IS NULL) OR (f.parent_type='client' AND NOT EXISTS (SELECT 1 FROM "
        "clients c WHERE c.id=f.parent_id AND c.deleted_at IS NULL)) OR (f.parent_type='user' "
        "AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id=f.parent_id AND "
        "s.business_id=f.business_id))"
    ),
    "one_photo_per_person": (
        "SELECT parent_id FROM files WHERE parent_type IN ('client', 'user') AND purpose='photo' "
        "GROUP BY business_id, parent_type, parent_id HAVING count(*) > 1"
    ),
    # stock portraits may not show their people in a bad light
    "photo_on_negative_storyline": (
        "SELECT f.parent_id FROM files f WHERE f.parent_type='client' AND ("
        "EXISTS (SELECT 1 FROM bookings b WHERE b.client_id=f.parent_id AND (b.status IN "
        "('no_show', 'waitlisted') OR b.deposit_status='forfeited')) "
        "OR EXISTS (SELECT 1 FROM estimates e WHERE e.client_id=f.parent_id AND "
        "e.status='declined') "
        "OR EXISTS (SELECT 1 FROM signatures g WHERE g.client_id=f.parent_id AND g.status IN "
        "('declined', 'expired')) "
        "OR EXISTS (SELECT 1 FROM payments p WHERE p.client_id=f.parent_id AND (p.status='failed' "
        "OR p.dispute_status IS NOT NULL)) "
        "OR EXISTS (SELECT 1 FROM subscriptions u WHERE u.client_id=f.parent_id AND "
        "u.status='past_due') "
        "OR EXISTS (SELECT 1 FROM invoices i WHERE i.client_id=f.parent_id AND "
        "(i.overdue_notified_at IS NOT NULL OR (i.status='sent' AND i.total_cents > coalesce(("
        "SELECT sum(p.amount_cents) FROM payments p WHERE p.invoice_id=i.id AND "
        "p.status='succeeded' AND p.kind != 'refund'), 0)))) "
        "OR EXISTS (SELECT 1 FROM responses r WHERE r.client_id=f.parent_id AND "
        "(r.answers->>'rating')::int <= 3))"
    ),
    "incomplete_signatures": (
        "SELECT id FROM signatures WHERE status='signed' AND (signed_body IS NULL OR "
        "signer_name IS NULL OR signed_at IS NULL OR method IS NULL)"
    ),
}


async def validate_database(
    db: AsyncSession, *, as_of: datetime | None = None
) -> dict[str, object]:
    now = as_of or clock.now()
    found = await db.execute(
        select(Business.id, Staff.user_id)
        .join(Staff, Staff.business_id == Business.id)
        .where(Business.id.in_(DEMO_BUSINESSES), Staff.role == "owner")
    )
    owners = {business_id: user_id or "" for business_id, user_id in found.tuples().all()}
    contexts = [
        DemoContext(now, business_id, owners.get(business_id, ""))
        for business_id in DEMO_BUSINESSES
    ]
    for ctx in contexts:
        for model in (
            Business,
            Item,
            Subject,
            Booking,
            Slot,
            Hours,
            Recurrence,
            Contract,
            Signature,
            FormResponse,
            Invoice,
            Estimate,
            Line,
            GiftCard,
            StockMovement,
        ):
            table = model.__table__
            condition = (
                table.c.id == ctx.business_id
                if model is Business
                else table.c.business_id == ctx.business_id
            )
            ctx.rows.extend((await db.scalars(select(model).where(condition))).all())
    errors = [error for ctx in contexts if ctx.all(Business) for error in validate_graph(ctx)]
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
                            table.c.business_id.in_(DEMO_BUSINESSES),
                            table.c.business_id != parent.c.business_id,
                        )
                    )
                    errors.extend(
                        f"{table.name}/{row_id}: cross-business parent"
                        for row_id in (await db.scalars(query)).all()
                    )
    scope = ", ".join(
        f"{table.name} AS (SELECT * FROM public.{table.name} "
        f"WHERE business_id IN ({', '.join(repr(b) for b in DEMO_BUSINESSES)}))"
        for table in Base.metadata.tables.values()
        if "business_id" in table.c
    )
    for name, sql in SQL_CHECKS.items():
        failures = (await db.execute(text(f"WITH {scope} {sql}"), {"as_of": now})).scalars().all()
        errors.extend(f"{name}: {value}" for value in failures)
    return {
        "ok": not errors,
        "as_of": now.isoformat(),
        "errors": errors,
        "counts": {
            ctx.business_id: dict(Counter(type(row).__name__ for row in ctx.rows))
            for ctx in contexts
        },
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
