from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.db import Base
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page, scoped_update
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.catalog import GiftCard, Package, Subscription
from clientbridge.models.clients import Client, Consent, Note, Subject
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.ledger import Account
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Recurrence
from clientbridge.schemas.clients import (
    BulkResult,
    ClientCreate,
    ClientIds,
    ClientMerge,
    ClientOut,
    ClientTags,
    ClientUpdate,
)
from clientbridge.services.consents import set_marketing_consent

MANAGERS = ("owner", "admin")

# Every table that points at a client, re-pointed when two records merge.
CLIENT_REFS: tuple[tuple[type[Base], str], ...] = (
    (Booking, "client_id"),
    (Recurrence, "client_id"),
    (Estimate, "client_id"),
    (Invoice, "client_id"),
    (Order, "client_id"),
    (Payment, "client_id"),
    (Subject, "client_id"),
    (Review, "client_id"),
    (FormResponse, "client_id"),
    (Signature, "client_id"),
    (Package, "client_id"),
    (Subscription, "client_id"),
    (GiftCard, "purchaser_client_id"),
    (Consent, "client_id"),
)


def clean_tags(tags: Sequence[str]) -> list[str]:
    seen: list[str] = []
    for raw in tags:
        tag = " ".join(raw.split()).lower()
        if tag and tag not in seen:
            seen.append(tag)
    return seen


