from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Invoice(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_invoices_business_number"),
        # partial/paid/refunded/overdue are read from the ledger, never stored
        enum_check("invoices", "status", "draft", "sent", "void"),
        Index("ix_invoices_client", "business_id", "client_id"),
        Index("ix_invoices_status", "business_id", "status"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    number: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    subtotal_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overdue_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(String)
    pay_token: Mapped[str | None] = mapped_column(String, unique=True)  # public pay-link key


class Estimate(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "estimates"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_estimates_business_number"),
        enum_check("estimates", "status", "draft", "sent", "accepted", "declined"),
        Index("ix_estimates_status", "business_id", "status"),
    )

    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    number: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    subtotal_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    converted_invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    notes: Mapped[str | None] = mapped_column(String)
    decline_reason: Mapped[str | None] = mapped_column(String)
    view_token: Mapped[str | None] = mapped_column(String, unique=True)  # public accept-link key


class Order(PKMixin, BusinessScoped, TimestampMixin, Base):
    """A lightweight in-person POS sale, paid immediately via Stripe Terminal."""

    __tablename__ = "orders"
    __table_args__ = (
        enum_check("orders", "status", "open", "void"),
        enum_check("orders", "source", "pos", "online"),
        CheckConstraint(
            "pickup_status IS NULL OR pickup_status IN ('unfulfilled', 'ready', 'picked_up')",
            name="ck_orders_pickup_status",
        ),
        Index("ix_orders_status", "business_id", "status"),
    )

    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))  # null = walk-in
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CAD", nullable=False)
    subtotal_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    receipt_email: Mapped[str | None] = mapped_column(String)  # where a walk-in's receipt goes
    receipt_phone: Mapped[str | None] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="pos", nullable=False)
    pickup_status: Mapped[str | None] = mapped_column(String)  # online orders collected in person
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    picked_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Line(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "lines"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(estimate_id, invoice_id, order_id) = 1", name="ck_lines_parent"
        ),
        enum_check("lines", "tax_class", "standard", "federal_only", "exempt"),
        Index("ix_lines_estimate", "estimate_id"),
        Index("ix_lines_invoice", "invoice_id"),
        Index("ix_lines_order", "order_id"),
    )

    estimate_id: Mapped[str | None] = mapped_column(ForeignKey("estimates.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"))
    description: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    quantity: Mapped[float] = mapped_column(Numeric, default=1, nullable=False)
    unit_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_class: Mapped[str] = mapped_column(String, default="standard", nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # an estimate add-on the client may tick; it counts toward totals only once selected
    optional: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    selected: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
