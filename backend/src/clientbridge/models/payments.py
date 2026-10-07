from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Payment(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        enum_check("payments", "kind", "payment", "deposit", "refund"),
        enum_check("payments", "method", "card", "interac", "bank_eft", "cash", "cheque", "other"),
        # a refund has a parent; a payment settles at most one invoice or order (plus its booking)
        CheckConstraint(
            "(kind = 'refund') = (parent_payment_id IS NOT NULL)"
            " AND num_nonnulls(invoice_id, order_id) <= 1"
            " AND (order_id IS NULL OR booking_id IS NULL)",
            name="ck_payments_target",
        ),
        enum_check("payments", "provider", "stripe", "interac", "manual"),
        enum_check("payments", "status", "pending", "succeeded", "failed", "refunded", "canceled"),
        Index("ix_payments_status", "business_id", "status"),
        Index("ix_payments_invoice", "invoice_id"),
        Index("ix_payments_order", "order_id"),
        Index("ix_payments_reference_code", "reference_code", unique=True),
        Index("ix_payments_provider_ref", "provider_ref", unique=True),  # one row per Stripe object
        Index("ix_payments_refund_parent", "parent_payment_id"),
    )

    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    kind: Mapped[str] = mapped_column(String, default="payment", nullable=False)
    parent_payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"))  # Terminal POS sale
    # use_alter breaks the bookings, packages, payments FK cycle so Alembic can order CREATE TABLE
    booking_id: Mapped[str | None] = mapped_column(
        ForeignKey("bookings.id", use_alter=True, name="fk_payments_booking")
    )
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    method: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String)
    reference_code: Mapped[str | None] = mapped_column(String)  # Interac e-Transfer auto-match
    reference: Mapped[str | None] = mapped_column(String)  # cheque number or e-Transfer reference
    note: Mapped[str | None] = mapped_column(String)
    tendered_cents: Mapped[int | None] = mapped_column(BigInteger)  # cash handed over
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentMethod(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "payment_methods"
    __table_args__ = (
        enum_check("payment_methods", "method", "card", "bank_eft", "interac"),
        enum_check("payment_methods", "mandate_status", "none", "pending", "active", "revoked"),
        Index("ix_payment_methods_client", "business_id", "client_id"),
        Index("ix_payment_methods_provider", "business_id", "provider_ref", unique=True),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    method: Mapped[str] = mapped_column(String, nullable=False)
    brand: Mapped[str | None] = mapped_column(String)
    last4: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str | None] = mapped_column(String)
    provider_ref: Mapped[str | None] = mapped_column(String)
    preferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mandate_status: Mapped[str] = mapped_column(String, default="none", nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
