from datetime import time
from typing import Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

from clientbridge.core.mirrors import Mirror
from clientbridge.models.scheduling import Hours
from clientbridge.schemas.receipts import OperationIdentity


class WeekDay(Mirror):
    mirrors = Hours
    model_config = ConfigDict(extra="forbid")
    weekday: StrictInt = Field(ge=0, le=6)
    available: StrictBool
    start_time: time | None = None
    end_time: time | None = None

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def wall_time(cls, value: object) -> object:
        if value is not None and not isinstance(value, (str, time)):
            raise ValueError("time must be a local clock time")
        return value

    @model_validator(mode="after")
    def valid_window(self) -> Self:
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("both window boundaries are required")
        if self.start_time is not None and self.end_time is not None:
            if self.start_time.tzinfo is not None or self.end_time.tzinfo is not None:
                raise ValueError("hours use local clock times without a timezone")
            if self.end_time <= self.start_time:
                raise ValueError("end_time must be after start_time")
        return self


class HoursWeekBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request: OperationIdentity
    expected_revision: StrictInt = Field(ge=0, le=9007199254740990)
    days: list[WeekDay] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def complete_week(self) -> Self:
        if {day.weekday for day in self.days} != set(range(7)):
            raise ValueError("exactly one entry is required for every weekday")
        return self


class HoursWeekResult(BaseModel):
    revision: int


class HoursWeekOut(HoursWeekResult):
    staff_id: str
    days: list[WeekDay]
