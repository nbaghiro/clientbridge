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
    note: str | None = Field(default=None, max_length=2000, description="Kept as a booking note")
    notify: bool = Field(default=True, description="Send the client a confirmation")


class BookingMove(BaseModel):
    starts_at: datetime | None = None
    ends_at: datetime | None = Field(default=None, description="A new end resizes the visit")
    staff_id: str | None = Field(default=None, description="Moves the visit to another member")
    resource_id: str | None = Field(default=None, description="Room or station; set to change it")


class BookingPatch(BookingMove):
    status: Literal["confirmed", "completed", "canceled", "no_show"] | None = None


class BookingProbe(BaseModel):
    item_id: str
    staff_id: str
    starts_at: datetime
    resource_id: str | None = None


Problem = Literal["past", "closed", "time_off", "off_hours", "overlap", "resource", "class"]


class BookingCheck(BaseModel):
    """The server's verdict on a time before it is booked or moved; nothing is written."""

    ok: bool
    problem: Problem | None = None
    reason: str | None = Field(default=None, description="The closure or time-off reason")
    message: str | None = None


class TimeOffCreate(BaseModel):
    staff_id: str | None = Field(default=None, description="Null closes the whole business")
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=1, max_length=120)


class TimeOffOut(BaseModel):
    id: str
    business_id: str
    staff_id: str | None
    starts_at: datetime
    ends_at: datetime
    reason: str
    affected: list[str] = Field(description="Live bookings inside the window, still to move")


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
