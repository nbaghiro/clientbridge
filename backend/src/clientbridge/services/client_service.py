from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.models.crm import Client
from clientbridge.repositories.crm import ClientRepository
from clientbridge.schemas.crm import ClientCreate, ClientUpdate
from clientbridge.services.base import BaseService


class ClientService(BaseService):
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        super().__init__(db, principal)
        self.repo = ClientRepository(db, principal.business_id)

    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Client], int]:
        items = await self.repo.list(limit=limit, offset=offset)
        total = await self.repo.count()
        return items, total

    async def get(self, client_id: str) -> Client:
        client = await self.repo.get(client_id)
        if client is None:
            raise NotFound("client not found")
        return client

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
        await self.repo.add(client)
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
