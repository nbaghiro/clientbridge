from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.business import RateType, Staff, StaffRole, StaffStatus

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
        description="When the member last signed in or refreshed a session"
    )
    invited_at: datetime | None
    invited_by_name: str | None
    expires_at: datetime | None = Field(description="When a pending invite stops working")


class TeamOut(BaseModel):
    members: list[TeamMember]
    invites: list[TeamMember]
