"""An e2e run's namespace (dev only): ids end in it and the run's worker sees only its rows."""

import secrets

from sqlalchemy import ColumnElement, event, func
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria
from sqlalchemy.sql.base import ExecutableOption

from clientbridge.core.db import Base

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def in_namespace(ulid: str, namespace: str) -> str:
    """The ULID with its tail replaced by fresh randomness and the namespace."""
    # fresh randomness: ULIDs within one millisecond differ only in the tail the namespace takes
    random = "".join(secrets.choice(CROCKFORD) for _ in range(16 - len(namespace)))
    return ulid[:10] + random + namespace


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
