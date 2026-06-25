from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Payment(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        enum_check("payments", "kind", "payment", "deposit", "refund"),
        enum_check("payments", "method", "card", "interac", "eft", "cash", "other"),
        enum_check("payments", "provider", "stripe", "interac", "manual"),
        enum_check("payments", "status", "pending", "succeeded", "failed", "refunded", "canceled"),
        Index("ix_payments_status", "business_id", "status"),
        Index("ix_payments_invoice", "invoice_id"),
        Index("ix_payments_reference_code", "reference_code"),
    )

    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    kind: Mapped[str] = mapped_column(String, default="payment", nullable=False)
    parent_payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    method: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String)
    reference_code: Mapped[str | None] = mapped_column(String)  # Interac e-Transfer auto-match
    fee_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    net_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentMethod(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payment_methods"
    __table_args__ = (
        enum_check("payment_methods", "type", "card", "bank_eft", "interac"),
        enum_check("payment_methods", "mandate_status", "none", "pending", "active", "revoked"),
        Index("ix_payment_methods_client", "business_id", "client_id"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    brand: Mapped[str | None] = mapped_column(String)
    last4: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str | None] = mapped_column(String)
    provider_ref: Mapped[str | None] = mapped_column(String)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mandate_status: Mapped[str] = mapped_column(String, default="none", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)


class Payout(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payouts"
    __table_args__ = (
        enum_check("payouts", "status", "pending", "in_transit", "paid", "failed", "canceled"),
        Index("ix_payouts_status", "business_id", "status"),
    )

    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_ref: Mapped[str | None] = mapped_column(String)
    bank_last4: Mapped[str | None] = mapped_column(String)


class PayoutAllocation(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payout_allocations"
    __table_args__ = (
        enum_check(
            "payout_allocations",
            "source_type",
            "booking",
            "invoice_line",
            "class_session",
            "tip",
            "sale",
        ),
        enum_check("payout_allocations", "basis", "rate", "percent", "fixed"),
        enum_check("payout_allocations", "status", "pending", "approved", "paid"),
        Index("ix_payout_alloc_member", "business_id", "member_id", "status"),
        Index("ix_payout_alloc_source", "source_type", "source_id"),
    )

    member_id: Mapped[str] = mapped_column(ForeignKey("memberships.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    basis: Mapped[str | None] = mapped_column(String)
    rate: Mapped[float | None] = mapped_column(Numeric)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    payout_id: Mapped[str | None] = mapped_column(ForeignKey("payouts.id"))
