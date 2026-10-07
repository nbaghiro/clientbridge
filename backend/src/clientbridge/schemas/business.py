from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clientbridge.schemas.public import HEX_COLOR

# An unknown province would silently collect no tax, so it is rejected with a 422.
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
    filing_frequency: str = "quarterly"
    brand: dict[str, object]


class BrandInput(BaseModel):
    """The public brand; values are validated and trimmed so clients can apply them directly."""

    logo_url: str | None = None
    logo_file_id: str | None = Field(
        default=None, description="An uploaded logo; used instead of logo_url on public pages"
    )
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
        if HEX_COLOR.match(v) is None:
            raise ValueError("colour must be a hex value like #3F5E80")
        return v

    @field_validator("tagline")
    @classmethod
    def _check_tagline(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class BusinessSettingsUpdate(BaseModel):
    """Partial update of account fields; tax numbers accept an empty string to clear."""

    name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    billing_email: str | None = None
    gst_hst_number: str | None = None
    qst_number: str | None = None
    filing_frequency: Literal["monthly", "quarterly", "annual"] | None = Field(
        default=None, description="How often the business files its sales-tax returns"
    )
    brand: BrandInput | None = None
