import logging
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import and_, func, literal, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.db import is_duplicate
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.email_layout import Brand
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message
from clientbridge.core.phones import e164, same_phone
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import zone
from clientbridge.integrations.resend import EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business, Staff
from clientbridge.models.clients import Channel, Client
from clientbridge.models.messaging import Broadcast, Delivery, Message, Thread
from clientbridge.models.platform import Webhook, WebhookStatus
from clientbridge.models.scheduling import Booking
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
from clientbridge.services.business import (
    after_quiet_hours,
    postal_address,
    quiet_hours,
    staff_name,
)
from clientbridge.services.consents import (
    allows_marketing,
    latest_consents,
    prefs_url,
    record_complaint,
    record_text_reply,
    stopped_clients,
    texts_stopped,
)
from clientbridge.services.notifications import (
    Notice,
    broadcast_notice,
    broadcast_text,
    business_brand,
    client_email,
    message_notice,
    visit_link,
    visit_note_body,
)
from clientbridge.services.plans import serving

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


async def open_thread(
    db: AsyncSession, business_id: str, client_id: str, channel: Channel
) -> Thread:
    # one thread per (client, channel) by unique constraint → reuse it
    thread = (
        await db.execute(
            scoped(Thread, business_id).where(
                Thread.client_id == client_id, Thread.channel == channel
            )
        )
    ).scalar_one_or_none()
    if thread is not None:
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
    notice: Notice,
    *,
    message: Message,
    business: Business,
    brand: Brand,
) -> None:
    """Hand the message to its channel adapter and record the outcome on the row, never raising."""
    try:
        if channel == "sms":
            message.provider_ref = await sms.send(
                Sms(to=to, body=notice.body, from_number=business.sms_number)
            )
        else:
            message.provider_ref = await email.send(
                client_email(business, brand, to, notice, message=message)
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
    now = clock.now()
    out: list[tuple[Client, str]] = []
    for client in clients:
        to = contact_for(client, channel)
        if to and client.id not in stopped and allows_marketing(consents.get(client.id), now):
            out.append((client, to))
    return out[:_BROADCAST_CAP], len(clients) - len(out[:_BROADCAST_CAP])


def _mailing_address(business: Business) -> str:
    try:
        address = postal_address(business)
    except Unprocessable as missing:
        raise Unprocessable(
            "add the business legal address in Business settings before sending a broadcast",
            code="broadcast_address_missing",
        ) from missing
    parts = {
        "street": address.line1,
        "city": address.city,
        "province": address.province,
        "postal_code": address.postal_code,
    }
    locale = locale_for(business=business)
    if address.line2:
        return message(locale, "broadcast.mailing_address_unit", unit=address.line2, **parts)
    return message(locale, "broadcast.mailing_address", **parts)


def broadcast_identity(business: Business) -> tuple[str, str]:
    """The legal mailing address and a way to reach the business that every broadcast carries."""
    brand = business.brand or {}

    def text(key: str) -> str:
        value = brand.get(key)
        return value.strip() if isinstance(value, str) else ""

    address = _mailing_address(business)
    contact = (
        text("email")
        or text("phone")
        or (business.legal_phone or "")
        or text("website")
        or (business.billing_email or "")
    )
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
    targets = [
        (client.id, to, locale_for(business=business, client=client)) for client, to in recipients
    ]
    brand = await business_brand(db, business)
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
        notice = broadcast_notice(locale, name, subject, body or "", link, address, contact)
        if channel == "sms":
            text = broadcast_text(locale, name, channel, body or "", link, address, contact)
            notice = replace(notice, body=text)
        await dispatch_message(
            sms, email, channel, to, notice, message=message, business=business, brand=brand
        )
        await db.commit()
    claimed = await _claim_broadcast(db, broadcast_id)
    if claimed is None:
        await db.commit()
        return False
    claimed.status = "sent"
    await db.commit()
    return True


async def route_inbound_sms(db: AsyncSession, number: str, destination: str) -> Client | None:
    business_id = await db.scalar(select(Business.id).where(Business.sms_number == destination))
    if business_id is None:
        return None
    clients = list(
        await db.scalars(
            scoped(Client, business_id, soft_delete=True)
            .where(same_phone(Client.phone, number))
            .limit(2)
        )
    )
    return clients[0] if len(clients) == 1 else None


async def process_inbound_sms(
    db: AsyncSession, *, from_phone: str, to_phone: str, body: str, message_sid: str
) -> str | None:
    """Route a signed inbound SMS only within the destination number's business."""
    event_id = f"twilio_{message_sid}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return None
    number = e164(from_phone)
    destination = e164(to_phone)
    client = await route_inbound_sms(db, number, destination) if number and destination else None
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
                "to": destination,
                "matched": client is not None,
                "business_id": client.business_id if client is not None else None,
                "opt_out": keyword in STOP_WORDS,
            },
            status="processed",
            processed_at=clock.now(),
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
                    Broadcast.business_id.in_(select(Business.id).where(serving(now))),
                    or_(
                        Broadcast.status == "sending",
                        and_(
                            Broadcast.status == "scheduled",
                            Broadcast.scheduled_at.is_not(None),
                            Broadcast.scheduled_at <= now,
                        ),
                    ),
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
        if business is None:
            raise NotFound("business not found")
        locale = locale_for(business=business, client=client)
        body = data.body
        if data.booking_id is not None:
            booking = (
                await self.db.execute(
                    scoped(Booking, self.biz, soft_delete=True).where(
                        Booking.id == data.booking_id, Booking.client_id == client.id
                    )
                )
            ).scalar_one_or_none()
            if booking is None:
                raise NotFound("booking not found")
            link = visit_link(booking)
            if link is not None:
                body = visit_note_body(locale, data.body, link)
        notice = message_notice(locale, business.name, body)
        brand = await business_brand(self.db, business)

        async def run(cmd: Command) -> MessageOut:
            thread = await open_thread(self.db, self.biz, client.id, data.channel)
            message = Message(
                id=new_id("message"),
                business_id=self.biz,
                thread_id=thread.id,
                direction="out",
                channel=data.channel,
                sent_by=self.principal.user_id,
                body=body,
                status="queued",
            )
            self.db.add(message)
            await self.db.flush()
            await dispatch_message(
                self.sms,
                self.email,
                data.channel,
                to,
                notice,
                message=message,
                business=business,
                brand=brand,
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
        now = clock.now()
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
        author = (
            scoped(Staff, self.biz)
            .with_only_columns(Staff.user_id, staff_name().label("name"))
            .subquery()
        )
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
_EVENT_GRACE = timedelta(minutes=10)


class EmailEventPending(Exception):
    """Resend reported on a send whose transaction has not committed yet; Svix must retry."""


async def _email_message(db: AsyncSession, email_id: str) -> Message | None:
    # the provider id is unique across tenants; the row it finds names the business
    query = select(Message).where(Message.provider_ref == email_id, Message.channel == "email")
    return (await db.execute(query)).scalars().first()


async def _flagged_client(
    db: AsyncSession, message: Message | None, *, business_id: str | None, client_id: str | None
) -> Client | None:
    """The client the mail went to: through the message's thread, else by the client tag."""
    if message is not None:
        threads = scoped(Thread, message.business_id).where(Thread.id == message.thread_id)
        thread = (await db.execute(threads)).scalar_one_or_none()
        if thread is None:
            return None
        business_id, client_id = message.business_id, thread.client_id
    if not business_id or not client_id:
        return None
    clients = scoped(Client, business_id, soft_delete=True).where(Client.id == client_id)
    return (await db.execute(clients)).scalar_one_or_none()


async def _complaining_clients(
    db: AsyncSession, message: Message | None, *, business_id: str | None, client_id: str | None
) -> list[Client]:
    """Everyone a complaint covers: the flagged client and any record sharing its mailbox."""
    flagged = await _flagged_client(db, message, business_id=business_id, client_id=client_id)
    if flagged is None:
        return []
    if not flagged.email:
        return [flagged]
    query = scoped(Client, flagged.business_id, soft_delete=True).where(
        func.lower(Client.email) == flagged.email.lower()
    )
    return list((await db.execute(query)).scalars().all())


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
    """Record a Resend event on its message; True when it changed something."""
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
    address = recipients[0] if recipients else None
    email_id = data.email_id or ""
    message_id, business_tag = tags.get("message"), tags.get("business")
    message: Message | None = None
    if message_id and business_tag:
        tagged = scoped(Message, business_tag).where(Message.id == message_id)
        message = (await db.execute(tagged)).scalar_one_or_none()
    if message is None and email_id:
        message = await _email_message(db, email_id)
    if message is None and message_id and _is_recent(event.created_at):
        raise EmailEventPending(message_id)
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
    clients: list[Client] = []
    changed = False
    if (
        delivery is not None
        and delivery.payload.get("channel") == "email"
        and delivery.provider_ref in (None, email_id)
    ):
        if event.type == "email.delivered" and delivery.state != "failed":
            delivery.state, delivery.error = "delivered", None
            changed = True
        elif event.type in _EMAIL_FAILURES or event.type == "email.complained":
            delivery.state, delivery.error = "failed", event.type
            changed = True
        elif event.type == "email.sent" and delivery.state in ("queued", "sending", "ambiguous"):
            delivery.state, delivery.error = "accepted", None
            changed = True
        if changed:
            delivery.provider_ref = email_id or delivery.provider_ref
            delivery.next_at, delivery.claim = None, None
    if message is not None:
        heard_before = message.provider_ref is not None
        if not heard_before and email_id:  # the send timed out after Resend had accepted it
            message.provider_ref = email_id
            changed = True
        if event.type == "email.delivered":
            if message.status in ("queued", "sent") or not heard_before:
                message.status = "delivered"
                changed = True
        elif event.type in _EMAIL_FAILURES and message.status != "failed":
            message.status = "failed"
            changed = True
    if event.type == "email.complained":
        clients = await _complaining_clients(
            db, message, business_id=tags.get("business"), client_id=tags.get("client")
        )
        for client in clients:
            changed = await record_complaint(db, client) or changed
    business_id = tags.get("business")
    if message is not None:
        business_id = message.business_id
    elif clients:
        business_id = clients[0].business_id
    detail = ""
    if data.bounce is not None:
        detail = data.bounce.sub_type
    elif data.failed is not None:
        detail = data.failed.reason
    summary: dict[str, object] = {
        "email_id": email_id or None,
        "to": address,
        "detail": detail,
        "matched": message is not None or delivery is not None or bool(clients),
        "business_id": business_id,
    }
    if not await _record_event(db, event_id, event=event.type, payload=summary, status="processed"):
        return False
    return changed
