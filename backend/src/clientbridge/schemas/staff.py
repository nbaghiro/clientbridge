from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.business import RateType, Staff, StaffRole, StaffStatus
from clientbridge.schemas.bookings import Problem

MemberRole = Literal["admin", "staff", "contractor"]


class InviteBody(Mirror):
    mirrors = Staff

    email: str
    role: MemberRole = "staff"


class InviteOut(Mirror):
    mirrors = Staff

    id: str
    email: str
    role: MemberRole
    status: StaffStatus
    invite_token: str = Field(description="Raw invite token, returned once and also emailed")


class InviteTokenBody(BaseModel):
    """The invite token travels in a body, never a URL that logs or referrers could keep."""

    token: str


class AcceptInviteOut(BaseModel):
    business_id: str
    staff_id: str


class InvitePreviewOut(Mirror):
    mirrors = Staff

    business_name: str
    email: str
    role: StaffRole
    expires_at: datetime


class StaffPayUpdate(Mirror):
    mirrors = Staff

    payee: bool | None = None
    rate_type: RateType | None = None
    rate_bps: int | None = Field(default=None, ge=0, description="Percent rate in basis points")
    rate_cents: int | None = Field(default=None, ge=0, description="Fixed or hourly rate")
    retail_rate_bps: int | None = Field(
        default=None, ge=0, le=10000, description="Commission on product sales in basis points"
    )


class StaffPayOut(Mirror):
    mirrors = Staff
    model_config = ConfigDict(from_attributes=True)

    id: str
    payee: bool
    rate_type: RateType | None
    rate_bps: int | None
    rate_cents: int | None
    retail_rate_bps: int | None


class RoleUpdate(Mirror):
    mirrors = Staff

    role: MemberRole


class TeamMember(Mirror):
    mirrors = Staff

    id: str
    name: str | None
    email: str | None
    role: StaffRole
    status: StaffStatus
    last_active_at: datetime | None = Field(
        description="When the member was last seen using the app (to within five minutes)"
    )
    invited_at: datetime | None
    invited_by_name: str | None
    expires_at: datetime | None = Field(description="When a pending invite stops working")


class TeamOut(BaseModel):
    members: list[TeamMember]
    invites: list[TeamMember]


FutureChoice = Literal["reassign", "cancel"]


class StaffRemove(BaseModel):
    future: FutureChoice | None = Field(
        default=None, description="What happens to the member's future visits and series"
    )
    reassign_to: str | None = Field(
        default=None, description='A member id, or "any" for the first member free at each time'
    )


class FutureVisit(BaseModel):
    booking_id: str
    starts_at: datetime
    client_id: str
    recurrence_id: str | None


class FutureWork(BaseModel):
    """The future visits and active series a removal must reassign or cancel first."""

    visits: list[FutureVisit]
    series: list[str]


class LeftVisit(BaseModel):
    booking_id: str
    starts_at: datetime
    problem: Problem | None
    message: str | None


class MovedSeries(BaseModel):
    recurrence_id: str
    staff_id: str


class StaffRemoveOut(BaseModel):
    moved: list[str]
    canceled: list[str]
    left: list[LeftVisit] = Field(description="Visits no member could take, left in place")
    series_moved: list[MovedSeries]
    series_ended: list[str]
