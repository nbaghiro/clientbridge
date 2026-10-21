from datetime import datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class ReviewRequest(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "review_requests"
    __table_args__ = (Index("ix_review_requests_booking", "business_id", "booking_id"),)

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


GoogleConnectionState = Literal["selecting", "active", "reconnect_required", "disconnected"]
GoogleOperationKind = Literal["reply_put", "reply_delete"]
GoogleOperationState = Literal["queued", "running", "confirmed", "failed", "unknown", "canceled"]


class GoogleBusinessConnection(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "google_business_connections"
    __table_args__ = (
        UniqueConstraint("business_id", name="uq_google_connection_business"),
        enum_check("google_business_connections", "state", GoogleConnectionState),
        CheckConstraint("generation > 0", name="ck_google_connection_generation"),
        Index(
            "uq_google_active_location",
            "location_name",
            unique=True,
            postgresql_where=text("state = 'active'"),
        ),
    )

    connected_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    account_name: Mapped[str | None] = mapped_column(String)
    location_name: Mapped[str | None] = mapped_column(String)
    refresh_token_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    key_version: Mapped[str | None] = mapped_column(String)
    state: Mapped[GoogleConnectionState] = mapped_column(String, nullable=False)
    generation: Mapped[int] = mapped_column(default=1, nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String)


class GoogleBusinessOperation(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "google_business_operations"
    __table_args__ = (
        UniqueConstraint("business_id", "kind", "idempotency_key", name="uq_google_operation_key"),
        enum_check("google_business_operations", "kind", GoogleOperationKind),
        enum_check("google_business_operations", "state", GoogleOperationState),
        CheckConstraint("generation > 0", name="ck_google_operation_generation"),
        CheckConstraint("attempts >= 0", name="ck_google_operation_attempts"),
        Index("ix_google_operations_due", "state", "next_at"),
    )

    connection_id: Mapped[str] = mapped_column(
        ForeignKey("google_business_connections.id"), nullable=False
    )
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    generation: Mapped[int] = mapped_column(nullable=False)
    kind: Mapped[GoogleOperationKind] = mapped_column(String, nullable=False)
    review_name: Mapped[str] = mapped_column(String, nullable=False)
    request_hash: Mapped[str] = mapped_column(String, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)
    request_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    key_version: Mapped[str | None] = mapped_column(String)
    expected_reply_revision: Mapped[str | None] = mapped_column(String)
    state: Mapped[GoogleOperationState] = mapped_column(String, nullable=False)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String)