class ClientService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Client], int]:
        items = await scoped_page(
            self.db, Client, self.biz, limit=limit, offset=offset, soft_delete=True
        )
        return items, await scoped_count(self.db, Client, self.biz, soft_delete=True)

    async def get(self, client_id: str) -> Client:
        return await load_client(self.db, self.biz, client_id)

    async def create(self, data: ClientCreate) -> Client:
        client = Client(
            id=new_id("client"),
            business_id=self.biz,
            created_by=self.principal.user_id,
            name=data.name.strip(),
            email=data.email,
            phone=data.phone,
            tags=clean_tags(data.tags),
            status=data.status,
            custom_fields=data.custom_fields,
            preferred_channel=data.preferred_channel,
        )
        self.db.add(client)
        await self.db.flush()
        if data.subject is not None:
            self.db.add(
                Subject(
                    id=new_id("subject"),
                    business_id=self.biz,
                    client_id=client.id,
                    kind=data.subject.kind,
                    name=data.subject.name.strip(),
                    attributes=data.subject.attributes.model_dump(mode="json", exclude_none=True),
                )
            )
        if data.marketing_consent:
            await set_marketing_consent(
                self.db, self.biz, client.id, agreed=True, recorded_by=self.principal.user_id
            )
        await self.db.flush()
        await self.db.refresh(client)
        await self.db.commit()
        return client

    async def update(self, client_id: str, data: ClientUpdate) -> Client:
        client = await self.get(client_id)
        changes = data.model_dump(exclude_unset=True, exclude={"marketing_consent"})
        if "tags" in changes:
            changes["tags"] = clean_tags(data.tags or [])
        for key, value in changes.items():
            setattr(client, key, value)
        if data.marketing_consent is not None:
            await set_marketing_consent(
                self.db,
                self.biz,
                client.id,
                agreed=data.marketing_consent,
                recorded_by=self.principal.user_id,
            )
        await self.db.flush()
        await self.db.refresh(client)
        await self.db.commit()
        return client

    async def delete(self, client_id: str) -> None:
        client = await self.get(client_id)
        client.deleted_at = datetime.now(UTC)
        await self.db.commit()

    async def set_archived(
        self, client_id: str, *, archived: bool, idempotency_key: str | None
    ) -> ClientOut:
        assert_role(self.principal, *MANAGERS, message="only owners and admins archive clients")
        client = await self.get(client_id)

        async def run(cmd: Command) -> ClientOut:
            client.status = "inactive" if archived else "active"
            client.archived_at = datetime.now(UTC) if archived else None
            await self.db.flush()
            await self.db.refresh(client)
            action = "client.archive" if archived else "client.restore"
            cmd.record(action, entity_type="client", entity_id=client.id)
            return ClientOut.model_validate(client)

        return await run_command(
            self.db,
            self.principal,
            action="client.archive" if archived else "client.restore",
            run=run,
            response_model=ClientOut,
            idempotency_key=idempotency_key,
        )

    async def _many(self, ids: Sequence[str]) -> Sequence[Client]:
        rows = (
            (
                await self.db.execute(
                    scoped(Client, self.biz, soft_delete=True).where(Client.id.in_(ids))
                )
            )
            .scalars()
            .all()
        )
        if len(rows) != len(set(ids)):
            raise NotFound("client not found")
        return rows

    async def archive_many(self, data: ClientIds, idempotency_key: str | None) -> BulkResult:
        assert_role(self.principal, *MANAGERS, message="only owners and admins archive clients")
        clients = await self._many(data.client_ids)

        async def run(cmd: Command) -> BulkResult:
            now = datetime.now(UTC)
            for client in clients:
                if client.archived_at is None:
                    client.status = "inactive"
                    client.archived_at = now
                    cmd.record("client.archive", entity_type="client", entity_id=client.id)
            await self.db.flush()
            return BulkResult(count=len(clients))

        return await run_command(
            self.db,
            self.principal,
            action="client.archive_many",
            run=run,
            response_model=BulkResult,
            idempotency_key=idempotency_key,
        )

    async def tag_many(self, data: ClientTags, idempotency_key: str | None) -> BulkResult:
        clients = await self._many(data.client_ids)
        add = clean_tags([t for t, on in data.set.items() if on])
        drop = set(clean_tags([t for t, on in data.set.items() if not on]))

        async def run(cmd: Command) -> BulkResult:
            for client in clients:
                tags = [t for t in client.tags if t not in drop]
                client.tags = tags + [t for t in add if t not in tags]
                cmd.record(
                    "client.tags",
                    entity_type="client",
                    entity_id=client.id,
                    changes={"add": add, "remove": sorted(drop)},
                )
            await self.db.flush()
            return BulkResult(count=len(clients))

        return await run_command(
            self.db,
            self.principal,
            action="client.tags",
            run=run,
            response_model=BulkResult,
            idempotency_key=idempotency_key,
        )

    async def merge(
        self, client_id: str, data: ClientMerge, idempotency_key: str | None
    ) -> ClientOut:
        assert_role(self.principal, *MANAGERS, message="only owners and admins merge clients")
        if data.from_client_id == client_id:
            raise Conflict("a client can't be merged into itself")

        async def run(cmd: Command) -> ClientOut:
            kept = await self.get(client_id)
            gone = await self.get(data.from_client_id)
            await self._assert_mergeable(gone)
            for field in ("name", "phone", "email"):
                if data.fields.get(field) == "other" or getattr(kept, field) in (None, ""):
                    setattr(kept, field, getattr(gone, field))
            kept.tags = kept.tags + [t for t in gone.tags if t not in kept.tags]
            for model, column in CLIENT_REFS:
                await self.db.execute(
                    scoped_update(model, self.biz)
                    .where(getattr(model, column) == gone.id)
                    .values({column: kept.id})
                )
            await self._merge_threads(kept.id, gone.id)
            await self.db.execute(
                scoped_update(Note, self.biz)
                .where(Note.parent_type == "client", Note.parent_id == gone.id)
                .values(parent_id=kept.id)
            )
            gone.deleted_at = datetime.now(UTC)
            gone.custom_fields = {**gone.custom_fields, "merged_into": kept.id}
            await self.db.flush()
            await self.db.refresh(kept)
            cmd.record(
                "client.merge",
                entity_type="client",
                entity_id=kept.id,
                changes={"from": gone.id, "fields": dict(data.fields)},
            )
            return ClientOut.model_validate(kept)

        return await run_command(
            self.db,
            self.principal,
            action="client.merge",
            run=run,
            response_model=ClientOut,
            idempotency_key=idempotency_key,
        )

    async def _assert_mergeable(self, gone: Client) -> None:
        money = await self.db.scalar(
            select(func.count()).select_from(
                scoped(Account, self.biz)
                .where(Account.owner_type == "client", Account.owner_id == gone.id)
                .subquery()
            )
        )
        if money:
            raise Conflict("the other record has payment history, so it can't be merged yet")
        methods = await self.db.scalar(
            select(func.count()).select_from(
                scoped(PaymentMethod, self.biz)
                .where(PaymentMethod.client_id == gone.id, PaymentMethod.status == "active")
                .subquery()
            )
        )
        if methods:
            raise Conflict("the other record has a saved payment method, so it can't be merged")

    async def _merge_threads(self, kept_id: str, gone_id: str) -> None:
        threads = (
            (
                await self.db.execute(
                    scoped(Thread, self.biz).where(Thread.client_id.in_([kept_id, gone_id]))
                )
            )
            .scalars()
            .all()
        )
        kept_by_channel = {t.channel: t for t in threads if t.client_id == kept_id}
        for thread in threads:
            if thread.client_id != gone_id:
                continue
            target = kept_by_channel.get(thread.channel)
            if target is None:
                thread.client_id = kept_id
                continue
            await self.db.execute(
                scoped_update(Message, self.biz)
                .where(Message.thread_id == thread.id)
                .values(thread_id=target.id)
            )
            await self.db.flush()
            await self.db.delete(thread)


async def load_client(db: AsyncSession, biz: str, client_id: str) -> Client:
    """Load a client by id, soft-deleted included, else NotFound."""
    row = (
        await db.execute(scoped(Client, biz, soft_delete=True).where(Client.id == client_id))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("client not found")
    return row


async def find_or_create_by_contact(
    db: AsyncSession,
    business_id: str,
    *,
    name: str,
    email: str | None,
    phone: str | None,
    source: str,
) -> Client:
    """Match a client by email or phone, else create one tagged with its source."""
    match: list[ColumnElement[bool]] = []
    if email:
        match.append(Client.email == email)
    if phone:
        match.append(Client.phone == phone)
    existing = (
        (
            await db.execute(
                scoped(Client, business_id, soft_delete=True).where(or_(*match)).limit(1)
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    client = Client(
        id=new_id("client"),
        business_id=business_id,
        name=name,
        email=email,
        phone=phone,
        tags=[],
        status="active",
        custom_fields={"source": source},
    )
    db.add(client)
    await db.flush()
    return client
