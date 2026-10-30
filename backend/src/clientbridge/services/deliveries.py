import hashlib
import json
import logging
import secrets
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import is_duplicate
from clientbridge.core.emails import reserved_email
from clientbridge.core.errors import AppError, Undelivered, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.phones import e164, reserved_phone
from clientbridge.core.scoping import scoped_update
from clientbridge.integrations.expo import Push, PushSender
from clientbridge.integrations.jobs import Jobs
from clientbridge.integrations.resend import (
    ConsoleEmailSender,
    Email,
    EmailSender,
    SmtpEmailSender,
    get_test_email_sender,
)
from clientbridge.integrations.twilio import ConsoleSmsSender, Sms, SmsSender, SmtpSmsSender
from clientbridge.models.messaging import Delivery, DeliveryState, Message, MessageStatus
from clientbridge.models.platform import Webhook, WebhookStatus
from clientbridge.schemas.deliveries import (
    DELIVERY_PAYLOAD,
    DeliveryPayload,
    EmailDelivery,
    EmailEventBody,
    EmailEventData,
    PushDelivery,
    SmsDelivery,
)
from clientbridge.services.consents import number_stopped

_log = logging.getLogger(__name__)
_LEASE = timedelta(minutes=5)
_RETRY = timedelta(minutes=1)
_RETRY_WINDOW = timedelta(hours=23)
_EMAIL_FAILURES = frozenset(
    {"email.bounced", "email.failed", "email.suppressed", "email.complained"}
)
_EVENT_GRACE = timedelta(minutes=10)
_QUEUED = "queued_deliveries"
# the worker function a request wakes for the deliveries it leaves
DELIVERIES_JOB = "send_deliveries"


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
    jobs: Jobs | None = None,
    *,
    inline: int = 1,
    transport_override: bool = False,
    leave: tuple[str, ...] = (),
) -> int:
    """Send what this session queued; with `jobs`, `inline` now and the worker for the rest."""
    queued: dict[str, str] = db.info.pop(_QUEUED, {})
    due = [identity for identity, key in queued.items() if key.split(":", 1)[0] not in leave]
    now = due if jobs is None else due[:inline]
    sent = 0
    for identity in now:
        sent += await dispatch(
            db, identity, email, sms, push, transport_override=transport_override
        )
    # waking the worker would send what `leave` holds back, so it then waits for the sweep
    if jobs is not None and len(now) < len(due) == len(queued):
        await jobs.enqueue(DELIVERIES_JOB)
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
    payload = DELIVERY_PAYLOAD.validate_python(row.payload)
    if row.state == "sending":
        row.state, row.error, row.next_at, row.claim = "ambiguous", "lease_expired", None, None
        await _follow(db, row, payload)
        await db.commit()
        return False
    if now - row.created_at >= _RETRY_WINDOW:
        row.state, row.error, row.next_at = "failed", "retry_window_expired", None
        await _follow(db, row, payload)
        await db.commit()
        return False
    reserved = _reserved(payload)
    if reserved and get_settings().env == "prod":
        row.state, row.error, row.next_at = "failed", "reserved_address", None
        await _follow(db, row, payload)
        await db.commit()
        return False
    if row.business_id is not None and await _texts_stopped(db, row.business_id, payload):
        row.state, row.error, row.next_at = "failed", "consent_withdrawn", None
        await _follow(db, row, payload)
        await db.commit()
        return False
    if reserved and not _local_sink(payload, email, sms, transport_override):
        # outside production a reserved recipient, such as a demo client, is sent in simulation
        row.state, row.error, row.next_at = "accepted", None, None
        await _follow(db, row, payload)
        await db.commit()
        return True
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
    await _follow(db, row, payload)
    await db.commit()
    return state == "accepted"


# an unconfirmed send shows as failed, as it did before messages went through deliveries
_MESSAGE_STATUS: dict[DeliveryState, MessageStatus] = {
    "accepted": "sent",
    "failed": "failed",
    "ambiguous": "failed",
}


