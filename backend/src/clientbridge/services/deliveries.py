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
from clientbridge.core.emails import reserved_email
from clientbridge.core.errors import AppError, Undelivered, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.phones import e164, reserved_phone, same_phone
from clientbridge.core.scoping import scoped
from clientbridge.integrations.expo import Push, PushSender
from clientbridge.integrations.resend import Email, EmailSender, get_test_email_sender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Delivery, DeliveryState
from clientbridge.schemas.deliveries import (
    DELIVERY_PAYLOAD,
    DeliveryPayload,
    EmailDelivery,
    PushDelivery,
    SmsDelivery,
)
from clientbridge.services.consents import emails_withdrawn, stopped_clients

_LEASE = timedelta(minutes=5)
_RETRY = timedelta(minutes=1)
_RETRY_WINDOW = timedelta(hours=23)
_QUEUED = "queued_deliveries"


def delivery_key(kind: str, subject_id: str, *, each: bool = False) -> str:
    """A notice's delivery key: one send per subject, or with `each` a new send every call."""
    key = f"{kind}:{subject_id}"
    return f"{key}:{new_id('delivery')}" if each else key


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
    if identity is None:
        existing = (await db.scalars(select(Delivery).where(Delivery.key == key))).one()
        if existing.business_id != business_id or existing.payload != body:
            raise Unprocessable(
                "delivery key was reused for different content", code="idempotency_key_reused"
            )
        identity = existing.id
    db.info.setdefault(_QUEUED, {})[identity] = key
    return identity


async def send_queued(
    db: AsyncSession,
    email: EmailSender,
    sms: SmsSender,
    push: PushSender,
    *,
    transport_override: bool = False,
    leave: tuple[str, ...] = (),
) -> int:
    """Send what this session queued since the last call; `leave` kinds wait for the worker."""
    queued: dict[str, str] = db.info.pop(_QUEUED, {})
    sent = 0
    for identity, key in queued.items():
        if key.split(":", 1)[0] in leave:
            continue
        sent += await dispatch(
            db, identity, email, sms, push, transport_override=transport_override
        )
    return sent


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
    if _reserved(payload):
        row.state, row.error, row.next_at = "failed", "reserved_address", None
        await db.commit()
        return False
    if row.business_id is not None and (
        await _texts_stopped(db, row.business_id, payload)
        or await _emails_withdrawn(db, row.business_id, payload)
    ):
        row.state, row.error, row.next_at = "failed", "consent_withdrawn", None
        await db.commit()
        return False
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
    except Undelivered as exc:
        state, error = "queued" if exc.retry else "failed", exc.code
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


async def _texts_stopped(db: AsyncSession, business_id: str, payload: DeliveryPayload) -> bool:
    """A STOP from the number, received after the text was queued, still keeps it from going."""
    if not isinstance(payload, SmsDelivery):
        return False
    number = e164(payload.message.to)
    if number is None:
        return False
    holders = list(
        await db.scalars(
            scoped(Client, business_id, soft_delete=True)
            .with_only_columns(Client.id)
            .where(same_phone(Client.phone, number))
        )
    )
    return bool(holders) and bool(await stopped_clients(db, business_id, holders))


async def _emails_withdrawn(db: AsyncSession, business_id: str, payload: DeliveryPayload) -> bool:
    """An email the client can opt out of stays unsent once they have, even after it queued."""
    if not isinstance(payload, EmailDelivery) or not payload.opt_out or payload.client_id is None:
        return False
    return await emails_withdrawn(db, business_id, payload.client_id)


def _reserved(payload: DeliveryPayload) -> bool:
    if isinstance(payload, EmailDelivery):
        return reserved_email(payload.message.to)
    if isinstance(payload, SmsDelivery):
        return reserved_phone(payload.message.to)
    return False


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
    def __init__(self, db: AsyncSession, key: str, business_id: str | None = None) -> None:
        self.db, self.key, self.business_id = db, key, business_id

    async def add(self, payload: DeliveryPayload, business_id: str | None = None) -> str:
        body = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return await enqueue(
            self.db,
            payload,
            key=f"{self.key}:{hashlib.sha256(body.encode()).hexdigest()}",
            business_id=business_id or self.business_id,
        )


class QueuedEmail:
    def __init__(self, queue: DeliveryQueue) -> None:
        self.queue = queue

    async def send(
        self, email: Email, *, client_id: str | None = None, opt_out: bool = False
    ) -> str:
        delivery = EmailDelivery(message=email, client_id=client_id, opt_out=opt_out)
        return await self.queue.add(delivery, email.tags.get("business"))


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
