import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.email import Email, EmailSender
from clientbridge.integrations.sms import Sms, SmsSender
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.schemas.messaging import (
    BroadcastOut,
    BroadcastSend,
    MessageOut,
    MessageSend,
    ThreadOut,
)

_log = logging.getLogger(__name__)
_BROADCAST_CAP = 500


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
            thread = await self._open_thread(client.id, data.channel)
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
            message.status = (
                "sent" if await self._dispatch(data.channel, to, subject, data.body) else "failed"
            )
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
        recipients = await self._recipients(data.channel)

        async def run(cmd: Command) -> BroadcastOut:
            broadcast = Broadcast(
                id=new_id("broadcast"),
                business_id=self.biz,
                created_by=self.principal.user_id,
                name=data.name,
                channel=data.channel,
                status="sending",
            )
            self.db.add(broadcast)
            await self.db.flush()
            for client, to in recipients:
                thread = await self._open_thread(client.id, data.channel)
                message = Message(
                    id=new_id("message"),
                    business_id=self.biz,
                    thread_id=thread.id,
                    direction="out",
                    channel=data.channel,
                    sender_user_id=self.principal.user_id,
                    body=data.body,
                    status="queued",
                    broadcast_id=broadcast.id,
                )
                self.db.add(message)
                await self.db.flush()
                ok = await self._dispatch(data.channel, to, data.name, data.body)
                message.status = "sent" if ok else "failed"  # best-effort per recipient
                thread.last_message_at = datetime.now(UTC)
            await self.db.flush()
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

    async def _open_thread(self, client_id: str, channel: str) -> Thread:
        # one thread per (client, channel) by unique constraint → reuse it, reopening if closed.
        thread = (
            await self.db.execute(
                scoped(Thread, self.biz).where(
                    Thread.client_id == client_id, Thread.channel == channel
                )
            )
        ).scalar_one_or_none()
        if thread is not None:
            thread.status = "open"
            return thread
        thread = Thread(
            id=new_id("thread"),
            business_id=self.biz,
            client_id=client_id,
            channel=channel,
            status="open",
        )
        self.db.add(thread)
        await self.db.flush()
        return thread

    async def _recipients(self, channel: str) -> Sequence[tuple[Client, str]]:
        contact = Client.phone if channel == "sms" else Client.email
        rows = (
            (
                await self.db.execute(
                    scoped(Client, self.biz, soft_delete=True)
                    .where(Client.status == "active", contact.isnot(None), contact != "")
                    .limit(_BROADCAST_CAP)
                )
            )
            .scalars()
            .all()
        )
        out: list[tuple[Client, str]] = []
        for client in rows:
            to = client.phone if channel == "sms" else client.email
            if to:
                out.append((client, to))
        return out

    async def _dispatch(self, channel: str, to: str, subject: str, body: str) -> bool:
        """Hand the message to the channel adapter; a failure is recorded, never raised."""
        try:
            if channel == "sms":
                await self.sms.send(Sms(to=to, body=body))
            else:
                await self.email.send(Email(to=to, subject=subject, body=body))
        except Exception:
            _log.exception("message channel send failed")
            return False
        return True

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
