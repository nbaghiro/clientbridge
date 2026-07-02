import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

# The 13 Canadian provinces/territories — tax rates are derived per province, so an unknown code
# would silently collect no tax. Rejected at the boundary (422).
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
    brand: dict[str, object]


class BrandInput(BaseModel):
    """The public-facing brand a business sets on its Connect surfaces. Values are validated +
    trimmed here (empty → cleared) so what's stored is what the customer client applies directly."""

    logo_url: str | None = None
    primary: str | None = None
    tagline: str | None = None

    @field_validator("logo_url")
    @classmethod
    def _check_logo(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if v == "":
            return None
        if not v.startswith(("http://", "https://")):
            raise ValueError("logo URL must start with http:// or https://")
        return v

    @field_validator("primary")
    @classmethod
    def _check_primary(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if v == "":
            return None
        if _HEX.match(v) is None:
            raise ValueError("colour must be a hex value like #3F5E80")
        return v

    @field_validator("tagline")
    @classmethod
    def _check_tagline(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class BusinessSettingsUpdate(BaseModel):
    """Editable account fields (partial — only sent keys are applied). Slug + province are fixed
    here (province drives the derived tax rates); the tax numbers accept "" to clear."""

    name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    billing_email: str | None = None
    gst_hst_number: str | None = None
    qst_number: str | None = None
    brand: BrandInput | None = None


class InviteBody(BaseModel):
    email: str
    role: str = "staff"


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invite_token: str  # raw token, returned once to the inviter (also emailed)
