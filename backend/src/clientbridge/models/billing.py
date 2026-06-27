from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, TimestampMixin, enum_check


class Invoice(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_invoices_business_number"),
        enum_check("invoices", "status", "draft", "sent", "partial", "paid", "overdue", "void"),
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
    amount_paid_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(String)


class Estimate(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "estimates"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_estimates_business_number"),
        enum_check("estimates", "status", "draft", "sent", "accepted", "declined", "expired"),
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


class Line(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "lines"
    __table_args__ = (
        enum_check("lines", "parent_type", "invoice", "estimate"),
        Index("ix_lines_parent", "parent_type", "parent_id"),
    )

    parent_type: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    booking_id: Mapped[str | None] = mapped_column(ForeignKey("bookings.id"))
    quantity: Mapped[float] = mapped_column(Numeric, default=1, nullable=False)
    unit_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tax_rate_id: Mapped[str | None] = mapped_column(ForeignKey("tax_rates.id"))
    tax_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class TaxRate(PKMixin, TimestampMixin, Base):
    """System-seeded; business_id NULL = global default."""

    __tablename__ = "tax_rates"
    __table_args__ = (
        enum_check("tax_rates", "jurisdiction", "GST", "HST", "PST", "QST"),
        Index("ix_tax_rates_province", "province", "jurisdiction"),
    )

    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String, nullable=False)
    province: Mapped[str] = mapped_column(String, nullable=False)
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
