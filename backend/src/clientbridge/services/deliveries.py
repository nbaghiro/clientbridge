import hashlib
import json
import secrets
from dataclasses import replace
from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import AppError, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.integrations.expo import Push, PushSender
from clientbridge.integrations.resend import Email, EmailSender, get_test_email_sender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.messaging import Delivery, DeliveryState
from clientbridge.schemas.deliveries import (
    DELIVERY_PAYLOAD,
    DeliveryPayload,
    EmailDelivery,
    PushDelivery,
    SmsDelivery,
)

_LEASE = timedelta(minutes=5)
_RETRY = timedelta(minutes=1)
_RETRY_WINDOW = timedelta(hours=23)


async def enqueue(
    db: AsyncSession, payload: DeliveryPayload, *, key: str, business_id: str | None
) -> str:
    body = payload.model_dump(mode="json")
    identity = await db.scalar(
        insert(Delivery)
        .values(
            id=new_id("delivery"),
            business_id=business_id,
            key=key,
            payload=body,
            state="queued",
            next_at=clock.now(),
            created_at=clock.now(),
        )
        .on_conflict_do_nothing(index_elements=["key"])
        .returning(Delivery.id)
    )
    if identity is not None:
        return identity
    existing = (await db.scalars(select(Delivery).where(Delivery.key == key))).one()
    if existing.business_id != business_id or existing.payload != body:
        raise Unprocessable(
            "delivery key was reused for different content", code="idempotency_key_reused"
        )
    return existing.id


async def dispatch(
    db: AsyncSession,
    delivery_id: str,
    email: EmailSender,
    sms: SmsSender,
    push: PushSender,
    *,
    transport_override: bool = False,
) -> bool:
    row = await db.scalar(
        select(Delivery)
        .where(Delivery.id == delivery_id)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    now = clock.now()
    if (
        row is None
        or row.state not in ("queued", "sending")
        or row.next_at is None
        or row.next_at > now
    ):
        await db.commit()
        return False
    if row.state == "sending":
        row.state, row.error, row.next_at, row.claim = "ambiguous", "lease_expired", None, None
        await db.commit()
        return False
    if now - row.created_at >= _RETRY_WINDOW:
        row.state, row.error, row.next_at = "failed", "retry_window_expired", None
        await db.commit()
        return False
    payload = DELIVERY_PAYLOAD.validate_python(row.payload)
    claim = secrets.token_urlsafe(24)
    row.state, row.claim, row.next_at = "sending", claim, now + _LEASE
    key = row.id
    await db.commit()
    state: DeliveryState = "accepted"
    error: str | None = None
    reference: str | None = None
    try:
        match payload:
            case EmailDelivery(message=message):
                sender = (
                    get_test_email_sender(payload.transport)
                    if payload.transport and not transport_override
                    else email
                )
                reference = await sender.send(
                    replace(
                        message, idempotency_key=key, tags=dict(message.tags) | {"delivery": key}
                    )
                )
            case SmsDelivery(message=message):
                if message.from_number is None:
                    raise AppError(
                        "business has no assigned SMS number",
                        code="sms_unassigned",
                        status_code=503,
                    )
                reference = await sms.send(message)
            case PushDelivery(message=message):
                await push.send(message)
    except AppError as exc:
        state, error = "failed", exc.code
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
        state, error = "queued", "connection_unavailable"
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        state = "queued" if status == 429 else "failed" if 400 <= status < 500 else "ambiguous"
        error = f"provider_http_{status}"
    except Exception:
        state, error = "ambiguous", "delivery_unconfirmed"
    row = await db.scalar(
        select(Delivery)
        .where(Delivery.id == delivery_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None or row.claim != claim or row.state != "sending":
        await db.commit()
        return False
    row.state, row.error, row.provider_ref = state, error, reference
    row.next_at = clock.now() + _RETRY if state == "queued" else None
    row.claim = None
    await db.commit()
    return state == "accepted"


async def run_deliveries(
    db: AsyncSession, email: EmailSender, sms: SmsSender, push: PushSender
) -> int:
    ids = list(
        await db.scalars(
            select(Delivery.id)
            .where(Delivery.state.in_(("queued", "sending")), Delivery.next_at <= clock.now())
            .order_by(Delivery.next_at, Delivery.id)
            .limit(100)
        )
    )
    await db.commit()
    sent = 0
    for identity in ids:
        sent += await dispatch(db, identity, email, sms, push)
    return sent


class DeliveryQueue:
    def __init__(self, db: AsyncSession, scope: str, business_id: str | None = None) -> None:
        self.db, self.scope, self.business_id = db, scope, business_id
        self.ids: list[str] = []

    async def add(self, payload: DeliveryPayload, business_id: str | None = None) -> str:
        body = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        key = f"{self.scope}:{hashlib.sha256(body.encode()).hexdigest()}"
        identity = await enqueue(
            self.db, payload, key=key, business_id=business_id or self.business_id
        )
        self.ids.append(identity)
        return identity


class QueuedEmail:
    def __init__(self, queue: DeliveryQueue) -> None:
        self.queue = queue

    async def send(self, email: Email) -> str:
        return await self.queue.add(EmailDelivery(message=email), email.tags.get("business"))


class QueuedSms:
    def __init__(self, queue: DeliveryQueue) -> None:
        self.queue = queue

    async def send(self, sms: Sms) -> str:
        return await self.queue.add(SmsDelivery(message=sms))


class QueuedPush:
    def __init__(self, queue: DeliveryQueue) -> None:
        self.queue = queue

    async def send(self, push: Push) -> None:
        await self.queue.add(PushDelivery(message=push))


async def dispatch_scope(
    db: AsyncSession, scope: str, email: EmailSender, sms: SmsSender, push: PushSender
) -> None:
    ids = list(
        await db.scalars(
            select(Delivery.id).where(Delivery.key.startswith(f"{scope}:", autoescape=True))
        )
    )
    await db.commit()
    for identity in ids:
        await dispatch(db, identity, email, sms, push)
