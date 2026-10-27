from sqlalchemy import Delete, Select, Update, delete, select, update

from clientbridge.core.db import Base


def scoped[ModelT: Base](
    model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> Select[tuple[ModelT]]:
    """A tenant-scoped SELECT: the one place the business_id and soft-delete filter lives."""
    stmt = select(model).filter_by(business_id=business_id)
    if soft_delete:
        stmt = stmt.filter_by(deleted_at=None)
    return stmt


def scoped_update[ModelT: Base](
    model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> Update:
    """A tenant-scoped UPDATE, the write-side mirror of `scoped()`."""
    stmt = update(model).filter_by(business_id=business_id)
    if soft_delete:
        stmt = stmt.filter_by(deleted_at=None)
    return stmt


def scoped_delete[ModelT: Base](model: type[ModelT], business_id: str) -> Delete:
    """A tenant-scoped DELETE — the write-side mirror of `scoped()`. Chain `.where()` on it."""
    return delete(model).filter_by(business_id=business_id)
