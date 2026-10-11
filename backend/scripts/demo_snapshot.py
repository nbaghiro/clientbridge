import asyncio
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.ledger import Account
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.services import ledger
from clientbridge.services.bookings import open_slots
from clientbridge.services.catalog import deposit_cents
from clientbridge.services.tax import tax_for_amount

BIZ = "bz_birchbark"
DESTINATION = (
    Path(__file__).resolve().parents[2] / "frontend/apps/site/src/content/demo-snapshot.ts"
)


def label(value: str) -> str:
    return value.replace("—", "-")


async def calendar_snapshot(
    db: AsyncSession,
    business: Business,
    as_of: datetime,
    clients: dict[str, Client],
    items: dict[str, Item],
) -> dict[str, object]:
    zone = ZoneInfo(business.timezone)
    local = as_of.astimezone(zone)
    monday = local.date() - timedelta(days=local.weekday())
    weekdays = sorted(
        {
            day
            for day in (
                await db.scalars(
                    select(Hours.weekday).where(
                        Hours.business_id == BIZ,
                        Hours.staff_id == "st_owner",
                        Hours.basis == "recurring",
                        Hours.available.is_(True),
                        Hours.weekday.isnot(None),
                    )
                )
            ).all()
            if day is not None
        }
    )
    dates = [monday + timedelta(days=day) for day in weekdays if day is not None]
    if len(dates) != 5:
        raise ValueError("The marketing calendar expects five actual working weekdays")
    days = [
        {"iso": day.isoformat(), **({"today": True} if day == local.date() else {})}
        for day in dates
    ]
    slots = {
        row.id: row for row in (await db.scalars(select(Slot).where(Slot.business_id == BIZ))).all()
    }
    pets = {
        row.id: row
        for row in (await db.scalars(select(Subject).where(Subject.business_id == BIZ))).all()
    }
    bookings = (
        await db.scalars(
            select(Booking).where(
                Booking.business_id == BIZ,
                Booking.staff_id == "st_owner",
                Booking.status.in_(["completed", "confirmed", "pending"]),
            )
        )
    ).all()
    events: list[dict[str, object]] = []
    shown: set[tuple[int, str]] = set()
    shown_slots: set[str] = set()
    day_counts: dict[int, int] = {}
    for booking in sorted(bookings, key=lambda row: slots[row.slot_id].starts_at):
        slot = slots[booking.slot_id]
        start, end = slot.starts_at.astimezone(zone), slot.ends_at.astimezone(zone)
        minute = start.hour * 60 + start.minute
        duration = int((end - start).total_seconds() / 60)
        if start.date() not in dates or minute < 540 or minute + duration > 900 or duration < 45:
            continue
        day = dates.index(start.date())
        if (
            slot.id in shown_slots
            or (day, booking.client_id) in shown
            or day_counts.get(day, 0) >= 3
        ):
            continue
        pet = pets.get(booking.subject_id or "")
        events.append(
            {
                "day": day,
                "client": clients[booking.client_id].name,
                "service": label(items[slot.item_id].name),
                "top": round((minute - 540) * 44 / 60) + 4,
                "height": round(duration * 44 / 60) - 4,
                "accent": booking.status == "confirmed",
                "bookingId": booking.id,
                "itemId": slot.item_id,
                "date": start.date().isoformat(),
                "startMinute": minute,
                "durationMinutes": duration,
                "species": pet.attributes.get("species") if pet else None,
            }
        )
        shown.add((day, booking.client_id))
        shown_slots.add(slot.id)
        day_counts[day] = day_counts.get(day, 0) + 1
    return {
        "days": days,
        "hours": list(range(9, 15)),
        "events": events,
    }


async def booking_snapshot(
    db: AsyncSession, business: Business, item: Item, as_of: datetime
) -> dict[str, object]:
    zone = ZoneInfo(business.timezone)
    for offset in range(1, 15):
        day = as_of.astimezone(zone).date() + timedelta(days=offset)
        openings = await open_slots(db, BIZ, item, "st_owner", day)
        if openings:
            return {
                "date": day.isoformat(),
                "times": [value.astimezone(zone).strftime("%H:%M") for value in openings[:4]],
                "selectedTime": 0,
                "depositCents": deposit_cents(item),
            }
    raise ValueError("No real booking openings found for the marketing snapshot")


