from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class InviteBody(BaseModel):
    email: str
    role: str = "staff"


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invite_token: str  # raw token, returned once to the inviter (also emailed)


class StaffPayUpdate(BaseModel):
    payee: bool | None = None
    rate_type: Literal["percent", "fixed", "hourly"] | None = None
    rate_bps: int | None = Field(default=None, ge=0)  # a percent rate, in basis points
    rate_cents: int | None = Field(default=None, ge=0)  # a fixed or hourly rate
    retail_rate_bps: int | None = Field(default=None, ge=0, le=10000)  # commission on products


class StaffPayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    payee: bool
    rate_type: str | None
    rate_bps: int | None
    rate_cents: int | None
    retail_rate_bps: int | None
