from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, SoftDelete, TimestampMixin, enum_check

ClientStatus = Literal["active", "inactive"]
NoteParent = Literal["client", "subject", "booking"]
ConsentStatus = Literal["granted", "implied", "withdrawn"]
ConsentSource = Literal[
    "in_person",
    "form",
    "online_booking",
    "reply",
    "unsubscribe",
    "preferences",
]


class Client(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "clients"
    __table_args__ = (
        enum_check("clients", "status", ClientStatus),
        Index("ix_clients_business_phone", "business_id", "phone"),
        Index("ix_clients_created_by", "created_by"),
        Index("ix_clients_user", "user_id"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str | None] = mapped_column(String)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)
    status: Mapped[ClientStatus] = mapped_column(String, default="active", nullable=False)
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String
    )  # Customer on the connected account
    # an archived client is also inactive, so pickers that read the status leave them out
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subject(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "subjects"
    __table_args__ = (
        Index("ix_subjects_business_client", "business_id", "client_id"),
        Index("ix_subjects_client_id", "client_id"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    attributes: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Note(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        enum_check("notes", "parent_type", NoteParent),
        Index("ix_notes_parent", "business_id", "parent_type", "parent_id"),
        Index("ix_notes_created_by", "created_by"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    parent_type: Mapped[NoteParent] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    pinned: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )


class Consent(PKMixin, BusinessScoped, TimestampMixin, Base):
    """One row per change to a client's consent to marketing texts; the newest one holds."""

    __tablename__ = "consents"
    __table_args__ = (
        enum_check("consents", "status", ConsentStatus),
        enum_check("consents", "source", ConsentSource),
        Index("ix_consents_client", "business_id", "client_id", "created_at"),
        Index("ix_consents_recorded_by", "recorded_by"),
        Index("ix_consents_client_id", "client_id"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    status: Mapped[ConsentStatus] = mapped_column(String, nullable=False)
    source: Mapped[ConsentSource] = mapped_column(String, nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
