from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class RecurrenceOccurrence(BaseModel):
    starts_at: datetime
    booking_id: str | None = Field(description="Null when the occurrence was skipped")
    skipped: str | None = Field(description="Why the occurrence was skipped")


class RecurrenceException(BaseModel):
    """One date of a new series handled apart: left out, or booked at another time."""

    date: date
    action: Literal["skip", "shift"]
    starts_at: datetime | None = Field(default=None, description="The new start for a shift")

    @model_validator(mode="after")
    def _shift_has_a_time(self) -> "RecurrenceException":
        if self.action == "shift" and self.starts_at is None:
            raise ValueError("a shifted date needs its new start")
        return self


class RecurrenceCreate(BaseModel):
    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime = Field(description="First occurrence; its local time repeats")
    frequency: Literal["day", "week", "month"]
    interval: int = Field(default=1, ge=1, le=52)
    byday: list[Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]] | None = Field(
        default=None, description="Weekdays, for weekly series only"
    )
    monthly_by: Literal["date", "weekday"] = Field(
        default="date", description="Monthly on the same date, or the same weekday (2nd Tuesday)"
    )
    count: int | None = Field(default=None, description="End after this many; set count or until")
    until: date | None = Field(default=None, description="End on this date; set count or until")
    resource_id: str | None = None
    subject_id: str | None = None
    exceptions: list[RecurrenceException] = Field(default_factory=list, max_length=60)
    confirmation: Literal["series", "each", "none"] = Field(
        default="series", description="One message listing every date, one per visit, or none"
    )


class RecurrenceChange(BaseModel):
    """Moves the upcoming visits of a series to another weekday, time or member."""

    model_config = ConfigDict(populate_by_name=True)

    scope: Literal["one", "following", "all"]
    from_date: date | None = Field(
        default=None, alias="from", description="The visit a one or following change starts at"
    )
    weekday: int | None = Field(default=None, ge=0, le=6, description="Monday is 0")
    time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    staff_id: str | None = None
    notify: bool = True


class RecurrenceChangeOut(BaseModel):
    id: str
    moved: list[str] = Field(description="Bookings that moved")
    skipped: list[RecurrenceOccurrence] = Field(description="Visits left in place, with why")


class RecurrenceCancel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_date: date | None = Field(
        default=None, alias="from", description="Cancel visits on and after this date"
    )
    notify: bool = True


class RecurrenceCancelOut(BaseModel):
    id: str
    status: str
    canceled: list[str]
    refunded_cents: int = Field(description="Deposits refunded for the canceled visits")


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


class RosterAdd(BaseModel):
    client_id: str
    subject_id: str | None = None


class RosterAction(BaseModel):
    action: Literal["check_in", "undo", "no_show", "promote"]


class RosterEntry(BaseModel):
    booking_id: str
    slot_id: str
    client_id: str
    subject_id: str | None
    status: str
    checked_in_at: datetime | None
    waitlist_position: int | None = Field(description="1 is offered the next free seat")


class ClassMessage(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class ClassMessageOut(BaseModel):
    sent: int = Field(description="Clients the message went to")
