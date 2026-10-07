import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import Webhook
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    MessageOut,
    MessageSend,
    ThreadOut,
)
from clientbridge.services.consents import (
    allows_marketing,
    latest_consents,
    prefs_url,
    record_text_reply,
    texts_stopped,
)
from clientbridge.services.notifications import broadcast_text

_log = logging.getLogger(__name__)
_BROADCAST_CAP = 500
# Carrier opt-out keywords (CTIA), plus the French ones Canadian carriers honour.
STOP_WORDS = frozenset(
    {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ARRET", "ARRÊT"}
)
START_WORDS = frozenset({"START", "UNSTOP"})


async def unread_count(db: AsyncSession, thread: Thread) -> int:
    """A thread's unread count is its inbound messages not yet marked read."""
    count = await db.execute(
        scoped(Message, thread.business_id)
        .with_only_columns(func.count())
        .where(
            Message.thread_id == thread.id,
            Message.direction == "in",
            Message.status != "read",
        )
    )
    return int(count.scalar_one())


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
) -> tuple[Sequence[tuple[Client, str]], int]:
    """The audience members who agreed to marketing on the channel, and how many were left out."""
    query = scoped(Client, business_id, soft_delete=True).where(Client.status == "active")
    tags = audience.get("tags")
    if not audience.get("all") and isinstance(tags, list) and tags:
        query = query.where(Client.tags.overlap([str(tag) for tag in tags]))
    clients = (await db.execute(query.order_by(Client.id))).scalars().all()
    consents = await latest_consents(db, business_id, [c.id for c in clients], channel)
    now = datetime.now(UTC)
    out: list[tuple[Client, str]] = []
    for client in clients:
        to = client.phone if channel == "sms" else client.email
        if to and allows_marketing(consents.get(client.id), now):
            out.append((client, to))
    return out[:_BROADCAST_CAP], len(clients) - len(out[:_BROADCAST_CAP])


async def fan_out_broadcast(
    db: AsyncSession,
    broadcast: Broadcast,
    recipients: Sequence[tuple[Client, str]],
    sms: SmsSender,
    email: EmailSender,
) -> None:
    """Send one message per recipient on the broadcast's channel, recording each in its thread."""
    business = await db.get(Business, broadcast.business_id)
    business_name = business.name if business is not None else ""
    for client, to in recipients:
        thread = await open_thread(db, broadcast.business_id, client.id, broadcast.channel)
        message = Message(
            id=new_id("message"),
            business_id=broadcast.business_id,
            thread_id=thread.id,
            direction="out",
            channel=broadcast.channel,
            sent_by=broadcast.created_by,
            body=broadcast.body,
            status="queued",
            broadcast_id=broadcast.id,
        )
        db.add(message)
        await db.flush()
        text = broadcast_text(
            business_name, broadcast.channel, broadcast.body or "", prefs_url(client.id)
        )
        ok = await dispatch_message(sms, email, broadcast.channel, to, broadcast.name, text)
        message.status = "sent" if ok else "failed"  # best-effort per recipient
    await db.flush()


async def process_inbound_sms(
    db: AsyncSession, *, from_phone: str, body: str, message_sid: str
) -> str | None:
    """Record an inbound SMS on the sender's thread; the phone number identifies the business."""
    event_id = f"twilio_{message_sid}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
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
        keyword = body.strip().upper()
        if keyword in STOP_WORDS or keyword in START_WORDS:
            await record_text_reply(db, client, stop=keyword in STOP_WORDS)
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
        await db.flush()
        message_id = message.id
    db.add(
        Webhook(
            id=event_id,
            provider="twilio",
            event="sms.inbound",
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
    """Send every scheduled broadcast that is due; returns how many were sent."""
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
        recipients, excluded = await broadcast_recipients(
            db, broadcast.business_id, broadcast.channel, broadcast.audience
        )
        await fan_out_broadcast(db, broadcast, recipients, sms, email)
        broadcast.recipient_count = len(recipients)
        broadcast.excluded_count = excluded
        broadcast.status = "sent"
    await db.commit()
    return len(broadcasts)


class MessageService:
    """Outbound messages, sent as audited commands."""

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
        if data.channel == "sms" and await texts_stopped(self.db, self.biz, client.id):
            raise Conflict("this client replied STOP, so texts to them are blocked")
        subject = await self._business_name()

        async def run(cmd: Command) -> MessageOut:
            thread = await open_thread(self.db, self.biz, client.id, data.channel)
            message = Message(
                id=new_id("message"),
                business_id=self.biz,
                thread_id=thread.id,
                direction="out",
                channel=data.channel,
                sent_by=self.principal.user_id,
                body=data.body,
                status="queued",
            )
            self.db.add(message)
            await self.db.flush()
            ok = await dispatch_message(self.sms, self.email, data.channel, to, subject, data.body)
            message.status = "sent" if ok else "failed"
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
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can send broadcasts"
        )
        scheduled = data.scheduled_at is not None and data.scheduled_at > datetime.now(UTC)
        recipients, excluded = await broadcast_recipients(
            self.db, self.biz, data.channel, data.audience
        )

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
                recipient_count=len(recipients),
                excluded_count=excluded,
            )
            self.db.add(broadcast)
            await self.db.flush()
            if not scheduled:
                await fan_out_broadcast(self.db, broadcast, recipients, self.sms, self.email)
                broadcast.status = "sent"
            cmd.record("broadcast.send", entity_type="broadcast", entity_id=broadcast.id)
            return _broadcast_out(broadcast)

        return await run_command(
            self.db,
            self.principal,
            action="broadcast.send",
            run=run,
            response_model=BroadcastOut,
            idempotency_key=idempotency_key,
        )

    async def cancel_broadcast(self, broadcast_id: str) -> BroadcastOut:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can cancel broadcasts"
        )
        broadcast = (
            await self.db.execute(
                scoped(Broadcast, self.biz).where(Broadcast.id == broadcast_id).with_for_update()
            )
        ).scalar_one_or_none()
        if broadcast is None:
            raise NotFound("broadcast not found")
        if broadcast.status != "scheduled":
            raise Conflict("only a scheduled broadcast can be canceled")

        async def run(cmd: Command) -> BroadcastOut:
            broadcast.status = "canceled"
            await self.db.flush()
            cmd.record("broadcast.cancel", entity_type="broadcast", entity_id=broadcast.id)
            return _broadcast_out(broadcast)

        return await run_command(
            self.db, self.principal, action="broadcast.cancel", run=run, response_model=BroadcastOut
        )

    async def mark_thread_read(self, thread_id: str) -> ThreadOut:
        thread = await self._thread(thread_id)

        async def run(cmd: Command) -> ThreadOut:
            await self.db.execute(
                update(Message)
                .where(
                    Message.thread_id == thread.id,
                    Message.direction == "in",
                    Message.status != "read",
                )
                .values(status="read")
            )
            cmd.record("thread.read", entity_type="thread", entity_id=thread.id)
            return ThreadOut(
                id=thread.id, unread_count=await unread_count(self.db, thread), status=thread.status
            )

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


def _broadcast_out(broadcast: Broadcast) -> BroadcastOut:
    return BroadcastOut(
        id=broadcast.id,
        name=broadcast.name,
        channel=broadcast.channel,
        status=broadcast.status,
        recipient_count=broadcast.recipient_count,
        excluded_count=broadcast.excluded_count,
    )
