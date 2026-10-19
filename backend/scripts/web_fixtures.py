"""Give the web smoke test a series, a low-stock product, a dispute and a duplicate client."""

import asyncio
import hashlib
import hmac
import json
import os
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Recurrence, Slot

BIZ = "bz_birchbark"
OWNER = {"email": "hannah@birchbark.example", "password": "demo1234"}
API = os.environ.get("API_URL", "http://localhost:8701")
# a near-duplicate with no money or saved cards, so the merge flow is not blocked
DUPLICATE = "Robin Test"


async def _has_series(db: AsyncSession) -> bool:
    found = await db.execute(
        select(Recurrence.id)
        .join(Slot, Slot.recurrence_id == Recurrence.id)
        .where(
            Recurrence.business_id == BIZ,
            Recurrence.client_id.is_not(None),
            Recurrence.status == "active",
            Slot.starts_at > clock.now(),
        )
        .limit(1)
    )
    return found.first() is not None


async def _has_low_stock(db: AsyncSession) -> bool:
    found = await db.execute(
        select(Item.id)
        .where(
            Item.business_id == BIZ,
            Item.track_stock.is_(True),
            Item.active.is_(True),
            Item.stock_on_hand <= Item.low_stock_at,
        )
        .limit(1)
    )
    return found.first() is not None


async def _has_duplicate(db: AsyncSession) -> bool:
    found = await db.execute(
        select(Client.id)
        .where(Client.business_id == BIZ, Client.name == DUPLICATE, Client.deleted_at.is_(None))
        .limit(1)
    )
    return found.first() is not None


async def _has_dispute(db: AsyncSession) -> bool:
    found = await db.execute(
        select(Payment.id)
        .where(Payment.business_id == BIZ, Payment.dispute_status.is_not(None))
        .limit(1)
    )
    return found.first() is not None


async def _series_body(db: AsyncSession) -> dict[str, object]:
    pet = (
        await db.execute(
            select(Subject)
            .join(Client, Client.id == Subject.client_id)
            .where(
                Subject.business_id == BIZ,
                Client.status == "active",
                Client.deleted_at.is_(None),
            )
            .order_by(Subject.id)
            .limit(1)
        )
    ).scalar_one()
    service = (
        await db.execute(
            select(Item)
            .where(
                Item.business_id == BIZ,
                Item.kind == "service",
                Item.active.is_(True),
                Item.duration_min > 0,
            )
            .order_by(Item.duration_min, Item.id)
            .limit(1)
        )
    ).scalar_one()
    owner = (
        await db.execute(select(Staff).where(Staff.business_id == BIZ, Staff.role == "owner"))
    ).scalar_one()
    business = await db.get(Business, BIZ)
    assert business is not None
    tz = ZoneInfo(business.timezone)
    today = clock.today(tz)
    wednesday = today + timedelta(days=(2 - today.weekday()) % 7 + 7)
    starts_at = datetime.combine(wednesday, datetime.min.time(), tz).replace(hour=15)
    return {
        "client_id": pet.client_id,
        "subject_id": pet.id,
        "item_id": service.id,
        "staff_id": owner.id,
        "starts_at": starts_at.isoformat(),
        "frequency": "week",
        "interval": 2,
        "byday": ["WE"],
        "count": 6,
        "confirmation": "none",
    }


async def _dispute_event(db: AsyncSession) -> bytes:
    refunded = select(Payment.parent_payment_id).where(Payment.parent_payment_id.is_not(None))
    payment = (
        await db.execute(
            select(Payment)
            .where(
                Payment.business_id == BIZ,
                Payment.kind == "payment",
                Payment.method == "card",
                Payment.status == "succeeded",
                Payment.provider_ref.like("pi_%"),
                Payment.id.not_in(refunded),
            )
            .order_by(Payment.paid_at.desc(), Payment.id)
            .limit(1)
        )
    ).scalar_one()
    due_by = int(clock.now().timestamp()) + 7 * 86400
    event = {
        "id": f"evt_web_{payment.id}",
        "object": "event",
        "type": "charge.dispute.created",
        "data": {
            "object": {
                "id": f"dp_web_{payment.id}",
                "object": "dispute",
                "payment_intent": payment.provider_ref,
                "amount": payment.amount_cents,
                "currency": payment.currency.lower(),
                "status": "needs_response",
                "reason": "product_not_received",
                "evidence_details": {"due_by": due_by},
                "balance_transactions": [{"fee": 1500}],
            }
        },
    }
    return json.dumps(event).encode()


def _stripe_signature(payload: bytes) -> str:
    stamp = str(int(clock.wall().timestamp()))
    secret = get_settings().stripe_webhook_secret.encode()
    digest = hmac.new(secret, f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


async def sign_in(http: httpx.AsyncClient, *, email: str, password: str) -> str:
    """A native password login against the auth service, as the mobile app does it."""
    auth = get_settings().auth_public_url
    flow = await http.get(f"{auth}/self-service/login/api")
    flow.raise_for_status()
    login = await http.post(
        f"{auth}/self-service/login",
        params={"flow": flow.json()["id"]},
        json={"method": "password", "identifier": email, "password": password},
    )
    login.raise_for_status()
    return str(login.json()["session_token"])


async def main() -> None:
    async with SessionLocal() as db:
        need_series = not await _has_series(db)
        need_stock = not await _has_low_stock(db)
        need_dispute = not await _has_dispute(db)
        need_duplicate = not await _has_duplicate(db)
        series = await _series_body(db) if need_series else None
        dispute = await _dispute_event(db) if need_dispute else None
    await engine.dispose()

    added: list[str] = []
    async with httpx.AsyncClient(base_url=API, timeout=30) as http:
        http.headers["X-Session-Token"] = await sign_in(http, **OWNER)
        http.headers["X-Business-Id"] = BIZ
        stamp = clock.today(UTC).isoformat()
        if series is not None:
            booked = await http.post(
                "/v1/recurrences",
                json=series,
                headers={"Idempotency-Key": f"web-fixtures-series-{stamp}"},
            )
            booked.raise_for_status()
            added.append("a client series")
        if need_stock:
            made = await http.post(
                "/v1/items",
                json={
                    "kind": "product",
                    "name": "Ear Cleaning Wipes",
                    "price_cents": 1600,
                    "cost_cents": 700,
                    "category": "Retail",
                    "track_stock": True,
                    "low_stock_at": 5,
                },
                headers={"Idempotency-Key": f"web-fixtures-item-{stamp}"},
            )
            made.raise_for_status()
            restocked = await http.post(
                f"/v1/items/{made.json()['id']}/restock",
                json={"quantity": 2, "note": "Opening count"},
                headers={"Idempotency-Key": f"web-fixtures-restock-{stamp}"},
            )
            restocked.raise_for_status()
            added.append("a low-stock product")
        if need_duplicate:
            client = await http.post(
                "/v1/clients",
                json={"name": DUPLICATE, "email": "robin@example.com"},
                headers={"Idempotency-Key": f"web-fixtures-duplicate-{stamp}"},
            )
            client.raise_for_status()
            added.append("a duplicate client")
        if dispute is not None:
            hook = await http.post(
                "/webhooks/stripe",
                content=dispute,
                headers={
                    "Content-Type": "application/json",
                    "Stripe-Signature": _stripe_signature(dispute),
                },
            )
            hook.raise_for_status()
            added.append("a dispute")
    print(f"web fixtures: added {', '.join(added)}" if added else "web fixtures: all present")


if __name__ == "__main__":
    asyncio.run(main())
