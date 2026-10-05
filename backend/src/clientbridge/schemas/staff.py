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
    invite_token: str = Field(description="Raw invite token, returned once and also emailed")


class StaffPayUpdate(BaseModel):
    payee: bool | None = None
    rate_type: Literal["percent", "fixed", "hourly"] | None = None
    rate_bps: int | None = Field(default=None, ge=0, description="Percent rate in basis points")
    rate_cents: int | None = Field(default=None, ge=0, description="Fixed or hourly rate")
    retail_rate_bps: int | None = Field(
        default=None, ge=0, le=10000, description="Commission on product sales in basis points"
    )


class StaffPayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    payee: bool
    rate_type: str | None
    rate_bps: int | None
    rate_cents: int | None
    retail_rate_bps: int | None
