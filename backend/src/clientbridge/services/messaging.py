import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import and_, func, literal, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.db import is_duplicate
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for
from clientbridge.core.phones import e164, same_phone
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import zone
from clientbridge.integrations.resend import Email, EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business, Staff
from clientbridge.models.clients import Channel, Client
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import Webhook
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    ConversationMessage,
    ConversationPage,
    EmailEventBody,
    EmailEventData,
    MessageOut,
    MessageSend,
    ThreadOut,
)
from clientbridge.services.business import after_quiet_hours, quiet_hours, reply_address
from clientbridge.services.consents import (
    allows_marketing,
    latest_consents,
    prefs_url,
    record_complaint,
    record_text_reply,
    stopped_clients,
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


def contact_for(client: Client, channel: str) -> str | None:
    """Where a message on the channel goes: the E.164 number for a text, else the email."""
    if channel == "sms":
        return e164(client.phone) if client.phone else None
    return client.email


async def dispatch_message(
    sms: SmsSender,
    email: EmailSender,
    channel: str,
    to: str,
    subject: str,
    body: str,
    *,
    message: Message,
    reply_to: str | None,
) -> None:
    """Hand the message to its channel adapter and record the outcome on the row, never raising."""
    try:
        if channel == "sms":
            await sms.send(Sms(to=to, body=body))
        else:
            message.provider_ref = await email.send(
                Email(
                    to=to,
                    subject=subject,
                    body=body,
                    reply_to=reply_to,
                    idempotency_key=message.id,
                    tags={"business": message.business_id, "message": message.id},
                )
            )
    except Exception:
        _log.exception("message channel send failed")
        message.status = "failed"
        return
    message.status = "sent"


async def broadcast_recipients(
    db: AsyncSession, business_id: str, channel: Channel, audience: dict[str, object]
) -> tuple[Sequence[tuple[Client, str]], int]:
    """The audience members who agreed to marketing on the channel, and how many were left out."""
    query = scoped(Client, business_id, soft_delete=True).where(Client.status == "active")
    tags = audience.get("tags")
    if not audience.get("all") and isinstance(tags, list) and tags:
        query = query.where(Client.tags.overlap([str(tag) for tag in tags]))
    clients = (await db.execute(query.order_by(Client.id))).scalars().all()
    ids = [c.id for c in clients]
    consents = await latest_consents(db, business_id, ids, channel)
    stopped = await stopped_clients(db, business_id, ids) if channel == "sms" else set()
    now = datetime.now(UTC)
    out: list[tuple[Client, str]] = []
    for client in clients:
        to = contact_for(client, channel)
        if to and client.id not in stopped and allows_marketing(consents.get(client.id), now):
            out.append((client, to))
    return out[:_BROADCAST_CAP], len(clients) - len(out[:_BROADCAST_CAP])


def broadcast_identity(business: Business) -> tuple[str, str]:
    """The mailing address and a way to reach the business that every broadcast carries (CASL)."""
    brand = business.brand or {}

    def text(key: str) -> str:
        value = brand.get(key)
        return value.strip() if isinstance(value, str) else ""

    address = text("address")
    if not address:
        raise Unprocessable(
            "add the business mailing address before sending a broadcast",
            code="broadcast_address_missing",
        )
    contact = text("email") or text("phone") or text("website") or (business.billing_email or "")
    if not contact:
        raise Unprocessable(
            "add a business email, phone or website before sending a broadcast",
            code="broadcast_contact_missing",
        )
    return address, contact


async def _claim_broadcast(db: AsyncSession, broadcast_id: str) -> Broadcast | None:
    """Lock a broadcast that still has work, skipping one another worker holds."""
    return (
        await db.execute(
            select(Broadcast)
            .where(Broadcast.id == broadcast_id, Broadcast.status.in_(("scheduled", "sending")))
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()


async def _queue_recipient(
    db: AsyncSession, broadcast: Broadcast, client_id: str
) -> Message | None:
    """Record the recipient's message before sending, so a retry never messages them twice."""
    already = (
        await db.execute(
            scoped(Message, broadcast.business_id)
            .with_only_columns(Message.id)
            .join(Thread, Thread.id == Message.thread_id)
            .where(Message.broadcast_id == broadcast.id, Thread.client_id == client_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if already is not None:
        return None
    thread = await open_thread(db, broadcast.business_id, client_id, broadcast.channel)
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
    return message


async def _send_broadcast(
    db: AsyncSession, broadcast_id: str, sms: SmsSender, email: EmailSender, now: datetime
) -> bool:
    """Send a due broadcast one committed recipient at a time; True once every recipient is done."""
    broadcast = await _claim_broadcast(db, broadcast_id)
    business = await db.get(Business, broadcast.business_id) if broadcast is not None else None
    if broadcast is None or business is None or quiet_hours(now, zone(business.timezone)):
        await db.commit()
        return False
    try:
        address, contact = broadcast_identity(business)
    except Unprocessable:
        _log.warning("broadcast %s waits for the business identity", broadcast.id)
        await db.commit()
        return False
    recipients, excluded = await broadcast_recipients(
        db, broadcast.business_id, broadcast.channel, broadcast.audience
    )
    broadcast.status = "sending"
    broadcast.recipient_count = len(recipients)
    broadcast.excluded_count = excluded
    name, channel, subject, body = business.name, broadcast.channel, broadcast.name, broadcast.body
    reply_to = reply_address(business)
    targets = [
        (client.id, to, locale_for(business=business, client=client)) for client, to in recipients
    ]
    await db.commit()
    for client_id, to, locale in targets:
        claimed = await _claim_broadcast(db, broadcast_id)
        if claimed is None:
            await db.commit()
            return False
        message = await _queue_recipient(db, claimed, client_id)
        await db.commit()
        if message is None:
            continue
        link = f"{prefs_url(client_id)}?unsubscribe=email"
        text = broadcast_text(locale, name, channel, body or "", link, address, contact)
        await dispatch_message(
            sms, email, channel, to, subject, text, message=message, reply_to=reply_to
        )
        await db.commit()
    claimed = await _claim_broadcast(db, broadcast_id)
    if claimed is None:
        await db.commit()
        return False
    claimed.status = "sent"
    await db.commit()
    return True


async def _last_text_at(db: AsyncSession, business_id: str, client_id: str) -> datetime | None:
    sent = await db.execute(
        scoped(Message, business_id)
        .with_only_columns(func.max(Message.created_at))
        .join(Thread, Thread.id == Message.thread_id)
        .where(
            Thread.client_id == client_id,
            Message.direction == "out",
            Message.channel == "sms",
        )
    )
    return sent.scalar_one()


async def route_inbound_sms(db: AsyncSession, number: str) -> Client | None:
    """The client whose business most recently texted this number; None when no one did or a tie."""
    candidates = (
        await db.execute(
            select(Client.business_id, Client.id).where(
                same_phone(Client.phone, number), Client.deleted_at.is_(None)
            )
        )
    ).all()
    latest: list[tuple[datetime, str, str]] = []
    for business_id, client_id in candidates:
        at = await _last_text_at(db, business_id, client_id)
        if at is not None:
            latest.append((at, business_id, client_id))
    latest.sort(reverse=True)
    if not latest or (len(latest) > 1 and latest[0][0] == latest[1][0]):
        return None
    _, business_id, client_id = latest[0]
    return (
        await db.execute(scoped(Client, business_id).where(Client.id == client_id))
    ).scalar_one()


async def process_inbound_sms(
    db: AsyncSession, *, from_phone: str, body: str, message_sid: str
) -> str | None:
    """Record an inbound SMS on the thread of the business that last texted the sender."""
    event_id = f"twilio_{message_sid}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return None
    number = e164(from_phone)
    client = await route_inbound_sms(db, number) if number is not None else None
    keyword = body.strip().upper()
    message_id: str | None = None
    if client is not None:
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
            payload={
                "from": number or from_phone,
                "matched": client is not None,
                "business_id": client.business_id if client is not None else None,
                "opt_out": keyword in STOP_WORDS,
            },
            status="processed",
            processed_at=datetime.now(UTC),
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if not is_duplicate(exc):  # only a redelivery race may be dropped; anything else must retry
            raise
        return None
    return message_id


async def run_due_broadcasts(
    db: AsyncSession, sms: SmsSender, email: EmailSender, now: datetime
) -> int:
    """Send or resume each due broadcast outside quiet hours; returns how many finished."""
    due = (
        (
            await db.execute(
                select(Broadcast.id)
                .where(
                    or_(
                        Broadcast.status == "sending",
                        and_(
                            Broadcast.status == "scheduled",
                            Broadcast.scheduled_at.is_not(None),
                            Broadcast.scheduled_at <= now,
                        ),
                    )
                )
                .order_by(func.coalesce(Broadcast.scheduled_at, Broadcast.created_at))
            )
        )
        .scalars()
        .all()
    )
    await db.commit()
    finished = 0
    for broadcast_id in due:
        finished += await _send_broadcast(db, broadcast_id, sms, email, now)
    return finished


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
        to = contact_for(client, data.channel)
        if not to:
            raise AppError(f"client has no {data.channel} contact", status_code=422)
        if data.channel == "sms" and await texts_stopped(self.db, self.biz, client.id):
            raise Conflict("this client replied STOP, so texts to them are blocked")
        business = await self.db.get(Business, self.biz)
        subject = business.name if business is not None else ""
        reply_to = reply_address(business) if business is not None else None

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
            await dispatch_message(
                self.sms,
                self.email,
                data.channel,
                to,
                subject,
                data.body,
                message=message,
                reply_to=reply_to,
            )
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
            request=data,
        )

    async def send_broadcast(
        self, data: BroadcastSend, idempotency_key: str | None = None
    ) -> BroadcastOut:
        """Queue the broadcast for the job: now, at its time, or after quiet hours."""
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can send broadcasts"
        )
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        broadcast_identity(business)
        now = datetime.now(UTC)
        requested = data.scheduled_at if data.scheduled_at and data.scheduled_at > now else now
        send_at = after_quiet_hours(requested, zone(business.timezone))
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
                status="scheduled" if send_at > now else "sending",
                scheduled_at=send_at if send_at > now else None,
                recipient_count=len(recipients),
                excluded_count=excluded,
            )
            self.db.add(broadcast)
            await self.db.flush()
            cmd.record("broadcast.send", entity_type="broadcast", entity_id=broadcast.id)
            return _broadcast_out(broadcast)

        return await run_command(
            self.db,
            self.principal,
            action="broadcast.send",
            run=run,
            response_model=BroadcastOut,
            idempotency_key=idempotency_key,
            request=data,
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

    async def conversation(
        self, thread_id: str, before: datetime, before_id: str | None, limit: int
    ) -> ConversationPage:
        """A thread's older messages, newest first: the history the device no longer keeps."""
        thread = await self._thread(thread_id)
        author = scoped(Staff, self.biz).subquery()
        rows = (
            await self.db.execute(
                scoped(Message, self.biz)
                .add_columns(author.c.name)
                .outerjoin(author, author.c.user_id == Message.sent_by)
                .where(
                    Message.thread_id == thread.id,
                    Message.created_at < before
                    if before_id is None
                    else tuple_(Message.created_at, Message.id)
                    < tuple_(literal(before), literal(before_id)),
                )
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(limit + 1)
            )
        ).all()
        return ConversationPage(
            messages=[
                ConversationMessage(
                    id=message.id,
                    direction=message.direction,
                    channel=message.channel,
                    body=message.body,
                    status=message.status,
                    created_at=message.created_at,
                    author=name,
                )
                for message, name in rows[:limit]
            ],
            more=len(rows) > limit,
        )

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
        scheduled_at=broadcast.scheduled_at,
    )


_EMAIL_FAILURES = frozenset({"email.bounced", "email.failed", "email.suppressed"})


async def _email_message(db: AsyncSession, email_id: str) -> Message | None:
    # the provider id is unique across tenants; the row it finds names the business
    query = select(Message).where(Message.provider_ref == email_id, Message.channel == "email")
    return (await db.execute(query)).scalars().first()


async def _complaining_client(
    db: AsyncSession, message: Message | None, *, business_id: str | None, address: str | None
) -> Client | None:
    """The client who flagged the mail: through its thread, else by business tag and address."""
    if message is not None:
        thread = await db.get(Thread, message.thread_id)
        if thread is None:
            return None
        query = scoped(Client, message.business_id, soft_delete=True).where(
            Client.id == thread.client_id
        )
        return (await db.execute(query)).scalar_one_or_none()
    if not business_id or not address:
        return None
    query = scoped(Client, business_id, soft_delete=True).where(Client.email == address)
    return (await db.execute(query)).scalars().first()


async def process_email_event(db: AsyncSession, *, svix_id: str, event: EmailEventBody) -> bool:
    """Record a Resend delivery event on its message; True when it changed something."""
    event_id = f"resend_{svix_id}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return False
    data = event.data or EmailEventData()
    recipients = [data.to] if isinstance(data.to, str) else list(data.to or [])
    tags = data.tags or {}
    address = recipients[0] if recipients else None
    message = await _email_message(db, data.email_id) if data.email_id else None
    client: Client | None = None
    changed = False
    if message is not None and event.type == "email.delivered":
        if message.status in ("queued", "sent"):
            message.status = "delivered"
            changed = True
    elif message is not None and event.type in _EMAIL_FAILURES:
        if message.status != "failed":
            message.status = "failed"
            changed = True
    elif event.type == "email.complained":
        client = await _complaining_client(
            db, message, business_id=tags.get("business"), address=address
        )
        if client is not None:
            changed = await record_complaint(db, client)
    business_id = tags.get("business")
    if message is not None:
        business_id = message.business_id
    elif client is not None:
        business_id = client.business_id
    detail = ""
    if data.bounce is not None:
        detail = data.bounce.sub_type
    elif data.failed is not None:
        detail = data.failed.reason
    db.add(
        Webhook(
            id=event_id,
            provider="resend",
            event=event.type,
            payload={
                "email_id": data.email_id or None,
                "to": address,
                "detail": detail,
                "matched": message is not None or client is not None,
                "business_id": business_id,
            },
            status="processed",
            processed_at=datetime.now(UTC),
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if not is_duplicate(exc):  # only a redelivery race may be dropped; anything else must retry
            raise
        return False
    return changed
