from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Resource, Slot
from clientbridge.schemas.resources import ResourceCreate, ResourceOut, ResourceUpdate

RESOURCE_BUSY = "that room or equipment is already booked at that time"
NO_RESOURCE = "none of the rooms or equipment this service needs is free then"
NOT_IN_POOL = "this service doesn't use that room or equipment"
_NAME_TAKEN = "another room or piece of equipment already has that name"
_MANAGERS = "only an owner or admin can change rooms and equipment"


async def lock_resources(db: AsyncSession, business_id: str, *resource_ids: str | None) -> None:
    """Serialise picks per resource; callers lock staff first, then every resource they may take."""
    for resource_id in sorted({r for r in resource_ids if r is not None}):
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"{business_id}:resource:{resource_id}"},
        )


async def pool_of(db: AsyncSession, business_id: str, item: Item) -> list[str]:
    """The active resources of the service's pool, in pool order; empty when it needs none."""
    if not item.resource_ids:
        return []
    active = set(
        await db.scalars(
            scoped(Resource, business_id)
            .with_only_columns(Resource.id)
            .where(Resource.id.in_(item.resource_ids), Resource.active.is_(True))
        )
    )
    return [r for r in item.resource_ids if r in active]


def busy_window(starts_at: datetime, ends_at: datetime, item: Item) -> tuple[datetime, datetime]:
    return (
        starts_at - timedelta(minutes=item.buffer_before_min),
        ends_at + timedelta(minutes=item.buffer_after_min),
    )


