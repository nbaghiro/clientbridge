from datetime import datetime
from typing import get_args

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column


class PKMixin:
    id: Mapped[str] = mapped_column(String, primary_key=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class BusinessScoped:
    """Mixin: business_id scope key, always indexed. (created_by added per-table where used.)"""

    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id"), index=True, nullable=False
    )


class SoftDelete:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def enum_check(
    table: str, col: str, vocabulary: object, *, nullable: bool = False
) -> CheckConstraint:
    """text + CHECK enum over a Literal alias, e.g. enum_check('slots', 'status', SlotStatus)."""
    allowed = ", ".join(f"'{v}'" for v in get_args(vocabulary))
    check = f"{col} IN ({allowed})"
    return CheckConstraint(
        f"{col} IS NULL OR {check}" if nullable else check, name=f"ck_{table}_{col}"
    )
