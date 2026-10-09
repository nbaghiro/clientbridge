from datetime import datetime
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check
from clientbridge.models.clients import Channel

PaymentKind = Literal["payment", "deposit", "refund"]
PayMethod = Literal["card", "interac", "bank_eft", "cash", "cheque", "other"]
PaymentProvider = Literal["stripe", "interac", "manual"]
PaymentStatus = Literal["pending", "succeeded", "failed", "refunded", "canceled"]
DisputeStatus = Literal["needs_response", "under_review", "won", "lost"]
SavedMethod = Literal["card", "bank_eft", "interac"]
MandateStatus = Literal["none", "pending", "active", "revoked"]
SetupPurpose = Literal["pad_setup"]


class Payment(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        enum_check("payments", "kind", PaymentKind),
        enum_check("payments", "method", PayMethod),
        # a refund has a parent; a payment settles at most one invoice or order (plus its booking)
        CheckConstraint(
            "(kind = 'refund') = (parent_payment_id IS NOT NULL)"
            " AND num_nonnulls(invoice_id, order_id) <= 1"
            " AND (order_id IS NULL OR booking_id IS NULL)",
            name="ck_payments_target",
        ),
        enum_check("payments", "provider", PaymentProvider),
        enum_check("payments", "status", PaymentStatus),
        Index("ix_payments_status", "business_id", "status"),
        Index("ix_payments_invoice", "invoice_id"),
        Index("ix_payments_order", "order_id"),
        Index("ix_payments_reference_code", "reference_code", unique=True),
        Index("ix_payments_provider_ref", "provider_ref", unique=True),  # one row per Stripe object
        Index("ix_payments_refund_parent", "parent_payment_id"),
        enum_check("payments", "channel", Channel, nullable=True),
        enum_check("payments", "dispute_status", DisputeStatus, nullable=True),
        Index(
            "ux_payments_credit_note",
            "business_id",
            "credit_note",
            unique=True,
            postgresql_where=text("credit_note IS NOT NULL"),
        ),
    )

    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    kind: Mapped[PaymentKind] = mapped_column(String, default="payment", nullable=False)
    parent_payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"))  # Terminal POS sale
    # use_alter breaks the bookings, packages, payments FK cycle so Alembic can order CREATE TABLE
    booking_id: Mapped[str | None] = mapped_column(
        ForeignKey("bookings.id", use_alter=True, name="fk_payments_booking")
    )
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    method: Mapped[PayMethod] = mapped_column(String, nullable=False)
    provider: Mapped[PaymentProvider] = mapped_column(String, nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String)
    reference_code: Mapped[str | None] = mapped_column(String)  # Interac e-Transfer auto-match
    reference: Mapped[str | None] = mapped_column(String)  # cheque number or e-Transfer reference
    note: Mapped[str | None] = mapped_column(String)
    tendered_cents: Mapped[int | None] = mapped_column(BigInteger)  # cash handed over
    status: Mapped[PaymentStatus] = mapped_column(String, default="pending", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refund_notify: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    reason: Mapped[str | None] = mapped_column(String)  # why a refund was given
    credit_note: Mapped[str | None] = mapped_column(String)  # a refund's CN-<document>-<n>
    channel: Mapped[Channel | None] = mapped_column(String)  # how an Interac request went out
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispute_status: Mapped[DisputeStatus | None] = mapped_column(String)
    dispute_reason: Mapped[str | None] = mapped_column(String)
    dispute_respond_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tip_cents: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    # [{staff_id, cents}] until the payment settles; the ledger's tip journals hold it after
    tip_split: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB)


class PaymentMethod(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payment_methods"
    __table_args__ = (
        enum_check("payment_methods", "method", SavedMethod),
        enum_check("payment_methods", "mandate_status", MandateStatus),
        Index("ix_payment_methods_client", "business_id", "client_id"),
        Index("ix_payment_methods_provider", "business_id", "provider_ref", unique=True),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    method: Mapped[SavedMethod] = mapped_column(String, nullable=False)
    brand: Mapped[str | None] = mapped_column(String)
    last4: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str | None] = mapped_column(String)
    provider_ref: Mapped[str | None] = mapped_column(String)
    preferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mandate_status: Mapped[MandateStatus] = mapped_column(String, default="none", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    exp_month: Mapped[int | None] = mapped_column(SmallInteger)
    exp_year: Mapped[int | None] = mapped_column(SmallInteger)
    holder_name: Mapped[str | None] = mapped_column(String)
    bank_name: Mapped[str | None] = mapped_column(String)


class PaymentSetupLink(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payment_setup_links"
    __table_args__ = (
        enum_check("payment_setup_links", "purpose", SetupPurpose),
        Index("uq_payment_setup_links_hash", "token_hash", unique=True),
        Index("uq_payment_setup_links_intent", "setup_intent_id", unique=True),
        Index("ix_payment_setup_links_client", "business_id", "client_id"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    account_id: Mapped[str] = mapped_column(String, nullable=False)
    customer_id: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[SetupPurpose] = mapped_column(String, default="pad_setup", nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    setup_intent_id: Mapped[str | None] = mapped_column(String)
    mandate_ref: Mapped[str | None] = mapped_column(String)
    setup_status: Mapped[str] = mapped_column(String, default="not_started", nullable=False)
