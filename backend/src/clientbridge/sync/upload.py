"""Server-authoritative write path for PowerSync uploads."""

from datetime import date, datetime, time

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Boolean, Date, DateTime, Table, Time, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from clientbridge.core.db import Base
from clientbridge.core.deps import CurrentUserId, DbSession, is_manager
from clientbridge.core.errors import Forbidden, Unprocessable
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Staff

router = APIRouter(prefix="/sync", tags=["sync"])


class UploadOp(BaseModel):
    op: str  # PUT (insert/replace) | PATCH (update) | DELETE
    type: str  # table name
    id: str
    data: dict[str, object] | None = None


class UploadBody(BaseModel):
    ops: list[UploadOp]


# table -> staff may write only their own rows; any table not listed is written only by command.
WRITE_POLICY: dict[str, bool] = {"hours": True}

# Rows inside a sync-writable table that only their command may write (column, value).
COMMAND_ONLY_ROWS: dict[str, tuple[str, str]] = {"hours": ("basis", "exception")}

# Timestamps the server owns; never settable by a client write.
SYSTEM_FIELDS = frozenset({"created_at", "updated_at"})


def _coerce(table: Table, data: dict[str, object]) -> dict[str, object]:
    """Map PowerSync's client values (text/integer/real) back to the Postgres column types."""
    out: dict[str, object] = {}
    for key, value in data.items():
        if value is None or key not in table.columns:
            out[key] = value
            continue
        col_type = table.columns[key].type
        if isinstance(col_type, Boolean):
            out[key] = bool(value)
        elif isinstance(col_type, DateTime):
            out[key] = datetime.fromisoformat(value) if isinstance(value, str) else value
        elif isinstance(col_type, Date):
            out[key] = date.fromisoformat(value) if isinstance(value, str) else value
        elif isinstance(col_type, Time):
            out[key] = time.fromisoformat(value) if isinstance(value, str) else value
        else:
            out[key] = value
    return out


def _reject_owned_fields(table_name: str, data: dict[str, object]) -> None:
    """Reject a write that sets a server-owned timestamp."""
    owned = SYSTEM_FIELDS & data.keys()
    if owned:
        raise Forbidden(f"{table_name}: {sorted(owned)} are server-owned — use a command")


@router.post("/upload")
async def sync_upload(body: UploadBody, user_id: CurrentUserId, db: DbSession) -> dict[str, int]:
    staff_rows = (
        (await db.execute(select(Staff).where(Staff.user_id == user_id, Staff.status == "active")))
        .scalars()
        .all()
    )
    by_business: dict[str, Staff] = {s.business_id: s for s in staff_rows}

    for op in body.ops:
        table = Base.metadata.tables.get(op.type)
        own_only = WRITE_POLICY.get(op.type)
        if table is None or own_only is None:
            raise Forbidden(f"table '{op.type}' is not writable via sync")
        has_staff = "staff_id" in table.columns
        data = {k: v for k, v in (op.data or {}).items() if k != "id"}

        cols = [table.columns["business_id"]]
        if has_staff:
            cols.append(table.columns["staff_id"])
        guard = COMMAND_ONLY_ROWS.get(op.type)
        if guard is not None:
            cols.append(table.columns[guard[0]])
        existing = (
            (await db.execute(select(*cols).where(table.columns["id"] == op.id).with_for_update()))
            .mappings()
            .first()
        )

        if op.op == "PUT":
            row_business = (
                existing["business_id"] if existing is not None else data.get("business_id")
            )
            row_staff = existing["staff_id"] if existing is not None else data.get("staff_id")
        else:
            if existing is None:
                raise Forbidden("row not found")
            row_business = existing["business_id"]
            row_staff = existing["staff_id"] if has_staff else None

        if guard is not None:
            column, value = guard
            current = existing[column] if existing is not None else None
            if value in (current, data.get(column)):
                raise Forbidden(f"{op.type} rows with {column} '{value}' are written by command")

        if "business_id" in data and data["business_id"] != row_business:
            raise Forbidden("cannot change business_id")

        staff = by_business.get(row_business) if isinstance(row_business, str) else None
        if staff is None:
            raise Forbidden("not a member of that business")
        if own_only and not is_manager(staff.role) and row_staff != staff.id:
            raise Forbidden(f"staff may only modify their own {op.type}")

        if has_staff and op.op in ("PUT", "PATCH"):
            new_staff = data.get("staff_id", row_staff)
            if own_only and not is_manager(staff.role) and new_staff != staff.id:
                raise Forbidden(f"staff may only modify their own {op.type}")
            if new_staff is not None and (
                not isinstance(new_staff, str)
                or await db.scalar(
                    scoped(Staff, staff.business_id)
                    .with_only_columns(Staff.id)
                    .where(Staff.id == new_staff)
                )
                is None
            ):
                raise Forbidden("staff member is not in that business")

        if op.op in ("PUT", "PATCH"):
            _reject_owned_fields(op.type, data)

        # op.id wins over any id in data
        try:
            if op.op == "PUT":
                values = {**_coerce(table, data), "id": op.id}
                changed = {k: v for k, v in values.items() if k != "id"}
                stmt = pg_insert(table).values(**values)
                allowed = table.columns["business_id"] == staff.business_id
                if own_only and not is_manager(staff.role):
                    allowed &= table.columns["staff_id"] == staff.id
                if guard is not None:
                    allowed &= table.columns[guard[0]] != guard[1]
                saved = await db.scalar(
                    stmt.on_conflict_do_update(
                        index_elements=["id"], set_=changed or {"id": op.id}, where=allowed
                    ).returning(table.columns["id"])
                )
                if saved is None:
                    raise Forbidden("row ownership changed; upload refused")
            elif op.op == "PATCH":
                if data:
                    await db.execute(
                        update(table)
                        .where(table.columns["id"] == op.id)
                        .values(**_coerce(table, data))
                    )
            elif op.op == "DELETE":
                await db.execute(delete(table).where(table.columns["id"] == op.id))
            else:
                raise Forbidden(f"unknown op '{op.op}'")
        except IntegrityError as exc:  # a CHECK or unique rule on the row
            await db.rollback()
            raise Unprocessable(f"that change to {op.type} breaks a data rule") from exc

    await db.commit()
    return {"applied": len(body.ops)}