async def _follow(db: AsyncSession, row: Delivery, payload: DeliveryPayload) -> None:
    """The inbox message a delivery carries takes its outcome, never undoing a later one."""
    status = _MESSAGE_STATUS.get(row.state)
    if (
        not isinstance(payload, SmsDelivery)
        or payload.message_id is None
        or row.business_id is None
    ):
        return
    if status is None:  # still queued for a retry
        return
    earlier: tuple[MessageStatus, ...] = ("queued",) if status == "sent" else ("queued", "sent")
    await db.execute(
        scoped_update(Message, row.business_id)
        .where(Message.id == payload.message_id, Message.status.in_(earlier))
        .values(status=status, provider_ref=func.coalesce(Message.provider_ref, row.provider_ref))
    )


async def _texts_stopped(db: AsyncSession, business_id: str, payload: DeliveryPayload) -> bool:
    """A STOP from the number, received after the text was queued, still keeps it from going."""
    if not isinstance(payload, SmsDelivery):
        return False
    number = e164(payload.message.to)
    return number is not None and await number_stopped(db, business_id, number)


def _local_sink(
    payload: DeliveryPayload, email: EmailSender, sms: SmsSender, transport_override: bool
) -> bool:
    """Whether the payload goes to a local transport that reaches no one: Mailpit or the console."""
    if isinstance(payload, EmailDelivery):
        if payload.transport and not transport_override:
            return payload.transport == "smtp" and bool(get_settings().smtp_url)
        return isinstance(email, SmtpEmailSender | ConsoleEmailSender)
    return isinstance(payload, SmsDelivery) and isinstance(sms, ConsoleSmsSender | SmtpSmsSender)


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


class EmailEventPending(Exception):
    """Resend reported on a send whose transaction has not committed yet; Svix must retry."""


def _is_recent(created_at: datetime | None) -> bool:
    if created_at is None:
        return False
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return clock.wall() - created_at < _EVENT_GRACE


async def _record_event(
    db: AsyncSession,
    event_id: str,
    *,
    event: str,
    payload: dict[str, object],
    status: WebhookStatus,
) -> bool:
    """Commit the event row with whatever it changed; False when a twin delivery got there first."""
    db.add(
        Webhook(
            id=event_id,
            provider="resend",
            event=event,
            payload=payload,
            status=status,
            processed_at=clock.now(),
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if not is_duplicate(exc):  # only a redelivery race may be dropped; anything else must retry
            raise
        return False
    return True


async def process_email_event(db: AsyncSession, *, svix_id: str, payload: bytes) -> bool:
    """Record a Resend event on the delivery it reports; True when it changed the delivery."""
    event_id = f"resend_{svix_id}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return False
    try:
        event = EmailEventBody.model_validate_json(payload)
    except ValidationError as exc:
        _log.warning("unparseable resend event %s: %s", svix_id, exc)
        failure: dict[str, object] = {"error": str(exc)[:500]}
        await _record_event(db, event_id, event="unparsed", payload=failure, status="failed")
        return False
    data = event.data or EmailEventData()
    recipients = [data.to] if isinstance(data.to, str) else list(data.to or [])
    tags = data.tags or {}
    email_id = data.email_id or ""
    delivery = None
    if tags.get("delivery"):
        delivery = await db.scalar(
            select(Delivery)
            .where(Delivery.id == tags["delivery"])
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if delivery is None and _is_recent(event.created_at):
            raise EmailEventPending(tags["delivery"])
    elif email_id:
        delivery = await db.scalar(
            select(Delivery)
            .where(Delivery.provider_ref == email_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    changed = False
    if (
        delivery is not None
        and delivery.payload.get("channel") == "email"
        and delivery.provider_ref in (None, email_id)
    ):
        if event.type == "email.delivered" and delivery.state != "failed":
            delivery.state, delivery.error = "delivered", None
            changed = True
        elif event.type in _EMAIL_FAILURES:
            delivery.state, delivery.error = "failed", event.type
            changed = True
        elif event.type == "email.sent" and delivery.state in ("queued", "sending", "ambiguous"):
            delivery.state, delivery.error = "accepted", None
            changed = True
        if changed:
            delivery.provider_ref = email_id or delivery.provider_ref
            delivery.next_at, delivery.claim = None, None
    detail = ""
    if data.bounce is not None:
        detail = data.bounce.sub_type
    elif data.failed is not None:
        detail = data.failed.reason
    summary: dict[str, object] = {
        "email_id": email_id or None,
        "to": recipients[0] if recipients else None,
        "detail": detail,
        "matched": delivery is not None,
        "business_id": tags.get("business"),
    }
    if not await _record_event(db, event_id, event=event.type, payload=summary, status="processed"):
        return False
    return changed
