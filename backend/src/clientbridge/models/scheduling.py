from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Time,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from clientbridge.core.db import Base
from clientbridge.models.base import BusinessScoped, PKMixin, SoftDelete, TimestampMixin, enum_check


class Slot(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "slots"
    __table_args__ = (
        enum_check("slots", "status", "scheduled", "canceled", "completed"),
        Index("ix_slots_staff_start", "business_id", "staff_id", "starts_at"),
        Index("ix_slots_business_start", "business_id", "starts_at"),
    )

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(ForeignKey("resources.id"))
    recurrence_id: Mapped[str | None] = mapped_column(ForeignKey("recurrences.id"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String, default="scheduled", nullable=False)


class Booking(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        enum_check(
            "bookings", "status", "pending", "confirmed", "completed", "canceled", "no_show"
        ),
        enum_check("bookings", "source", "online", "manual"),
        enum_check(
            "bookings",
            "deposit_status",
            "none",
            "pending",
            "collected",
            "applied",
            "forfeited",
            "refunded",
        ),
        Index("ix_bookings_slot", "business_id", "slot_id"),
        Index("ix_bookings_client", "business_id", "client_id"),
        Index("ix_bookings_status", "business_id", "status"),
        Index("ix_bookings_staff", "business_id", "staff_id"),
    )

    slot_id: Mapped[str] = mapped_column(ForeignKey("slots.id"), nullable=False)
    # Denormalized from the slot's staff — lets per-staff sync rules slice bookings directly.
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    subject_id: Mapped[str | None] = mapped_column(ForeignKey("subjects.id"))
    package_id: Mapped[str | None] = mapped_column(ForeignKey("packages.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    source: Mapped[str] = mapped_column(String, default="manual", nullable=False)
    price_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    deposit_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # lifecycle only, set as the ledger books the deposit; the amounts live in the ledger
    deposit_status: Mapped[str] = mapped_column(String, default="none", nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # reminder sent
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Hours(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "hours"
    __table_args__ = (
        enum_check("hours", "basis", "recurring", "date"),
        Index("ix_hours_staff", "business_id", "staff_id", "basis"),
    )

    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), nullable=False)
    basis: Mapped[str] = mapped_column(String, nullable=False)
    weekday: Mapped[int | None] = mapped_column(SmallInteger)  # 0..6 for recurring
    # explicit nullable: the attribute name `date` shadows the type and defeats inference
    date: Mapped[date | None] = mapped_column(Date, nullable=True)  # one-off
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)  # null = all-day
    available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String)


class Resource(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "resources"
    __table_args__ = (enum_check("resources", "category", "room", "equipment"),)

    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)


class Recurrence(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "recurrences"
    __table_args__ = (
        enum_check("recurrences", "frequency", "day", "week", "month"),
        enum_check("recurrences", "status", "active", "ended", "canceled"),
        Index("ix_recurrences_status", "business_id", "status"),
    )

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    frequency: Mapped[str] = mapped_column(String, nullable=False)
    interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    byday: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    count: Mapped[int | None] = mapped_column(Integer)
    until: Mapped[date | None] = mapped_column(Date)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)


class Addon(PKMixin, BusinessScoped, TimestampMixin, Base):
    """A product the client added to a visit when booking; it joins the visit's invoice."""

    __tablename__ = "addons"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_addons_quantity"),
        Index("ix_addons_booking", "business_id", "booking_id"),
    )

    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))  # copied for staff sync
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
