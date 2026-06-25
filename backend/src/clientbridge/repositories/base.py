"""The single place that knows about tenancy scoping + soft-delete.

Subclasses set `model` (and `soft_delete = True` for soft-deletable tables). Queries are built with
`filter_by` (keyword filters) so the base stays fully generic without per-model column typing.
"""

from collections.abc import Sequence

from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import Base


class BaseRepository[ModelT: Base]:
    model: type[ModelT]
    soft_delete: bool = False

    def __init__(self, db: AsyncSession, business_id: str) -> None:
        self.db = db
        self.business_id = business_id

    def _scoped(self) -> Select[tuple[ModelT]]:
        stmt = select(self.model).filter_by(business_id=self.business_id)
        if self.soft_delete:
            stmt = stmt.filter_by(deleted_at=None)
        return stmt

    async def get(self, entity_id: str) -> ModelT | None:
        result = await self.db.execute(self._scoped().filter_by(id=entity_id))
        return result.scalar_one_or_none()

    async def list(self, *, limit: int, offset: int) -> Sequence[ModelT]:
        # ids are time-sortable ULIDs, so `id DESC` ≈ newest-first without a created_at column ref.
        stmt = self._scoped().order_by(text("id DESC")).limit(limit).offset(offset)
        return (await self.db.execute(stmt)).scalars().all()

    async def count(self) -> int:
        stmt = select(func.count()).select_from(self._scoped().subquery())
        return int((await self.db.execute(stmt)).scalar_one())

    async def add(self, obj: ModelT) -> ModelT:
        self.db.add(obj)
        await self.db.flush()
        await self.db.refresh(obj)  # pull server-defaulted created_at/updated_at
        return obj
