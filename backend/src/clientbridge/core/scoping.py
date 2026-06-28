from sqlalchemy import Select, select

from clientbridge.core.db import Base


def scoped[ModelT: Base](
    model: type[ModelT], business_id: str, *, soft_delete: bool = False
) -> Select[tuple[ModelT]]:
    """A tenant-scoped SELECT — the single place the `business_id` (+ soft-delete) filter lives for
    command services that don't use the repository layer. Callers chain their own id/other filters,
    so the tenancy guard can't be forgotten or written inconsistently per lookup.
    """
    stmt = select(model).filter_by(business_id=business_id)
    if soft_delete:
        stmt = stmt.filter_by(deleted_at=None)
    return stmt
