from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


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
    slot_id: str
    client_id: str
    staff_id: str | None
    item_id: str
    status: str
    source: str
    price_cents: int
    deposit_amount_cents: int
    deposit_status: str
    checked_in_at: datetime | None
    starts_at: datetime
    ends_at: datetime


class DepositOut(BaseModel):
    booking_id: str
    payment_id: str
    client_secret: str


class RecurrenceCreate(BaseModel):
    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime = Field(description="First occurrence; its local time repeats")
    frequency: Literal["day", "week", "month"]
    interval: int = 1
    byday: list[Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]] | None = Field(
        default=None, description="Weekdays, for weekly series only"
    )
    count: int | None = Field(default=None, description="End after this many; set count or until")
    until: date | None = Field(default=None, description="End on this date; set count or until")
    resource_id: str | None = None
    subject_id: str | None = None


class RecurrenceOccurrence(BaseModel):
    starts_at: datetime
    booking_id: str | None = Field(description="Null when the occurrence was skipped")
    skipped: str | None = Field(description="Why the occurrence was skipped")


class RecurrenceOut(BaseModel):
    id: str
    business_id: str
    item_id: str
    staff_id: str | None
    client_id: str | None
    frequency: str
    interval: int
    status: str
    created: int = Field(description="Occurrences that became bookings")
    skipped: int = Field(description="Occurrences skipped for a clash or outside hours")
    occurrences: list[RecurrenceOccurrence]
