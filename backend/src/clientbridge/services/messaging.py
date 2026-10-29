import logging
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import and_, func, literal, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.db import is_duplicate
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for
from clientbridge.core.phones import e164, same_phone
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import zone
from clientbridge.integrations.expo import PushSender
from clientbridge.integrations.resend import EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business, Staff
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import Webhook
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.deliveries import SmsDelivery
from clientbridge.schemas.messaging import (
    BroadcastAudience,
    BroadcastOut,
    BroadcastSend,
    ConversationMessage,
    ConversationPage,
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
    record_text_reply,
    stopped_clients,
    texts_stopped,
)
from clientbridge.services.deliveries import delivery_key, enqueue, send_queued
from clientbridge.services.notifications import (
    broadcast_text,
    queued_notifier,
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


async def open_thread(db: AsyncSession, business_id: str, client_id: str) -> Thread:
    # one thread per client by unique constraint → reuse it
    thread = (
        await db.execute(scoped(Thread, business_id).where(Thread.client_id == client_id))
    ).scalar_one_or_none()
    if thread is not None:
        return thread
    thread = Thread(
        id=new_id("thread"), business_id=business_id, client_id=client_id, status="open"
    )
    db.add(thread)
    await db.flush()
    return thread


def client_number(client: Client) -> str | None:
    """The E.164 number a text to the client goes to."""
    return e164(client.phone) if client.phone else None


async def queue_message(
    db: AsyncSession, to: str, body: str, *, messages: Sequence[Message], business: Business
) -> str:
    """Queue one text for the rows it stands for; the delivery sends it and sets their status."""
    sms = Sms(to=to, body=body, from_number=business.sms_number)
    return await enqueue(
        db,
        SmsDelivery(message=sms, message_ids=[message.id for message in messages]),
        key=delivery_key("message", messages[0].id),
        business_id=business.id,
    )


async def broadcast_recipients(
    db: AsyncSession, business_id: str, audience: BroadcastAudience
) -> tuple[Sequence[tuple[Client, str]], int]:
    """The audience members who agreed to marketing texts, and how many were left out."""
    query = scoped(Client, business_id, soft_delete=True).where(Client.status == "active")
    if not audience.all and audience.tags:
        query = query.where(Client.tags.overlap(audience.tags))
    clients = (await db.execute(query.order_by(Client.id))).scalars().all()
    out = _one_per_number(await _reachable(db, business_id, clients))
    return out[:_BROADCAST_CAP], len(clients) - len(out[:_BROADCAST_CAP])


def _one_per_number(recipients: list[tuple[Client, str]]) -> list[tuple[Client, str]]:
    """Clients sharing a number get one copy, sent to the one first by id."""
    first: dict[str, str] = {}
    for client, to in recipients:
        if to not in first or client.id < first[to]:
            first[to] = client.id
    return [(client, to) for client, to in recipients if first[to] == client.id]


async def _reachable(
    db: AsyncSession, business_id: str, clients: Sequence[Client]
) -> list[tuple[Client, str]]:
    ids = [c.id for c in clients]
    consents = await latest_consents(db, business_id, ids)
    stopped = await stopped_clients(db, business_id, ids)
    now = clock.now()
    out: list[tuple[Client, str]] = []
    for client in clients:
        to = client_number(client)
        if to and client.id not in stopped and allows_marketing(consents.get(client.id), now):
            out.append((client, to))
    return out


async def _still_reachable(db: AsyncSession, broadcast: Broadcast, client_id: str) -> str | None:
    """Where the recipient can be reached now, as consent may have changed since the audience."""
    client = (
        await db.execute(
            scoped(Client, broadcast.business_id, soft_delete=True)
            .where(Client.id == client_id, Client.status == "active")
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if client is None:
        return None
    reachable = await _reachable(db, broadcast.business_id, [client])
    return reachable[0][1] if reachable else None


def require_broadcast_identity(business: Business) -> None:
    """Every broadcast's sender needs a legal address and a public way to reach them (CASL)."""
    try:
        postal_address(business)
    except Unprocessable as missing:
        raise Unprocessable(
            "add the business legal address in Business settings before sending a broadcast",
            code="broadcast_address_missing",
        ) from missing
    brand = business.brand or {}
    contacts = (
        brand.get("email"),
        brand.get("phone"),
        business.legal_phone,
        brand.get("website"),
        business.billing_email,
    )
    if not any(isinstance(value, str) and value.strip() for value in contacts):
        raise Unprocessable(
            "add a business email, phone or website before sending a broadcast",
            code="broadcast_contact_missing",
        )


async def _claim_broadcast(db: AsyncSession, broadcast_id: str) -> Broadcast | None:
    """Lock a broadcast that still has work, skipping one another worker holds."""
    return (
        await db.execute(
            select(Broadcast)
            .where(Broadcast.id == broadcast_id, Broadcast.status.in_(("scheduled", "sending")))
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()


async def _already_messaged(db: AsyncSession, broadcast: Broadcast, client_id: str) -> bool:
    already = (
        await db.execute(
            scoped(Message, broadcast.business_id)
            .with_only_columns(Message.id)
            .join(Thread, Thread.id == Message.thread_id)
            .where(Message.broadcast_id == broadcast.id, Thread.client_id == client_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    return already is not None


async def _queue_recipient(db: AsyncSession, broadcast: Broadcast, client_id: str) -> Message:
    """Record the recipient's message before sending, so a retry never messages them twice."""
    thread = await open_thread(db, broadcast.business_id, client_id)
    message = Message(
        id=new_id("message"),
        business_id=broadcast.business_id,
        thread_id=thread.id,
        direction="out",
        sent_by=broadcast.created_by,
        body=broadcast.body,
        status="queued",
        broadcast_id=broadcast.id,
    )
    db.add(message)
    await db.flush()
    return message


async def _send_broadcast(
    db: AsyncSession,
    broadcast_id: str,
    sms: SmsSender,
    email: EmailSender,
    push: PushSender,
    now: datetime,
) -> bool:
    """Send a due broadcast one committed recipient at a time; True once every recipient is done."""
    broadcast = await _claim_broadcast(db, broadcast_id)
    business = await db.get(Business, broadcast.business_id) if broadcast is not None else None
    if broadcast is None or business is None or quiet_hours(now, zone(business.timezone)):
        await db.commit()
        return False
    try:
        require_broadcast_identity(business)
    except Unprocessable:
        _log.warning("broadcast %s waits for the business identity", broadcast.id)
        await db.commit()
        return False
    recipients, excluded = await broadcast_recipients(
        db, broadcast.business_id, BroadcastAudience.model_validate(broadcast.audience)
    )
    broadcast.status = "sending"
    broadcast.recipient_count = len(recipients)
    broadcast.excluded_count = excluded
    name, body = business.name, broadcast.body
    targets = [
        (client.id, locale_for(business=business, client=client)) for client, _ in recipients
    ]
    await db.commit()
    for client_id, locale in targets:
        claimed = await _claim_broadcast(db, broadcast_id)
        if claimed is None:
            await db.commit()
            return False
        if await _already_messaged(db, claimed, client_id):
            await db.commit()
            continue
        to = await _still_reachable(db, claimed, client_id)
        if to is None:
            claimed.recipient_count -= 1
            claimed.excluded_count += 1
            await db.commit()
            continue
        message = await _queue_recipient(db, claimed, client_id)
        text = broadcast_text(locale, name, body or "")
        await queue_message(db, to, text, messages=[message], business=business)
        # the message and its delivery commit together, so the sweep finishes what a crash leaves
        await db.commit()
        await send_queued(db, email, sms, push)
    claimed = await _claim_broadcast(db, broadcast_id)
    if claimed is None:
        await db.commit()
        return False
    claimed.status = "sent"
    await db.commit()
    return True


async def route_inbound_sms(db: AsyncSession, number: str, destination: str) -> Client | None:
    """Of the business's clients on the number, the one a reply most likely answers."""
    business_id = await db.scalar(select(Business.id).where(Business.sms_number == destination))
    if business_id is None:
        return None
    latest = (
        scoped(Message, business_id)
        .with_only_columns(func.max(Message.created_at))
        .join(Thread, Thread.id == Message.thread_id)
        .where(Thread.client_id == Client.id, Message.broadcast_id.is_(None))
        .correlate(Client)
        .scalar_subquery()
    )
    return await db.scalar(
        scoped(Client, business_id, soft_delete=True)
        .where(same_phone(Client.phone, number))
        .order_by((Client.status == "active").desc(), latest.desc().nulls_last(), Client.id)
        .limit(1)
    )


async def process_inbound_sms(
    db: AsyncSession, *, from_phone: str, to_phone: str, body: str, message_sid: str
) -> None:
    """Route a signed inbound SMS only within the destination number's business."""
    event_id = f"twilio_{message_sid}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return
    number = e164(from_phone)
    destination = e164(to_phone)
    client = await route_inbound_sms(db, number, destination) if number and destination else None
    keyword = body.strip().upper()
    if client is not None and number is not None:
        if keyword in STOP_WORDS or keyword in START_WORDS:
            await record_text_reply(db, client, number, stop=keyword in STOP_WORDS)
        thread = await open_thread(db, client.business_id, client.id)
        message = Message(
            id=new_id("message"),
            business_id=client.business_id,
            thread_id=thread.id,
            direction="in",
            body=body,
            status="delivered",
            provider_ref=message_sid,
        )
        db.add(message)
        await db.flush()
        await queued_notifier(
            db, client.business_id, delivery_key("inbound", message.id)
        ).on_inbound_message(db, message.id)
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


async def run_due_broadcasts(
    db: AsyncSession, sms: SmsSender, email: EmailSender, push: PushSender, now: datetime
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
        finished += await _send_broadcast(db, broadcast_id, sms, email, push, now)
    return finished


class MessageService:
    """Outbound messages, sent as audited commands."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_message(
        self, data: MessageSend, idempotency_key: str | None = None
    ) -> MessageOut:
        client = await self._client(data.client_id)
        to = client_number(client)
        if not to:
            raise Unprocessable("client has no mobile number", code="no_mobile_number")
        if await texts_stopped(self.db, self.biz, client.id):
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

        async def run(cmd: Command) -> MessageOut:
            thread = await open_thread(self.db, self.biz, client.id)
            message = Message(
                id=new_id("message"),
                business_id=self.biz,
                thread_id=thread.id,
                direction="out",
                sent_by=self.principal.user_id,
                body=body,
                status="queued",
            )
            self.db.add(message)
            await self.db.flush()
            await queue_message(self.db, to, body, messages=[message], business=business)
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

    async def message(self, message_id: str) -> MessageOut:
        """The message as it stands now, after its delivery has had its first try."""
        message = (
            await self.db.execute(scoped(Message, self.biz).where(Message.id == message_id))
        ).scalar_one_or_none()
        if message is None:
            raise NotFound("message not found")
        return _message_out(message)

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
        require_broadcast_identity(business)
        now = clock.now()
        requested = data.scheduled_at if data.scheduled_at and data.scheduled_at > now else now
        send_at = after_quiet_hours(requested, zone(business.timezone))
        recipients, excluded = await broadcast_recipients(self.db, self.biz, data.audience)

        async def run(cmd: Command) -> BroadcastOut:
            broadcast = Broadcast(
                id=new_id("broadcast"),
                business_id=self.biz,
                created_by=self.principal.user_id,
                name=data.name,
                body=data.body,
                audience=data.audience.model_dump(exclude_defaults=True),
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
        body=message.body,
        status=message.status,
    )


def _broadcast_out(broadcast: Broadcast) -> BroadcastOut:
    return BroadcastOut(
        id=broadcast.id,
        name=broadcast.name,
        status=broadcast.status,
        recipient_count=broadcast.recipient_count,
        excluded_count=broadcast.excluded_count,
        scheduled_at=broadcast.scheduled_at,
    )
