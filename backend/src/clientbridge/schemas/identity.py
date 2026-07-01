from typing import Literal

from pydantic import BaseModel, ConfigDict

# The 13 Canadian provinces/territories — onboarding seeds per-code tax rates, so an unknown code
# can't be stored (it would silently get no GST/PST). Rejected at the boundary (422).
ProvinceCode = Literal["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]


class OnboardBody(BaseModel):
    name: str
    slug: str
    province: ProvinceCode
    timezone: str | None = None
    locale: str = "en"


class BusinessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    province: str | None
    timezone: str
    locale: str
    status: str
    billing_email: str | None
    gst_hst_number: str | None
    qst_number: str | None


class BusinessSettingsUpdate(BaseModel):
    """Editable account fields (partial — only sent keys are applied). Slug + province are fixed
    here (province drives seeded tax rates); the tax numbers accept "" to clear."""

    name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    billing_email: str | None = None
    gst_hst_number: str | None = None
    qst_number: str | None = None


class InviteBody(BaseModel):
    email: str
    role: str = "staff"


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invite_token: str  # raw token, returned once to the inviter (also emailed)
