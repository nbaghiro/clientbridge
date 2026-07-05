from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page
from clientbridge.models.crm import Client
from clientbridge.models.payments import Payment
from clientbridge.schemas.crm import ClientCreate, ClientUpdate


class ClientService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Client], int]:
        biz = self.principal.business_id
        items = await scoped_page(
            self.db, Client, biz, limit=limit, offset=offset, soft_delete=True
        )
        return items, await scoped_count(self.db, Client, biz, soft_delete=True)

    async def get(self, client_id: str) -> Client:
        return await load_client(self.db, self.principal.business_id, client_id)

    async def create(self, data: ClientCreate) -> Client:
        client = Client(
            id=new_id("client"),
            business_id=self.principal.business_id,
            created_by=self.principal.user_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            tags=data.tags,
            status=data.status,
            custom_fields=data.custom_fields,
        )
        self.db.add(client)
        await self.db.flush()
        await self.db.refresh(client)
        await self.db.commit()
        return client

    async def update(self, client_id: str, data: ClientUpdate) -> Client:
        client = await self.get(client_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(client, key, value)
        await self.db.flush()
        await self.db.refresh(client)
        await self.db.commit()
        return client

    async def delete(self, client_id: str) -> None:
        client = await self.get(client_id)
        client.deleted_at = datetime.now(UTC)
        await self.db.commit()


async def load_client(db: AsyncSession, biz: str, client_id: str) -> Client:
    """Load a client by id (soft-deleted included), else NotFound. Shared by the booking and
    scheduling flows."""
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
    """Match an existing client by email/phone (soft-deleted included), else create one tagged with
    its acquisition `source`. Used by the online-booking surface to attach a walk-up booker."""
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


async def recompute_ltv(db: AsyncSession, client_id: str | None) -> None:
    """Recompute the client's lifetime value from their settled payments (payments and deposits
    less refunds), so it stays right on every settle/refund. No-op for walk-ins."""
    if client_id is None:
        return
    client = await db.get(Client, client_id)
    if client is None:
        return
    total = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (Payment.kind == "refund", -Payment.amount_cents),
                            else_=Payment.amount_cents,
                        )
                    ),
                    0,
                )
            ).where(Payment.client_id == client_id, Payment.status == "succeeded")
        )
    ).scalar_one()
    client.lifetime_value_cents = int(total)
    await db.flush()