async def main() -> None:
    async with SessionLocal() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        audit = await db.get(Audit, "aud_demo_seed")
        if audit is None:
            raise ValueError("Export requires a versioned demo seed")
        business = await db.get(Business, BIZ)
        if business is None:
            raise ValueError("Demo business is missing")
        as_of = datetime.fromisoformat(str(audit.changes["as_of"]))
        items = {
            r.id: r for r in (await db.scalars(select(Item).where(Item.business_id == BIZ))).all()
        }
        clients = {
            r.id: r
            for r in (await db.scalars(select(Client).where(Client.business_id == BIZ))).all()
        }
        invoices = []
        for invoice in (
            await db.scalars(
                select(Invoice)
                .where(
                    Invoice.id.in_(
                        ["inv_1001", "inv_1002", "inv_1003", "inv_1004", "inv_1005", "inv_draft"]
                    )
                )
                .order_by(Invoice.number.desc())
            )
        ).all():
            status = await db.scalar(
                select(ledger.invoice_status_expr()).where(Invoice.id == invoice.id)
            )
            invoices.append(
                {
                    "number": str(invoice.number),
                    "client": clients[invoice.client_id].name,
                    "totalCents": invoice.total_cents,
                    "paid": status == "paid",
                }
            )
        activity = []
        for payment in (
            await db.scalars(
                select(Payment)
                .where(
                    Payment.business_id == BIZ,
                    Payment.status == "succeeded",
                    Payment.kind == "payment",
                    Payment.client_id.isnot(None),
                )
                .order_by(Payment.paid_at.desc())
                .limit(5)
            )
        ).all():
            activity.append(
                {
                    "paymentId": payment.id,
                    "amountCents": payment.amount_cents,
                    "method": payment.method,
                    "who": clients[payment.client_id or ""].name,
                    "paidAt": payment.paid_at.isoformat() if payment.paid_at else None,
                }
            )
        awaiting = await ledger.account_total(db, BIZ, Account.category == "receivable")
        taxes = -await ledger.account_total(db, BIZ, Account.category == "tax")
        revenue = -await ledger.account_total(db, BIZ, Account.category == "revenue")
        count_invoices = await db.scalar(
            select(func.count()).select_from(Invoice).where(Invoice.business_id == BIZ)
        )
        count_estimates = await db.scalar(
            select(func.count()).select_from(Estimate).where(Estimate.business_id == BIZ)
        )
        service_ids = ["it_groom_lg", "it_bath", "it_cat", "it_nails"]
        stock = []
        for item_id in ["it_shampoo", "it_brush", "it_nails"]:
            item = items[item_id]
            stock.append(
                {
                    "image": f"/images/demo/{item.id}.jpg",
                    "name": label(item.name),
                    "sku": item.sku,
                    "priceCents": item.price_cents,
                    "tracked": item.track_stock,
                    "onHand": item.stock_on_hand,
                    "low": item.track_stock
                    and (item.stock_on_hand or 0) <= (item.low_stock_at or 0),
                }
            )
        tap_item = items["it_groom_sm"]
        tap_tax = await tax_for_amount(db, BIZ, tap_item.price_cents, tax_class=tap_item.tax_class)
        snapshot = {
            "version": audit.changes.get("version"),
            "asOf": audit.changes.get("as_of"),
            "timezone": business.timezone,
            "currency": "CAD",
            "invoices": invoices,
            "invoiceCount": count_invoices,
            "estimateCount": count_estimates,
            "services": [
                {
                    "image": f"/images/demo/{iid}.jpg",
                    "name": label(items[iid].name),
                    "minutes": items[iid].duration_min,
                    "priceCents": items[iid].price_cents,
                }
                for iid in service_ids
            ],
            "stockRows": stock,
            "tapToPay": {
                "client": clients["cl_amelie"].name,
                "itemId": tap_item.id,
                "subtotalCents": tap_tax.subtotal_cents,
                "taxCents": tap_tax.tax_total_cents,
                "totalCents": tap_tax.total_cents,
                "taxes": [
                    {"code": code, "cents": cents}
                    for code, cents in tap_tax.by_jurisdiction.items()
                ],
            },
            "calendar": await calendar_snapshot(db, business, as_of, clients, items),
            "bookingPage": await booking_snapshot(db, business, items[service_ids[0]], as_of),
            "shop": {
                "items": [
                    {
                        "image": f"/images/demo/{iid}.jpg",
                        "name": label(items[iid].name),
                        "onHand": items[iid].stock_on_hand,
                        "priceCents": items[iid].price_cents,
                        "qty": 1,
                    }
                    for iid in ["it_shampoo", "it_brush"]
                ],
            },
            "today": {
                "salesCents": revenue,
                "awaitingCents": awaiting,
                "taxCents": taxes,
                "activity": activity,
            },
        }
    await engine.dispose()
    DESTINATION.write_text(
        "// Generated by backend/scripts/demo_snapshot.py from the validated demo.\n"
        "export const demoSnapshot = "
        + json.dumps(snapshot, ensure_ascii=False, indent=4)
        + " as const;\n"
    )
    subprocess.run(
        ["pnpm", "exec", "prettier", "--write", str(DESTINATION)],
        cwd=Path(__file__).resolve().parents[2] / "frontend",
        check=True,
    )
    print(DESTINATION)


if __name__ == "__main__":
    asyncio.run(main())
