from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, SoftDelete, TimestampMixin, enum_check


class Client(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "clients"
    __table_args__ = (
        enum_check("clients", "status", "active", "inactive"),
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
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String
    )  # Customer on the connected account


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


class Note(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        enum_check("notes", "parent_type", "client", "subject", "booking"),
        Index("ix_notes_parent", "business_id", "parent_type", "parent_id"),
    )

    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    parent_type: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
