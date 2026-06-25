from datetime import datetime

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


def enum_check(table: str, col: str, *values: str) -> CheckConstraint:
    """text + CHECK enum — e.g. enum_check('bookings', 'status', 'pending', 'confirmed')."""
    allowed = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{col} IN ({allowed})", name=f"ck_{table}_{col}")
