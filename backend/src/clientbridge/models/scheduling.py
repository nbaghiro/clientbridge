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
            "bookings",
            "status",
            "pending",
            "confirmed",
            "completed",
            "canceled",
            "no_show",
            "waitlisted",
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
    # the desk sale carrying this visit, and when it was paid (staff replicas have no ledger)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"))
    charged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # reminder sent
    # the client's link to view, move or cancel; the token is the only credential
    manage_token: Mapped[str | None] = mapped_column(String, unique=True)
    reschedule_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Hours(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "hours"
    __table_args__ = (
        enum_check("hours", "basis", "recurring", "date", "exception"),
        CheckConstraint(
            "basis != 'exception' OR (starts_at IS NOT NULL AND ends_at > starts_at)",
            name="ck_hours_exception_window",
        ),
        CheckConstraint("basis = 'exception' OR staff_id IS NOT NULL", name="ck_hours_staff"),
        CheckConstraint(
            "basis != 'recurring' OR "
            "(weekday IS NOT NULL AND weekday BETWEEN 0 AND 6 AND date IS NULL)",
            name="ck_hours_recurring_day",
        ),
        CheckConstraint(
            "basis != 'date' OR (date IS NOT NULL AND weekday IS NULL)",
            name="ck_hours_explicit_date",
        ),
        CheckConstraint(
            "(start_time IS NULL AND end_time IS NULL) OR "
            "(start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)",
            name="ck_hours_local_window",
        ),
        CheckConstraint(
            "basis = 'exception' OR (starts_at IS NULL AND ends_at IS NULL AND reason IS NULL)",
            name="ck_hours_exception_fields",
        ),
        Index("ix_hours_staff", "business_id", "staff_id", "basis"),
        Index("ix_hours_exception", "business_id", "basis", "starts_at"),
    )

    # null only on an exception: a closure of the whole business
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    basis: Mapped[str] = mapped_column(String, nullable=False)
    weekday: Mapped[int | None] = mapped_column(SmallInteger)  # 0..6 for recurring
    # explicit nullable: the attribute name `date` shadows the type and defeats inference
    date: Mapped[date | None] = mapped_column(Date, nullable=True)  # one-off
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)  # null = all-day
    available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # exception only
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(String)


class Resource(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "resources"
    __table_args__ = (
        enum_check("resources", "category", "room", "station", "equipment"),
        CheckConstraint("capacity > 0", name="ck_resources_capacity"),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    # an inactive room or station keeps its bookings and is offered for no new ones
    active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )


class Recurrence(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "recurrences"
    __table_args__ = (
        enum_check("recurrences", "frequency", "day", "week", "month"),
        enum_check("recurrences", "status", "active", "ended", "canceled"),
        enum_check("recurrences", "monthly_by", "date", "weekday"),
        Index("ix_recurrences_status", "business_id", "status"),
    )

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id"))
    frequency: Mapped[str] = mapped_column(String, nullable=False)
    interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    byday: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    # monthly series: the same date each month, or the same weekday (the 2nd Tuesday)
    monthly_by: Mapped[str] = mapped_column(
        String, default="date", server_default="date", nullable=False
    )
    count: Mapped[int | None] = mapped_column(Integer)
    until: Mapped[date | None] = mapped_column(Date)
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
