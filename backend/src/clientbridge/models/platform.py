from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class File(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "files"
    __table_args__ = (Index("ix_files_parent", "business_id", "parent_type", "parent_id"),)

    parent_type: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str | None] = mapped_column(String)
    s3_key: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String)
    size: Mapped[int | None] = mapped_column(BigInteger)


class AuditLog(PKMixin, BusinessScoped, Base):
    """Append-only — created_at only (no updated_at)."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_entity", "business_id", "entity_type", "entity_id"),
        Index("ix_audit_created", "business_id", "created_at"),
    )

    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[str] = mapped_column(String, nullable=False)
    changes: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WebhookEvent(PKMixin, TimestampMixin, Base):
    """Not business-scoped — inbound provider events, routed during processing."""

    __tablename__ = "webhook_events"
    __table_args__ = (
        enum_check("webhook_events", "provider", "stripe", "interac", "twilio", "sendgrid"),
        enum_check("webhook_events", "status", "pending", "processed", "failed"),
        Index("ix_webhook_provider_status", "provider", "status"),
    )

    provider: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
