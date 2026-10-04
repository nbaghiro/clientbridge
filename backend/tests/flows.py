"""Steps shared by the end-to-end flow tests. Every direct database read or write the flows need
lives here, so a schema change edits this module and leaves the flow assertions alone."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice, Order
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.identity import Business
from clientbridge.models.ledger import Entry
from clientbridge.models.messaging import Thread
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.billing import InvoiceOut
from clientbridge.schemas.bookings import BookingOut
from clientbridge.schemas.orders import OrderOut
from clientbridge.services import ledger_service as ledger
from clientbridge.services.billing_service import _invoice_out
from clientbridge.services.booking_service import _booking_out
from clientbridge.services.earning_service import load_earning
from clientbridge.services.lines import fetch_lines
from clientbridge.services.message_service import unread_count
from clientbridge.services.order_service import _out as _order_out
from tests.conftest import BIZ

SLUG = "birchbark"
STRIPE = {"Stripe-Signature": "good"}
INTERAC = {"X-Interac-Secret": "testsecret"}
TWILIO = {"X-Twilio-Signature": "testsecret"}
WIDE = "start=2000-01-01&end=2100-01-01"


def key() -> dict[str, str]:
    return {"Idempotency-Key": uuid.uuid4().hex}


def ok(res: httpx.Response, status: int = 200) -> httpx.Response:
    assert res.status_code == status, res.text
    return res


async def enable_payments(db: AsyncSession, account: str = "acct_test") -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_charges_enabled=True)
    )
    await db.flush()


async def provider_ref(db: AsyncSession, payment_id: str) -> str:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    assert ref
    return str(ref)


async def settle(api: httpx.AsyncClient, db: AsyncSession, payment_id: str) -> None:
    ref = await provider_ref(db, payment_id)
    event = json.dumps(
        {
            "id": f"evt_{uuid.uuid4().hex}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": ref}},
        }
    )
    ok(await api.post("/webhooks/stripe", content=event, headers=STRIPE))


async def stripe_event(api: httpx.AsyncClient, event_type: str, obj: dict[str, object]) -> None:
    body = json.dumps(
        {
            "id": f"evt_{uuid.uuid4().hex}",
            "type": event_type,
            "account": "acct_test",
            "data": {"object": obj},
        }
    )
    ok(await api.post("/webhooks/stripe", content=body, headers=STRIPE))


async def payment(db: AsyncSession, payment_id: str) -> Payment:
    return (
        await db.execute(
            select(Payment)
            .where(Payment.id == payment_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def payment_by_ref(db: AsyncSession, ref: str) -> Payment:
    return (await db.execute(select(Payment).where(Payment.provider_ref == ref))).scalar_one()


async def deposit_payment(db: AsyncSession, booking_id: str) -> str:
    return (
        await db.execute(
            select(Payment.id).where(Payment.booking_id == booking_id, Payment.kind == "deposit")
        )
    ).scalar_one()


async def invoice(db: AsyncSession, invoice_id: str) -> InvoiceOut:
    row = await db.get(Invoice, invoice_id, populate_existing=True)
    assert row is not None
    return await _invoice_out(db, row, await fetch_lines(db, BIZ, "invoice", invoice_id))


async def order(db: AsyncSession, order_id: str) -> OrderOut:
    row = await db.get(Order, order_id, populate_existing=True)
    assert row is not None
    return await _order_out(db, row, await fetch_lines(db, BIZ, "order", order_id))


async def booking(db: AsyncSession, booking_id: str) -> BookingOut:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    session = await db.get(Slot, row.slot_id, populate_existing=True)
    assert session is not None
    return await _booking_out(db, row, session)


async def deposit_held(db: AsyncSession, booking_id: str) -> int:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return await ledger.deposit_held(db, row)


async def business_balance(db: AsyncSession, category: str) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category=category)


async def owner_balance(db: AsyncSession, owner_type: str, owner_id: str, category: str) -> int:
    return await ledger.balance(
        db, BIZ, owner_type=owner_type, owner_id=owner_id, category=category
    )


async def earnings(db: AsyncSession, subject_type: str, subject_id: str) -> list[str]:
    rows = await db.execute(
        select(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.subject_type == subject_type,
            Entry.subject_id == subject_id,
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


async def earning_status(db: AsyncSession, journal_id: str) -> str:
    earning = await load_earning(db, BIZ, journal_id)
    assert earning is not None
    return earning.status


async def package(db: AsyncSession, package_id: str) -> Package:
    row = await db.get(Package, package_id, populate_existing=True)
    assert row is not None
    return row


async def gift_card(db: AsyncSession, gift_card_id: str) -> tuple[str, int]:
    row = await db.get(GiftCard, gift_card_id, populate_existing=True)
    assert row is not None
    return row.status, await ledger.gift_card_balance(db, row)


async def lapse(db: AsyncSession, model: type[GiftCard] | type[Package], row_id: str) -> datetime:
    """Backdate an entitlement's expiry so the next sweep at the returned time lapses it."""
    now = datetime.now(UTC)
    await db.execute(
        update(model).where(model.id == row_id).values(expires_at=now - timedelta(minutes=1))
    )
    await db.flush()
    return now


async def review_id(db: AsyncSession, token: str) -> str:
    found = (
        await db.execute(
            text("SELECT review_id FROM review_requests WHERE token = :t"), {"t": token}
        )
    ).scalar_one()
    assert found
    return str(found)


async def column(db: AsyncSession, table: str, row_id: str, name: str) -> object:
    return (
        await db.execute(text(f"SELECT {name} FROM {table} WHERE id = :id"), {"id": row_id})
    ).scalar()


async def unread(db: AsyncSession, thread_id: str) -> int:
    row = await db.get(Thread, thread_id, populate_existing=True)
    assert row is not None
    return await unread_count(db, row)


async def removed(db: AsyncSession, table: str, row_id: str) -> bool:
    """A sync DELETE soft-deletes rows that carry `deleted_at` and hard-deletes the rest."""
    soft = (
        await db.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = 'deleted_at'"
            ),
            {"t": table},
        )
    ).scalar()
    if soft:
        return await column(db, table, row_id, "deleted_at") is not None
    return await column(db, table, row_id, "id") is None
