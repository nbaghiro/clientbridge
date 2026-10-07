from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.scheduling import Resource, Slot
from clientbridge.schemas.resources import ResourceCreate, ResourceOut, ResourcePatch

_ADMIN_ONLY = "only an owner or admin can change rooms and stations"


class ResourceService:
    """Rooms and stations the booking engine holds per visit; owner/admin manage them."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        assert_role(principal, "owner", "admin", message=_ADMIN_ONLY)
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: ResourceCreate, idempotency_key: str | None) -> ResourceOut:
        name = data.name.strip()

        async def run(cmd: Command) -> ResourceOut:
            await self._assert_unique(name, None)
            row = Resource(
                id=new_id("resource"),
                business_id=self.biz,
                name=name,
                category=data.category,
                capacity=data.capacity if data.category == "room" else 1,
                active=data.active,
            )
            self.db.add(row)
            await self.db.flush()
            cmd.record("resource.create", entity_type="resource", entity_id=row.id)
            return await self._out(row)

        return await run_command(
            self.db,
            self.principal,
            action="resource.create",
            run=run,
            response_model=ResourceOut,
            idempotency_key=idempotency_key,
        )

    async def update(self, resource_id: str, data: ResourcePatch) -> ResourceOut:
        row = (
            await self.db.execute(scoped(Resource, self.biz).where(Resource.id == resource_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("room or station not found")
        name = data.name.strip() if data.name is not None else None
        if name is not None:
            await self._assert_unique(name, row.id)

        async def run(cmd: Command) -> ResourceOut:
            if name is not None:
                row.name = name
            if data.category is not None:
                row.category = data.category
            if data.capacity is not None:
                row.capacity = data.capacity
            if row.category != "room":
                row.capacity = 1
            if data.active is not None:
                row.active = data.active
            await self.db.flush()
            cmd.record("resource.update", entity_type="resource", entity_id=row.id)
            return await self._out(row)

        return await run_command(
            self.db,
            self.principal,
            action="resource.update",
            run=run,
            response_model=ResourceOut,
        )

    async def _assert_unique(self, name: str, own_id: str | None) -> None:
        q = scoped(Resource, self.biz).where(func.lower(Resource.name) == name.lower())
        if own_id is not None:
            q = q.where(Resource.id != own_id)
        if (await self.db.execute(q.limit(1))).first() is not None:
            raise Conflict("there's already a room or station with that name")

    async def _out(self, row: Resource) -> ResourceOut:
        upcoming = await self.db.execute(
            scoped(Slot, self.biz)
            .where(
                Slot.resource_id == row.id,
                Slot.status == "scheduled",
                Slot.starts_at >= datetime.now(UTC),
            )
            .with_only_columns(func.count(Slot.id))
        )
        return ResourceOut(
            id=row.id,
            business_id=row.business_id,
            name=row.name,
            category=row.category,
            capacity=row.capacity,
            active=row.active,
            upcoming=int(upcoming.scalar_one()),
        )
