from sqlalchemy import (
    ColumnElement,
    Delete,
    Select,
    Update,
    delete,
    event,
    func,
    select,
    update,
)
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria
from sqlalchemy.sql.base import ExecutableOption

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


def namespaced(namespace: str) -> list[ExecutableOption]:
    """A criterion on every table that belongs to a business: its id ends in the namespace."""
    options: list[ExecutableOption] = []
    for mapper in Base.registry.mappers:
        model = mapper.class_
        key = "id" if getattr(model, "__tablename__", "") == "businesses" else "business_id"
        if key in mapper.columns:
            column: ColumnElement[str] = mapper.columns[key]
            options.append(
                with_loader_criteria(model, func.right(column, len(namespace)) == namespace)
            )
    return options


def confine_to_namespace(namespace: str, target: Session | type[Session] = Session) -> None:
    """ORM statements on the target, by default every session, see only the namespace's rows."""
    options = namespaced(namespace)

    def confine(state: ORMExecuteState) -> None:
        if state.is_select or state.is_update or state.is_delete:
            state.statement = state.statement.options(*options)

    event.listen(target, "do_orm_execute", confine)
