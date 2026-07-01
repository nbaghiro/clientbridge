import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.notifications import Email, EmailSender, Sms, SmsSender
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import WebhookEvent
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    MessageOut,
    MessageSend,
    ThreadOut,
)

_log = logging.getLogger(__name__)
_BROADCAST_CAP = 500


async def open_thread(db: AsyncSession, business_id: str, client_id: str, channel: str) -> Thread:
    # one thread per (client, channel) by unique constraint → reuse it, reopening if closed.
    thread = (
        await db.execute(
            scoped(Thread, business_id).where(
                Thread.client_id == client_id, Thread.channel == channel
            )
        )
    ).scalar_one_or_none()
    if thread is not None:
        thread.status = "open"
        return thread
    thread = Thread(
        id=new_id("thread"),
        business_id=business_id,
        client_id=client_id,
        channel=channel,
        status="open",
    )
    db.add(thread)
    await db.flush()
    return thread


async def dispatch_message(
    sms: SmsSender, email: EmailSender, channel: str, to: str, subject: str, body: str
) -> bool:
    """Hand the message to the channel adapter; a failure is recorded, never raised."""
    try:
        if channel == "sms":
            await sms.send(Sms(to=to, body=body))
        else:
            await email.send(Email(to=to, subject=subject, body=body))
    except Exception:
        _log.exception("message channel send failed")
        return False
    return True


async def broadcast_recipients(
    db: AsyncSession, business_id: str, channel: str, audience: dict[str, object]
) -> Sequence[tuple[Client, str]]:
    """Active clients reachable on the channel, narrowed by the broadcast's `audience` JSONB filter.
    Supported shapes: `{}` / `{"all": true}` → everyone; `{"tags": [...]}` → tag overlap."""
    contact = Client.phone if channel == "sms" else Client.email
    query = (
        scoped(Client, business_id, soft_delete=True)
        .where(Client.status == "active", contact.isnot(None), contact != "")
        .limit(_BROADCAST_CAP)
    )
    tags = audience.get("tags")
    if not audience.get("all") and isinstance(tags, list) and tags:
        query = query.where(Client.tags.overlap([str(tag) for tag in tags]))
    rows = (await db.execute(query)).scalars().all()
    out: list[tuple[Client, str]] = []
    for client in rows:
        to = client.phone if channel == "sms" else client.email
        if to:
            out.append((client, to))
    return out


async def fan_out_broadcast(
    db: AsyncSession,
    broadcast: Broadcast,
    recipients: Sequence[tuple[Client, str]],
    sms: SmsSender,
    email: EmailSender,
) -> None:
    """Send one message per recipient on the broadcast's channel, recording each in its thread."""
    for client, to in recipients:
        thread = await open_thread(db, broadcast.business_id, client.id, broadcast.channel)
        message = Message(
            id=new_id("message"),
            business_id=broadcast.business_id,
            thread_id=thread.id,
            direction="out",
            channel=broadcast.channel,
            sender_user_id=broadcast.created_by,
            body=broadcast.body,
            status="queued",
            broadcast_id=broadcast.id,
        )
        db.add(message)
        await db.flush()
        ok = await dispatch_message(
            sms, email, broadcast.channel, to, broadcast.name, broadcast.body or ""
        )
        message.status = "sent" if ok else "failed"  # best-effort per recipient
        thread.last_message_at = datetime.now(UTC)
    await db.flush()


