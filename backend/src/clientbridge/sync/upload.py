"""Server-authoritative write path for PowerSync uploads."""

import json
from datetime import UTC, date, datetime, time

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Boolean, Date, DateTime, Table, Time, delete, select, update
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from clientbridge.core.db import Base
from clientbridge.core.deps import CurrentUserId, DbSession
from clientbridge.core.errors import Forbidden, Unprocessable
from clientbridge.models.identity import Staff

router = APIRouter(prefix="/sync", tags=["sync"])


class UploadOp(BaseModel):
    op: str  # PUT (insert/replace) | PATCH (update) | DELETE
    type: str  # table name
    id: str
    data: dict[str, object] | None = None


class UploadBody(BaseModel):
    ops: list[UploadOp]


# table -> (min tier, own_only); tables absent here are written only through commands.
WRITE_POLICY: dict[str, tuple[str, bool]] = {
    "clients": ("team", False),
    "subjects": ("team", False),
    "notes": ("team", False),
    "messages": ("team", False),
    "hours": ("team", True),
    "items": ("admin", False),
    "resources": ("admin", False),
    "forms": ("admin", False),
    "fields": ("admin", False),
    "contracts": ("admin", False),
}

# Timestamps + tenancy the server owns; never settable by a client write.
SYSTEM_FIELDS = frozenset({"created_at", "updated_at"})

# Fields only a command may write; a sync op that sets one is rejected.
COMMAND_ONLY_FIELDS: dict[str, frozenset[str]] = {
    "clients": frozenset({"stripe_customer_id"}),  # the Stripe Customer, minted by the payment cmd
    # the recurring Price cached by the subscription cmd; stock moves only through sales + restock
    "items": frozenset({"stripe_price_id", "stock_on_hand"}),
}


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
        elif isinstance(col_type, JSONB | ARRAY):
            out[key] = json.loads(value) if isinstance(value, str) else value
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
    """Reject a write touching server-owned fields (timestamps + per-table command-only columns)."""
    owned = (SYSTEM_FIELDS | COMMAND_ONLY_FIELDS.get(table_name, frozenset())) & data.keys()
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
        policy = WRITE_POLICY.get(op.type)
        if table is None or policy is None:
            raise Forbidden(f"table '{op.type}' is not writable via sync")
        min_tier, own_only = policy
        has_staff = "staff_id" in table.columns
        data = op.data or {}

        # Existing row's tenancy (required for PATCH/DELETE; optional for PUT).
        cols = [table.columns["business_id"]]
        if has_staff:
            cols.append(table.columns["staff_id"])
        existing = (
            (await db.execute(select(*cols).where(table.columns["id"] == op.id))).mappings().first()
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

        # No cross-tenant move: a write can't relocate a row to another business.
        new_business = data.get("business_id")
        if isinstance(new_business, str) and new_business != row_business:
            raise Forbidden("cannot change business_id")

        # role + ownership authz
        staff = by_business.get(row_business) if isinstance(row_business, str) else None
        if staff is None:
            raise Forbidden("not a member of that business")
        is_admin = staff.role in ("owner", "admin")
        if min_tier == "admin" and not is_admin:
            raise Forbidden(f"{op.type} requires owner/admin")
        if own_only and not is_admin and row_staff != staff.id:
            raise Forbidden(f"staff may only modify their own {op.type}")

        # server-owned fields (timestamps, numbering, money) can't be set via a sync write
        if op.op in ("PUT", "PATCH"):
            _reject_owned_fields(op.type, data)

        # apply (op.id is authoritative)
        try:
            if op.op == "PUT":
                values = {**_coerce(table, data), "id": op.id}
                changed = {k: v for k, v in values.items() if k != "id"}
                stmt = pg_insert(table).values(**values)
                await db.execute(
                    stmt.on_conflict_do_update(index_elements=["id"], set_=changed)
                    if changed
                    else stmt.on_conflict_do_nothing(index_elements=["id"])
                )
            elif op.op == "PATCH":
                await db.execute(
                    update(table).where(table.columns["id"] == op.id).values(**_coerce(table, data))
                )
            elif op.op == "DELETE":
                if "deleted_at" in table.columns:  # soft-delete so it propagates
                    await db.execute(
                        update(table)
                        .where(table.columns["id"] == op.id)
                        .values(deleted_at=datetime.now(UTC))
                    )
                else:
                    await db.execute(delete(table).where(table.columns["id"] == op.id))
            else:
                raise Forbidden(f"unknown op '{op.op}'")
        except IntegrityError as exc:  # a CHECK or unique rule (e.g. a bookable product, a SKU)
            await db.rollback()
            raise Unprocessable(f"that change to {op.type} breaks a data rule") from exc

    await db.commit()
    return {"applied": len(body.ops)}
