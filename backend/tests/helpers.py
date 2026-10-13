"""Helpers shared by the test files: setup steps, Stripe events and direct database reads."""

import json
import os
import uuid
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from typing import NoReturn

import httpx
import pytest
from pydantic_settings import SettingsConfigDict
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import Settings, get_settings
from clientbridge.core.ids import new_id
from clientbridge.integrations.resend import resend_signature
from clientbridge.integrations.twilio import twilio_signature
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Entry
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.billing import InvoiceOut
from clientbridge.schemas.bookings import BookingOut
from clientbridge.schemas.orders import OrderOut
from clientbridge.services import ledger
from clientbridge.services.billing import invoice_out
from clientbridge.services.bookings import booking_out
from clientbridge.services.business import local_today
from clientbridge.services.earnings import load_earning
from clientbridge.services.lines import fetch_lines
from clientbridge.services.messaging import open_thread, unread_count
from clientbridge.services.orders import order_out as _order_out
from tests.conftest import BIZ, RESEND_SECRET, book_invoice

SLUG = "birchbark"
STRIPE = {"Stripe-Signature": "good"}
TWILIO_TOKEN = "testtoken"
WIDE = "start=2000-01-01&end=2100-01-01"


class EnvSettings(Settings):
    """Settings from arguments and the environment only; a developer's .env is not read."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")


async def text_in(api: httpx.AsyncClient, data: dict[str, str]) -> httpx.Response:
    """Post an inbound SMS signed the way Twilio signs it."""
    url = f"{get_settings().api_base_url}/webhooks/sms"
    signature = twilio_signature(TWILIO_TOKEN, url, list(data.items()))
    return await api.post("/webhooks/sms", data=data, headers={"X-Twilio-Signature": signature})


async def email_event(
    api: httpx.AsyncClient,
    body: Mapping[str, object],
    *,
    svix_id: str,
    at: datetime | None = None,
    signature: str | None = None,
    raw: bytes | None = None,
) -> httpx.Response:
    """Post a Resend delivery event signed the way Svix signs it."""
    payload = raw if raw is not None else json.dumps(body).encode()
    timestamp = str(int((at or clock.wall()).timestamp()))
    signed = signature or f"v1,{resend_signature(RESEND_SECRET, svix_id, timestamp, payload)}"
    headers = {
        "svix-id": svix_id,
        "svix-timestamp": timestamp,
        "svix-signature": signed,
        "Content-Type": "application/json",
    }
    return await api.post("/webhooks/email", content=payload, headers=headers)


async def texted(
    db: AsyncSession, client_id: str, *, business_id: str = BIZ, at: datetime | None = None
) -> None:
    """Record an outbound text to the client, which routes the client's replies to the business."""
    thread = await open_thread(db, business_id, client_id, "sms")
    db.add(
        Message(
            id=new_id("message"),
            business_id=business_id,
            thread_id=thread.id,
            direction="out",
            channel="sms",
            body="Hello",
            status="sent",
            created_at=at or clock.now(),
        )
    )
    await db.flush()


async def local_hour(db: AsyncSession, hour: int, business_id: str = BIZ) -> datetime:
    """Move the business to the zone where the local hour is now `hour`; returns now."""
    now = clock.now()
    offset = (hour - now.hour + 11) % 24 - 11
    zone = "Etc/GMT" if offset == 0 else f"Etc/GMT{'-' if offset > 0 else '+'}{abs(offset)}"
    await db.execute(update(Business).where(Business.id == business_id).values(timezone=zone))
    await db.flush()
    return now


async def business_today(db: AsyncSession) -> date:
    """Today in the demo business's zone, the date its reports and returns go by."""
    business = await db.get(Business, BIZ)
    assert business is not None
    return local_today(business)


def service_missing(reason: str) -> NoReturn:
    """Skip locally, but fail in CI, where the job started the service and its absence is a bug."""
    if os.environ.get("CI"):
        pytest.fail(reason)
    pytest.skip(reason)


def key() -> dict[str, str]:
    return {"Idempotency-Key": uuid.uuid4().hex}


def ok(res: httpx.Response, status: int = 200) -> httpx.Response:
    assert res.status_code == status, res.text
    return res


async def enable_payments(db: AsyncSession, account: str | None = "acct_test") -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_charges_enabled=account is not None)
    )
    await db.flush()


