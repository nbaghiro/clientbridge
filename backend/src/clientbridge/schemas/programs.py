from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from clientbridge.core.mirrors import Mirror
from clientbridge.models.scheduling import Recurrence, RecurrenceStatus, Slot, Weekday


class ProgramCreate(Mirror):
    """A class's sessions laid out ahead of any booking, on set weekdays at one local time."""

    mirrors = Recurrence

    item_id: str
    staff_id: str
    starts_at: datetime = Field(description="The first session; its local time repeats")
    byday: list[Weekday] = Field(min_length=1, max_length=7)
    count: int | None = Field(default=None, ge=1, description="Sessions in all; set count or until")
    until: date | None = Field(default=None, description="The last day; set count or until")

    @model_validator(mode="after")
    def _has_an_end(self) -> "ProgramCreate":
        if self.count is None and self.until is None:
            raise ValueError("a schedule needs an end: set count or until")
        return self


class ProgramSession(Mirror):
    mirrors = Slot

    slot_id: str
    starts_at: datetime
    ends_at: datetime
    capacity: int


class ProgramOut(Mirror):
    mirrors = Recurrence

    id: str
    business_id: str
    item_id: str
    staff_id: str | None
    status: RecurrenceStatus
    sessions: list[ProgramSession]


class ProgramCancelOut(Mirror):
    mirrors = Recurrence

    id: str
    status: RecurrenceStatus
    canceled: list[str] = Field(description="The sessions called off")


class EnrolmentCreate(BaseModel):
    client_id: str
    subject_id: str | None = None
    notify: bool = Field(default=True, description="Send the client one message with every day")


class EnrolmentCancel(BaseModel):
    client_id: str
    subject_id: str | None = None
    notify: bool = True


class EnrolmentOut(BaseModel):
    """A client's (and subject's) bookings on a program schedule, the first carrying the price."""

    program_id: str
    client_id: str
    subject_id: str | None
    booking_ids: list[str]


class EnrolmentCancelOut(BaseModel):
    program_id: str
    canceled: list[str]
    refunded_cents: int = Field(description="The deposit refunded with the enrolment")
