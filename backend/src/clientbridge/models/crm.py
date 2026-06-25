from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, SoftDelete, TimestampMixin, enum_check


class Client(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "clients"
    __table_args__ = (
        Index("ix_clients_business_email", "business_id", "email"),
        Index("ix_clients_business_phone", "business_id", "phone"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    lifetime_value_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Subject(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "subjects"
    __table_args__ = (
        enum_check("subjects", "kind", "pet", "vehicle", "child", "property"),
        Index("ix_subjects_business_client", "business_id", "client_id"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    attributes: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Consent(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "consents"
    __table_args__ = (
        enum_check("consents", "channel", "sms", "email"),
        enum_check("consents", "basis", "express", "implied"),
        enum_check("consents", "status", "granted", "withdrawn"),
        Index("ix_consents_client_channel", "business_id", "client_id", "channel"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    basis: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str | None] = mapped_column(String)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Note(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_parent", "business_id", "parent_type", "parent_id"),)

    author_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    parent_type: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
