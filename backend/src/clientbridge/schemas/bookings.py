from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class BookingCreate(BaseModel):
    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime
    resource_id: str | None = None
    subject_id: str | None = None


class BookingPatch(BaseModel):
    starts_at: datetime | None = None
    status: Literal["confirmed", "completed", "canceled", "no_show"] | None = None


class BookingOut(BaseModel):
    id: str
    business_id: str
    session_id: str
    client_id: str
    staff_id: str | None
    item_id: str
    status: str
    source: str
    price_cents: int
    deposit_amount_cents: int
    deposit_status: str
    starts_at: datetime
    ends_at: datetime


class DepositOut(BaseModel):
    booking_id: str
    payment_id: str
    client_secret: str


class ScheduleCreate(BaseModel):
    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime  # first occurrence; its time-of-day repeats across the series
    frequency: Literal["daily", "weekly", "monthly"]
    interval: int = 1
    byday: list[Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]] | None = None  # weekly only
    count: int | None = None  # end after N occurrences (set count or until)
    until: date | None = None  # end on/before this date (set count or until)
    resource_id: str | None = None
    subject_id: str | None = None


class ScheduleOccurrence(BaseModel):
    starts_at: datetime
    booking_id: str | None  # None when the occurrence was skipped
    skipped: str | None  # reason (outside hours / overlap) when not booked


class ScheduleOut(BaseModel):
    id: str
    business_id: str
    item_id: str
    staff_id: str | None
    client_id: str | None
    frequency: str
    interval: int
    status: str
    created: int  # occurrences that became bookings
    skipped: int  # occurrences skipped (conflict / outside hours)
    occurrences: list[ScheduleOccurrence]
