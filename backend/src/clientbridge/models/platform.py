from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

FILE_PARENTS = ("business", "client", "subject", "item", "signature", "form_response")
FILE_PURPOSES = ("logo", "image", "photo", "signature", "attachment")


class File(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "files"
    __table_args__ = (
        enum_check("files", "parent_type", *FILE_PARENTS),
        enum_check("files", "purpose", *FILE_PURPOSES),
        Index("ix_files_parent", "business_id", "parent_type", "parent_id"),
    )

    parent_type: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[str | None] = mapped_column(String)
    s3_key: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String)
    size: Mapped[int | None] = mapped_column(BigInteger)


class Audit(PKMixin, BusinessScoped, Base):
    """Append-only — created_at only (no updated_at)."""

    __tablename__ = "audits"
    __table_args__ = (
        Index("ix_audit_entity", "business_id", "entity_type", "entity_id"),
        Index("ix_audit_created", "business_id", "created_at"),
    )

    performed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[str] = mapped_column(String, nullable=False)
    changes: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Webhook(PKMixin, TimestampMixin, Base):
    """Not business-scoped — inbound provider events, routed during processing."""

    __tablename__ = "webhooks"
    __table_args__ = (
        enum_check("webhooks", "provider", "stripe", "interac", "twilio", "sendgrid"),
        enum_check("webhooks", "status", "pending", "processed", "failed"),
        Index("ix_webhook_provider_status", "provider", "status"),
    )

    provider: Mapped[str] = mapped_column(String, nullable=False)
    event: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Device(PKMixin, BusinessScoped, TimestampMixin, Base):
    """A staff member's Expo push token, registered by the mobile app — the push outreach target."""

    __tablename__ = "devices"
    __table_args__ = (
        enum_check("devices", "platform", "ios", "android", "web"),
        Index("ix_devices_token", "token", unique=True),
        Index("ix_devices_business", "business_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False)
    platform: Mapped[str] = mapped_column(String, nullable=False)


class IdempotencyKey(PKMixin, BusinessScoped, TimestampMixin, Base):
    """Command replay guard: a repeated (business, scope, key) returns the stored response."""

    __tablename__ = "commands"
    __table_args__ = (
        UniqueConstraint("business_id", "scope", "key", name="uq_idempotency_scope_key"),
    )

    scope: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    response: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
