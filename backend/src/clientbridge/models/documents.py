from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

FORM_FIELD_TYPES = (
    "text",
    "longtext",
    "number",
    "currency",
    "select",
    "multiselect",
    "checkbox",
    "date",
    "time",
    "email",
    "phone",
    "address",
    "file",
    "image",
    "signature",
    "rating",
)


class Form(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "forms"

    name: Mapped[str] = mapped_column(String, nullable=False)
    attach_to: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)
    require_signature: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FormField(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "form_fields"
    __table_args__ = (
        enum_check("form_fields", "type", *FORM_FIELD_TYPES),
        Index("ix_form_fields_form", "form_id", "position"),
    )

    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    help: Mapped[str | None] = mapped_column(String)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    options: Mapped[list[object]] = mapped_column(JSONB, default=list, nullable=False)
    validation: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    default_value: Mapped[str | None] = mapped_column("default", String)  # "default" is reserved
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class FormResponse(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "form_responses"
    __table_args__ = (
        enum_check("form_responses", "status", "draft", "submitted"),
        Index("ix_form_responses_form", "business_id", "form_id"),
        Index("ix_form_responses_parent", "parent_type", "parent_id"),
    )

    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id"), nullable=False)
    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    parent_type: Mapped[str | None] = mapped_column(String)
    parent_id: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="submitted", nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    answers: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, nullable=False
    )  # keyed by field name


class Contract(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "contracts"

    name: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    always_require: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires: Mapped[str | None] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Signature(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "signatures"
    __table_args__ = (
        enum_check("signatures", "status", "pending", "signed", "declined", "expired"),
        Index("ix_signatures_contract", "business_id", "contract_id"),
        Index("ix_signatures_parent", "parent_type", "parent_id"),
    )

    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id"), nullable=False)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    parent_type: Mapped[str | None] = mapped_column(String)
    parent_id: Mapped[str | None] = mapped_column(String)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signature_image_id: Mapped[str | None] = mapped_column(ForeignKey("files.id"))
    signed_body: Mapped[str | None] = mapped_column(String)  # snapshot at signing
    ip: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
