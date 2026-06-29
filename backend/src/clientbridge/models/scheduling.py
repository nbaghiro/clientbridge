from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
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


class Session(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "sessions"
    __table_args__ = (
        enum_check("sessions", "status", "scheduled", "canceled", "completed"),
        Index("ix_sessions_staff_start", "business_id", "staff_id", "starts_at"),
        Index("ix_sessions_business_start", "business_id", "starts_at"),
    )

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), nullable=False)
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(ForeignKey("resources.id"))
    recurrence_id: Mapped[str | None] = mapped_column(ForeignKey("schedules.id"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    booked_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="scheduled", nullable=False)


class Booking(PKMixin, BusinessScoped, TimestampMixin, SoftDelete, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        enum_check(
            "bookings", "status", "pending", "confirmed", "completed", "canceled", "no_show"
        ),
        enum_check("bookings", "source", "online", "manual"),
        Index("ix_bookings_session", "business_id", "session_id"),
        Index("ix_bookings_client", "business_id", "client_id"),
        Index("ix_bookings_status", "business_id", "status"),
        Index("ix_bookings_staff", "business_id", "staff_id"),
    )

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    # Denormalized from the session's staff — lets per-staff sync rules slice bookings directly.
    staff_id: Mapped[str | None] = mapped_column(ForeignKey("staff.id"))
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id"), nullable=False)
    subject_id: Mapped[str | None] = mapped_column(ForeignKey("subjects.id"))
    package_id: Mapped[str | None] = mapped_column(ForeignKey("packages.id"))
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"))
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    source: Mapped[str] = mapped_column(String, default="manual", nullable=False)
    price_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    deposit_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deposit_amount_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # reminder sent
    custom_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)


class Availability(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "availability"
    __table_args__ = (
        enum_check("availability", "type", "recurring", "date"),
        Index("ix_availability_staff", "business_id", "staff_id", "type"),
    )

    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    weekday: Mapped[int | None] = mapped_column(SmallInteger)  # 0..6 for recurring
    # nullable=True is explicit: the attribute name `date` shadows the `date` type, which defeats
    # SQLAlchemy's Optional/nullable inference.
    date: Mapped[date | None] = mapped_column(Date, nullable=True)  # one-off
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)  # null = all-day
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String)


class Resource(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "resources"
    __table_args__ = (enum_check("resources", "kind", "room", "equipment"),)

    name: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)


class Schedule(PKMixin, BusinessScoped, TimestampMixin, Base):
    __tablename__ = "schedules"
    __table_args__ = (
        enum_check("schedules", "frequency", "daily", "weekly", "monthly"),
        enum_check("schedules", "status", "active", "ended", "canceled"),
        Index("ix_schedules_status", "business_id", "status"),
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