async def process_inbound_sms(
    db: AsyncSession, *, from_phone: str, body: str, message_sid: str
) -> str | None:
    """Inbound-SMS webhook entry (surface #4): dedup by the provider message SID, resolve the
    sender by phone, append an `in` message to the open thread, and bump its unread_count.

    Number→business assumption (v1): a client's phone number identifies the business. We match a
    `Client` by `phone` across all businesses; if the same number exists in more than one, we pick
    deterministically (oldest by created_at, then id). A dedicated per-number routing table is the
    follow-up. Returns the new message id (or None when deduped / no matching client)."""
    event_id = f"twilio_{message_sid}"
    seen = (
        await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == event_id))
    ).scalar_one_or_none()
    if seen is not None:
        return None
    client = (
        await db.execute(
            select(Client)
            .where(Client.phone == from_phone, Client.deleted_at.is_(None))
            .order_by(Client.created_at, Client.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    message_id: str | None = None
    if client is not None:
        thread = await open_thread(db, client.business_id, client.id, "sms")
        message = Message(
            id=new_id("message"),
            business_id=client.business_id,
            thread_id=thread.id,
            direction="in",
            channel="sms",
            body=body,
            status="delivered",
            provider_ref=message_sid,
        )
        db.add(message)
        thread.unread_count += 1
        thread.last_message_at = datetime.now(UTC)
        await db.flush()
        message_id = message.id
    db.add(
        WebhookEvent(
            id=event_id,
            provider="twilio",
            type="sms.inbound",
            payload={"from": from_phone, "matched": client is not None},
            status="processed",
            processed_at=datetime.now(UTC),
        )
    )
    try:
        await db.commit()
    except IntegrityError:  # a concurrent redelivery won the race on the event id
        await db.rollback()
        return None
    return message_id


async def run_due_broadcasts(
    db: AsyncSession, sms: SmsSender, email: EmailSender, now: datetime
) -> int:
    """Send each scheduled broadcast whose `scheduled_at` has arrived, flipping it sending→sent, and
    return how many were sent. Idempotent — a `sent` broadcast no longer matches `status` filter."""
    broadcasts = (
        (
            await db.execute(
                select(Broadcast).where(
                    Broadcast.status == "scheduled",
                    Broadcast.scheduled_at.is_not(None),
                    Broadcast.scheduled_at <= now,
                )
            )
        )
        .scalars()
        .all()
    )
    for broadcast in broadcasts:
        broadcast.status = "sending"
        await db.flush()
        recipients = await broadcast_recipients(
            db, broadcast.business_id, broadcast.channel, broadcast.audience
        )
        await fan_out_broadcast(db, broadcast, recipients, sms, email)
        broadcast.status = "sent"
    await db.commit()
    return len(broadcasts)


class MessageService:
    """Outbound messaging (surface #3): sending through a channel is a side effect, so it runs as a
    `run_command` — atomic, audited, idempotent — never a sync write."""

    def __init__(
        self, db: AsyncSession, principal: Principal, sms: SmsSender, email: EmailSender
    ) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.sms = sms
        self.email = email

    async def send_message(
        self, data: MessageSend, idempotency_key: str | None = None
    ) -> MessageOut:
        client = await self._client(data.client_id)
        to = client.phone if data.channel == "sms" else client.email
        if not to:
            raise AppError(f"client has no {data.channel} contact", status_code=422)
        subject = await self._business_name()

        async def run(cmd: Command) -> MessageOut:
            thread = await open_thread(self.db, self.biz, client.id, data.channel)
            message = Message(
                id=new_id("message"),
                business_id=self.biz,
                thread_id=thread.id,
                direction="out",
                channel=data.channel,
                sender_user_id=self.principal.user_id,
                body=data.body,
                status="queued",
            )
            self.db.add(message)
            await self.db.flush()
            ok = await dispatch_message(self.sms, self.email, data.channel, to, subject, data.body)
            message.status = "sent" if ok else "failed"
            thread.last_message_at = datetime.now(UTC)
            await self.db.flush()
            cmd.record("message.send", entity_type="message", entity_id=message.id)
            return _message_out(message)

        return await run_command(
            self.db,
            self.principal,
            action="message.send",
            run=run,
            response_model=MessageOut,
            idempotency_key=idempotency_key,
        )

    async def send_broadcast(
        self, data: BroadcastSend, idempotency_key: str | None = None
    ) -> BroadcastOut:
        scheduled = data.scheduled_at is not None and data.scheduled_at > datetime.now(UTC)
        recipients = await broadcast_recipients(self.db, self.biz, data.channel, data.audience)

        async def run(cmd: Command) -> BroadcastOut:
            broadcast = Broadcast(
                id=new_id("broadcast"),
                business_id=self.biz,
                created_by=self.principal.user_id,
                name=data.name,
                channel=data.channel,
                body=data.body,
                audience=data.audience,
                status="scheduled" if scheduled else "sending",
                scheduled_at=data.scheduled_at if scheduled else None,
            )
            self.db.add(broadcast)
            await self.db.flush()
            if not scheduled:
                await fan_out_broadcast(self.db, broadcast, recipients, self.sms, self.email)
                broadcast.status = "sent"
            cmd.record("broadcast.send", entity_type="broadcast", entity_id=broadcast.id)
            return BroadcastOut(
                id=broadcast.id,
                name=broadcast.name,
                channel=broadcast.channel,
                status=broadcast.status,
                recipient_count=len(recipients),
            )

        return await run_command(
            self.db,
            self.principal,
            action="broadcast.send",
            run=run,
            response_model=BroadcastOut,
            idempotency_key=idempotency_key,
        )

    async def mark_thread_read(self, thread_id: str) -> ThreadOut:
        thread = await self._thread(thread_id)

        async def run(cmd: Command) -> ThreadOut:
            thread.unread_count = 0
            await self.db.flush()
            cmd.record("thread.read", entity_type="thread", entity_id=thread.id)
            return ThreadOut(id=thread.id, unread_count=thread.unread_count, status=thread.status)

        return await run_command(
            self.db, self.principal, action="thread.read", run=run, response_model=ThreadOut
        )

    async def _business_name(self) -> str:
        business = await self.db.get(Business, self.biz)
        return business.name if business is not None else ""

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _thread(self, thread_id: str) -> Thread:
        row = (
            await self.db.execute(scoped(Thread, self.biz).where(Thread.id == thread_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("thread not found")
        return row


def _message_out(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        thread_id=message.thread_id,
        direction=message.direction,
        channel=message.channel,
        body=message.body,
        status=message.status,
    )