async def resource_free(
    db: AsyncSession,
    business_id: str,
    resource_ids: Sequence[str],
    item: Item,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> list[str]:
    """The resources no live slot holds over the window, buffers on both sides, in order."""
    if not resource_ids:
        return []
    start, end = busy_window(starts_at, ends_at, item)
    q = (
        scoped(Slot, business_id)
        .with_only_columns(Slot.resource_id)
        .join(Item, Item.id == Slot.item_id)
        .where(
            Slot.resource_id.in_(resource_ids),
            Slot.status != "canceled",
            Slot.starts_at - func.make_interval(0, 0, 0, 0, 0, Item.buffer_before_min) < end,
            Slot.ends_at + func.make_interval(0, 0, 0, 0, 0, Item.buffer_after_min) > start,
        )
    )
    if exclude is not None:
        q = q.where(Slot.id != exclude)
    busy = set(await db.scalars(q))
    return [r for r in dict.fromkeys(resource_ids) if r not in busy]


@dataclass(frozen=True)
class ResourceChoice:
    """What a visit would hold in a window, the free resources it could switch to, or why not."""

    held: str | None
    free: list[str]
    refusal: AppError | None = None


async def choose_resource(
    db: AsyncSession,
    business_id: str,
    item: Item,
    starts_at: datetime,
    ends_at: datetime,
    *,
    exclude: str | None = None,
    hold: str | None = None,
    chosen: str | None = None,
) -> ResourceChoice:
    """The one chosen, else the one the visit holds, else the first free one in the pool."""
    pool = await pool_of(db, business_id, item)
    candidates = [*([hold] if hold is not None else []), *pool]
    free = await resource_free(db, business_id, candidates, item, starts_at, ends_at, exclude)
    if chosen is not None:
        if chosen not in candidates:
            return ResourceChoice(
                None, free, Unprocessable(NOT_IN_POOL, code="resource_not_in_pool")
            )
        if chosen not in free:
            return ResourceChoice(None, free, Conflict(RESOURCE_BUSY, code="resource_busy"))
        return ResourceChoice(chosen, free)
    if free or not pool:
        return ResourceChoice(free[0] if free else None, free)
    return ResourceChoice(None, free, Conflict(NO_RESOURCE, code="no_resource"))


async def pick_resource(
    db: AsyncSession,
    business_id: str,
    item: Item,
    starts_at: datetime,
    ends_at: datetime,
    *,
    exclude: str | None = None,
    hold: str | None = None,
    chosen: str | None = None,
) -> str | None:
    """The resource a visit takes, refused when the chosen one or every one is taken."""
    choice = await choose_resource(
        db, business_id, item, starts_at, ends_at, exclude=exclude, hold=hold, chosen=chosen
    )
    if choice.refusal is not None:
        raise choice.refusal
    return choice.held


async def keep_resource(
    db: AsyncSession,
    item: Item,
    slot: Slot,
    starts_at: datetime,
    ends_at: datetime,
    chosen: str | None = None,
) -> None:
    """Carry the visit's resource to a new window, or switch to a free one in its pool."""
    if chosen is None and slot.resource_id is None and not item.resource_ids:
        return
    await lock_resources(db, slot.business_id, slot.resource_id, chosen, *item.resource_ids)
    slot.resource_id = await pick_resource(
        db,
        slot.business_id,
        item,
        starts_at,
        ends_at,
        exclude=slot.id,
        hold=slot.resource_id,
        chosen=chosen,
    )


def lost_race(exc: IntegrityError, fallback: AppError) -> AppError:
    """The refusal for a write the overlap constraints stopped: the resource, else `fallback`."""
    if "excl_slots_resource_overlap" in str(exc.orig):
        return Conflict(RESOURCE_BUSY, code="resource_busy")
    return fallback


class ResourceService:
    """The rooms and equipment a business books, kept by name; an inactive one retires it."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def read(self) -> list[ResourceOut]:
        rows = await self.db.scalars(
            scoped(Resource, self.biz).order_by(func.lower(Resource.name), Resource.id)
        )
        found = list(rows)
        counts = await self._upcoming([r.id for r in found])
        return [_out(r, counts.get(r.id, 0)) for r in found]

    async def create(self, data: ResourceCreate, idempotency_key: str | None) -> ResourceOut:
        assert_role(self.principal, "owner", "admin", message=_MANAGERS)
        name = data.name

        async def run(cmd: Command) -> ResourceOut:
            await self._assert_name_free(name)
            resource = Resource(id=new_id("resource"), business_id=self.biz, name=name)
            self.db.add(resource)
            await self._save()
            await self.db.refresh(resource)
            cmd.record("resource.create", entity_type="resource", entity_id=resource.id)
            return _out(resource, 0)

        return await run_command(
            self.db,
            self.principal,
            action="resource.create",
            run=run,
            response_model=ResourceOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def update(
        self, resource_id: str, data: ResourceUpdate, idempotency_key: str | None
    ) -> ResourceOut:
        assert_role(self.principal, "owner", "admin", message=_MANAGERS)
        resource = await self._resource(resource_id)

        async def run(cmd: Command) -> ResourceOut:
            changes: dict[str, object] = {}
            if data.name is not None and data.name != resource.name:
                await self._assert_name_free(data.name, resource.id)
                changes["name"] = resource.name = data.name
            if data.active is not None and data.active != resource.active:
                changes["active"] = resource.active = data.active
            await self._save()
            await self.db.refresh(resource)
            cmd.record(
                "resource.update", entity_type="resource", entity_id=resource.id, changes=changes
            )
            counts = await self._upcoming([resource.id])
            return _out(resource, counts.get(resource.id, 0))

        return await run_command(
            self.db,
            self.principal,
            action="resource.update",
            run=run,
            response_model=ResourceOut,
            idempotency_key=idempotency_key,
            request={"resource_id": resource_id, **data.model_dump(mode="json")},
        )

    async def _assert_name_free(self, name: str, keep: str | None = None) -> None:
        q = scoped(Resource, self.biz).where(func.lower(Resource.name) == name.lower())
        if keep is not None:
            q = q.where(Resource.id != keep)
        if await self.db.scalar(q.limit(1)) is not None:
            raise Conflict(_NAME_TAKEN, code="resource_name_taken")

    async def _save(self) -> None:
        try:
            async with self.db.begin_nested():
                await self.db.flush()
        except IntegrityError as exc:
            raise Conflict(_NAME_TAKEN, code="resource_name_taken") from exc

    async def _upcoming(self, resource_ids: list[str]) -> dict[str, int]:
        if not resource_ids:
            return {}
        rows = await self.db.execute(
            scoped(Slot, self.biz)
            .with_only_columns(Slot.resource_id, func.count(Slot.id))
            .where(
                Slot.resource_id.in_(resource_ids),
                Slot.status == "scheduled",
                Slot.starts_at > clock.now(),
            )
            .group_by(Slot.resource_id)
        )
        return {resource_id: int(n) for resource_id, n in rows.tuples() if resource_id}

    async def _resource(self, resource_id: str) -> Resource:
        found = await self.db.scalar(scoped(Resource, self.biz).where(Resource.id == resource_id))
        if found is None:
            raise NotFound("resource not found")
        return found


def _out(resource: Resource, upcoming: int) -> ResourceOut:
    return ResourceOut(
        id=resource.id,
        business_id=resource.business_id,
        name=resource.name,
        active=resource.active,
        created_at=resource.created_at,
        updated_at=resource.updated_at,
        upcoming=upcoming,
    )
