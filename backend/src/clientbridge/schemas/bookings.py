from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from clientbridge.core.mirrors import Mirror
from clientbridge.models.business import Staff
from clientbridge.models.catalog import DepositType, Item, ItemKind
from clientbridge.models.scheduling import (
    Booking,
    BookingSource,
    BookingStatus,
    DepositStatus,
    Hours,
    MonthlyBy,
    Recurrence,
    RecurrenceFrequency,
    RecurrenceStatus,
    Weekday,
)


class BookingCreate(Mirror):
    mirrors = Booking

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


class BookingPatch(BookingMove, Mirror):
    mirrors = Booking

    status: Literal["confirmed", "completed", "canceled", "no_show"] | None = None


LateCancelDeposit = Literal["keep", "refund"]
Problem = Literal["past", "closed", "time_off", "off_hours", "overlap", "resource", "class"]


class BookingCheck(BaseModel):
    """The server's verdict on a time before it is booked or moved; nothing is written."""

    ok: bool
    problem: Problem | None = None
    reason: str | None = Field(default=None, description="The closure or time-off reason")
    message: str | None = None


class ReminderPreview(BaseModel):
    """The reminder a visit gets, word for word, and when the job sends it."""

    subject: str
    body: str
    sends_at: datetime = Field(description="24 hours before the visit")
    sent_at: datetime | None


class TimeOffCreate(Mirror):
    mirrors = Hours

    staff_id: str | None = Field(default=None, description="Null closes the whole business")
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=1, max_length=120)


class TimeOffOut(Mirror):
    mirrors = Hours

    id: str
    business_id: str
    staff_id: str | None
    starts_at: datetime
    ends_at: datetime
    reason: str
    affected: list[str] = Field(description="Live bookings inside the window, still to move")


class BookingOut(Mirror):
    mirrors = Booking

    id: str
    business_id: str
    slot_id: str
    client_id: str
    staff_id: str | None
    item_id: str
    status: BookingStatus
    source: BookingSource
    price_cents: int
    deposit_amount_cents: int
    deposit_status: DepositStatus
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


class RecurrenceCreate(Mirror):
    mirrors = Recurrence

    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime = Field(description="First occurrence; its local time repeats")
    frequency: RecurrenceFrequency
    interval: int = Field(default=1, ge=1, le=52)
    byday: list[Weekday] | None = Field(
        default=None, description="Weekdays, for weekly series only"
    )
    monthly_by: MonthlyBy = Field(
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


class RecurrenceCancelOut(Mirror):
    mirrors = Recurrence

    id: str
    status: RecurrenceStatus
    canceled: list[str]
    refunded_cents: int = Field(description="Deposits refunded for the canceled visits")


class RecurrenceOut(Mirror):
    mirrors = Recurrence

    id: str
    business_id: str
    item_id: str
    staff_id: str | None
    client_id: str | None
    frequency: RecurrenceFrequency
    interval: int
    status: RecurrenceStatus
    created: int = Field(description="Occurrences that became bookings")
    skipped: int = Field(description="Occurrences skipped for a clash or outside hours")
    occurrences: list[RecurrenceOccurrence]


class RosterAdd(BaseModel):
    client_id: str
    subject_id: str | None = None


class RosterAction(BaseModel):
    action: Literal["check_in", "undo", "no_show", "promote"]


class RosterEntry(Mirror):
    mirrors = Booking

    booking_id: str
    slot_id: str
    client_id: str
    subject_id: str | None
    status: BookingStatus
    checked_in_at: datetime | None
    waitlist_position: int | None = Field(description="1 is offered the next free seat")


class ClassMessage(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class ClassMessageOut(BaseModel):
    sent: int = Field(description="Clients the message went to")


class BookingPolicy(BaseModel):
    """The online booking rules and the cancellation policy clients' manage links follow."""

    lead_hours: int = Field(default=0, ge=0, le=168, description="Earliest a visit can be booked")
    horizon_days: int = Field(default=365, ge=1, le=365, description="Furthest ahead")
    step_min: Literal[15, 30, 60] | None = Field(
        default=None, description="Start times every N minutes; none follows the service length"
    )
    approve_new_clients: bool = Field(
        default=False, description="A first booking waits as pending until staff confirm it"
    )
    self_service: bool = Field(default=True, description="Clients may move or cancel online")
    cancel_cutoff_hours: int = Field(default=24, ge=0, le=168)
    reschedule_cutoff_hours: int = Field(default=24, ge=0, le=168)
    late_cancel_deposit: LateCancelDeposit = "keep"
    max_reschedules: int = Field(default=2, ge=1, le=99)


class BookingPolicyPatch(BaseModel):
    lead_hours: int | None = Field(default=None, ge=0, le=168)
    horizon_days: int | None = Field(default=None, ge=1, le=365)
    step_min: Literal[15, 30, 60, 0] | None = Field(
        default=None, description="0 follows the service length again"
    )
    approve_new_clients: bool | None = None
    self_service: bool | None = None
    cancel_cutoff_hours: int | None = Field(default=None, ge=0, le=168)
    reschedule_cutoff_hours: int | None = Field(default=None, ge=0, le=168)
    late_cancel_deposit: LateCancelDeposit | None = None
    max_reschedules: int | None = Field(default=None, ge=1, le=99)


class OnlineService(Mirror):
    mirrors = Item

    id: str
    name: str
    kind: ItemKind
    duration_min: int | None
    price_cents: int
    color: str | None
    deposit_type: DepositType
    deposit_cents: int
    online_bookable: bool


class OnlineStaff(Mirror):
    mirrors = Staff

    id: str
    name: str | None
    title: str | None
    color: str | None
    bookable_online: bool


class OnlineBookingOut(BaseModel):
    slug: str
    business_name: str
    policy: BookingPolicy
    services: list[OnlineService]
    staff: list[OnlineStaff]
    online_30d: int = Field(description="Bookings made online in the last 30 days")
    deposits_30d_cents: int = Field(description="Deposits on those bookings")


class OnlineBookingPatch(BaseModel):
    policy: BookingPolicyPatch | None = None
    services: dict[str, bool] | None = Field(default=None, description="Service id: bookable")
    staff: dict[str, bool] | None = Field(default=None, description="Member id: shown online")


class AddonOffer(Mirror):
    mirrors = Item

    id: str
    addon: bool
    addon_for: list[str] = Field(default_factory=list, max_length=100)


class AddonOffersPatch(BaseModel):
    offers: list[AddonOffer] = Field(min_length=1, max_length=200)


class AddonOffersOut(BaseModel):
    offers: list[AddonOffer]