async def client_id(db: AsyncSession, *, business_id: str = BIZ, email: str | None = None) -> str:
    """A seeded client of the business, optionally given an email."""
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == business_id).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    if email is not None:
        await db.execute(update(Client).where(Client.id == cid).values(email=email))
        await db.flush()
    return cid


async def new_client(
    db: AsyncSession,
    *,
    name: str = "Test Client",
    email: str | None = "client@example.ca",
    customer: str | None = None,
) -> str:
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name=name,
        email=email,
        tags=[],
        custom_fields={},
        stripe_customer_id=customer,
    )
    db.add(client)
    await db.flush()
    return client.id


async def sent_invoice(
    db: AsyncSession,
    *,
    client: str | None = None,
    total: int = 5000,
    number: int | None = None,
    status: str = "sent",
    business_id: str = BIZ,
    due_at: datetime | None = None,
    pay_token: str | None = None,
) -> str:
    """An invoice written straight to the database, booked to the ledger unless draft or void."""
    inv = Invoice(
        id=new_id("invoice"),
        business_id=business_id,
        client_id=client or await client_id(db, business_id=business_id),
        number=number,
        status=status,
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        due_at=due_at,
        pay_token=pay_token,
    )
    db.add(inv)
    await db.flush()
    if status not in ("draft", "void"):
        await book_invoice(db, inv)
    return inv.id


async def card_pay(
    api: httpx.AsyncClient, db: AsyncSession, invoice_id: str, tip_cents: int = 0
) -> str:
    """Open a card payment through the invoice's public pay link and return the payment id."""
    inv = await db.get(Invoice, invoice_id, populate_existing=True)
    assert inv is not None
    if inv.pay_token is None:
        inv.pay_token = uuid.uuid4().hex
        await db.flush()
    res = ok(await api.post(f"/pay/{inv.pay_token}/card", json={"tip_cents": tip_cents}))
    ref = str(res.json()["client_secret"]).removesuffix("_secret")
    return (await payment_by_ref(db, ref)).id


async def provider_ref(db: AsyncSession, payment_id: str) -> str:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    assert ref
    return str(ref)


async def settle(
    api: httpx.AsyncClient, db: AsyncSession, payment_id: str, event_id: str | None = None
) -> None:
    ref = await provider_ref(db, payment_id)
    event = json.dumps(
        {
            "id": event_id or f"evt_{uuid.uuid4().hex}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": ref}},
        }
    )
    ok(await api.post("/webhooks/stripe", content=event, headers=STRIPE))


async def stripe_event(api: httpx.AsyncClient, event_type: str, obj: Mapping[str, object]) -> None:
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


async def begin(db: AsyncSession, booking_id: str, *, by: timedelta = timedelta(days=1095)) -> None:
    """Move the visit's session back in time (three years, clear of the seed) so it has started."""
    slot_id = (
        await db.execute(select(Booking.slot_id).where(Booking.id == booking_id))
    ).scalar_one()
    await db.execute(
        update(Slot)
        .where(Slot.id == slot_id)
        .values(starts_at=Slot.starts_at - by, ends_at=Slot.ends_at - by)
    )
    await db.execute(
        update(Booking).where(Booking.slot_id == slot_id).values(starts_at=Booking.starts_at - by)
    )


async def deposit_payment(db: AsyncSession, booking_id: str) -> str:
    return (
        await db.execute(
            select(Payment.id).where(Payment.booking_id == booking_id, Payment.kind == "deposit")
        )
    ).scalar_one()


async def invoice(db: AsyncSession, invoice_id: str) -> InvoiceOut:
    row = await db.get(Invoice, invoice_id, populate_existing=True)
    assert row is not None
    return await invoice_out(db, row, await fetch_lines(db, BIZ, "invoice", invoice_id))


async def order(db: AsyncSession, order_id: str) -> OrderOut:
    row = await db.get(Order, order_id, populate_existing=True)
    assert row is not None
    return await _order_out(db, row, await fetch_lines(db, BIZ, "order", order_id))


async def booking(db: AsyncSession, booking_id: str) -> BookingOut:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    slot = await db.get(Slot, row.slot_id, populate_existing=True)
    assert slot is not None
    return await booking_out(db, row, slot)


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
    now = clock.now()
    await db.execute(
        update(model).where(model.id == row_id).values(expires_at=now - timedelta(minutes=1))
    )
    await db.flush()
    return now


async def review_id(db: AsyncSession, token: str) -> str:
    found = (
        await db.execute(
            text("SELECT id FROM reviews WHERE token = :t AND rating IS NOT NULL"), {"t": token}
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
