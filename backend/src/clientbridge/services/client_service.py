from collections.abc import Sequence
from datetime import UTC, datetime

from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_count, scoped_page
from clientbridge.models.crm import Client
from clientbridge.schemas.crm import ClientCreate, ClientUpdate
from clientbridge.services.base import BaseService


class ClientService(BaseService):
    async def list(self, *, limit: int, offset: int) -> tuple[Sequence[Client], int]:
        biz = self.principal.business_id
        items = await scoped_page(
            self.db, Client, biz, limit=limit, offset=offset, soft_delete=True
        )
        return items, await scoped_count(self.db, Client, biz, soft_delete=True)

    async def get(self, client_id: str) -> Client:
        client = (
            await self.db.execute(
                scoped(Client, self.principal.business_id, soft_delete=True).where(
                    Client.id == client_id
                )
            )
        ).scalar_one_or_none()
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
