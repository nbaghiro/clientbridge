from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check

DOCUMENT_PARENTS = ("client", "subject", "booking")
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
    __table_args__ = (enum_check("forms", "send_on", "booking", "manual"),)

    name: Mapped[str] = mapped_column(String, nullable=False)
    require_signature: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    send_on: Mapped[str] = mapped_column(
        String, default="manual", server_default="manual", nullable=False
    )


class FormField(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "fields"
    __table_args__ = (
        enum_check("fields", "input", *FORM_FIELD_TYPES),
        Index("ix_fields_form", "form_id", "position"),
    )

    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id"), nullable=False)
    input: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    help: Mapped[str | None] = mapped_column(String)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    options: Mapped[list[object]] = mapped_column(JSONB, default=list, nullable=False)
    validation: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class FormResponse(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "responses"
    __table_args__ = (
        enum_check("responses", "status", "draft", "submitted"),
        enum_check("responses", "parent_type", *DOCUMENT_PARENTS),
        UniqueConstraint("token", name="uq_responses_token"),
        Index("ix_responses_form", "business_id", "form_id"),
        Index("ix_responses_parent", "parent_type", "parent_id"),
    )

    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id"), nullable=False)
    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    parent_type: Mapped[str | None] = mapped_column(String)
    parent_id: Mapped[str | None] = mapped_column(String)
    token: Mapped[str | None] = mapped_column(String)  # public submit-link key (server-minted)
    status: Mapped[str] = mapped_column(String, default="submitted", nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    answers: Mapped[dict[str, object]] = mapped_column(
        JSONB, default=dict, nullable=False
    )  # keyed by field name


class Contract(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "contracts"

    name: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Signature(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "signatures"
    __table_args__ = (
        enum_check("signatures", "status", "pending", "signed", "declined", "expired"),
        enum_check("signatures", "parent_type", *DOCUMENT_PARENTS),
        enum_check("signatures", "method", "typed", "drawn"),
        UniqueConstraint("token", name="uq_signatures_token"),
        Index("ix_signatures_contract", "business_id", "contract_id"),
        Index("ix_signatures_parent", "parent_type", "parent_id"),
    )

    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id"), nullable=False)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    parent_type: Mapped[str | None] = mapped_column(String)
    parent_id: Mapped[str | None] = mapped_column(String)
    token: Mapped[str | None] = mapped_column(String)  # public sign-link key (server-minted)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_body: Mapped[str | None] = mapped_column(String)  # snapshot at signing
    ip: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    contract_version: Mapped[int | None] = mapped_column(Integer)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    method: Mapped[str | None] = mapped_column(String)
    signer_name: Mapped[str | None] = mapped_column(String)
    strokes: Mapped[list[object] | None] = mapped_column(JSONB)
