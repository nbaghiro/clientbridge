from collections.abc import Sequence

from sqlalchemy import Delete, Select, Update, delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import Base


def scoped[ModelT: Base](
    model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> Select[tuple[ModelT]]:
    """A tenant-scoped SELECT — the single place the `business_id` (+ soft-delete) filter lives, so
    the tenancy guard can't be forgotten or written inconsistently per lookup. Services chain their
    own id/other filters; `scoped_page`/`scoped_count` cover the common list endpoints.
    """
    stmt = select(model).filter_by(business_id=business_id)
    if soft_delete:
        stmt = stmt.filter_by(deleted_at=None)
    return stmt


def scoped_update[ModelT: Base](
    model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> Update:
    """A tenant-scoped UPDATE — the write-side mirror of `scoped()`, so a bulk tenant update carries
    the same `business_id` (+ soft-delete) guard. Chain `.where()`/`.values()` for the rest."""
    stmt = update(model).filter_by(business_id=business_id)
    if soft_delete:
        stmt = stmt.filter_by(deleted_at=None)
    return stmt


def scoped_delete[ModelT: Base](model: type[ModelT], business_id: str) -> Delete:
    """A tenant-scoped DELETE — the write-side mirror of `scoped()`. Chain `.where()` on it."""
    return delete(model).filter_by(business_id=business_id)


async def scoped_page[ModelT: Base](
    db: AsyncSession,
    model: type[ModelT],
    business_id: str,
    *,
    limit: int,
    offset: int,
    soft_delete: bool = False,
) -> Sequence[ModelT]:
    # ids are time-sortable ULIDs, so `id DESC` ≈ newest-first without a created_at column ref.
    stmt = (
        scoped(model, business_id, soft_delete=soft_delete)
        .order_by(text("id DESC"))
        .limit(limit)
        .offset(offset)
    )
    return (await db.execute(stmt)).scalars().all()


async def scoped_count[ModelT: Base](
    db: AsyncSession, model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> int:
    stmt = select(func.count()).select_from(
        scoped(model, business_id, soft_delete=soft_delete).subquery()
    )
    return int((await db.execute(stmt)).scalar_one())
