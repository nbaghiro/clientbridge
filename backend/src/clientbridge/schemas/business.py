import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clientbridge.schemas.public import HEX_COLOR

# An unknown province would silently collect no tax, so it is rejected with a 422.
ProvinceCode = Literal["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]
FilingFrequency = Literal["monthly", "quarterly", "annual"]

# CRA business number + RT program account, Revenu Quebec TQ account, BC PST registration.
GST_HST_NUMBER = re.compile(r"^\d{9}RT\d{4}$")
QST_NUMBER = re.compile(r"^\d{10}TQ\d{4}$")
PST_NUMBER = re.compile(r"^(PST)?\d{4}\d{4}$")


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
    pst_number: str | None
    tax_registered: bool
    filing_frequency: str = "quarterly"
    setup_dismissed_at: datetime | None
    review_hold_at: int
    google_review_url: str | None
    brand: dict[str, object]


class BrandInput(BaseModel):
    """The public brand; values are validated and trimmed so clients can apply them directly."""

    logo_url: str | None = None
    logo_file_id: str | None = Field(
        default=None, description="An uploaded logo; used instead of logo_url on public pages"
    )
    avatar_file_id: str | None = None
    primary: str | None = None
    tagline: str | None = None
    cover_url: str | None = Field(default=None, max_length=2048)
    about: str | None = Field(default=None, max_length=3000)
    address: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=254)
    website: str | None = Field(default=None, max_length=2048)
    neighbourhood: str | None = Field(default=None, max_length=100)
    gallery_urls: list[str] = Field(default_factory=list, max_length=12)
    pickup_prep_minutes: int = Field(default=60, ge=0, le=10080)
    pickup_hold_days: int = Field(default=3, ge=1, le=30)
    pickup_capacity: int = Field(default=10, ge=1, le=100)
    public_staff_ids: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("cover_url", "website")
    @classmethod
    def _check_public_url(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if len(value) > 2048:
            raise ValueError("URL must be at most 2048 characters")
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username:
            raise ValueError("URL must be an http or https address")
        return value

    @field_validator("gallery_urls")
    @classmethod
    def _check_gallery(cls, values: list[str]) -> list[str]:
        return [url for value in values if (url := cls._check_public_url(value))]

    @field_validator("about", "address", "phone", "neighbourhood")
    @classmethod
    def _trim_public_text(cls, value: str | None) -> str | None:
        return (value or "").strip() or None

    @field_validator("email")
    @classmethod
    def _check_public_email(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if value and ("@" not in value or any(c.isspace() for c in value)):
            raise ValueError("email must be a valid email address")
        return value or None

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
    pst_number: str | None = None
    tax_registered: bool | None = None
    filing_frequency: FilingFrequency | None = Field(
        default=None, description="How often the business files its sales-tax returns"
    )
    setup_dismissed: bool | None = Field(
        default=None, description="Hide (true) or show (false) the Get set up list"
    )
    review_hold_at: int | None = Field(
        default=None, ge=0, le=5, description="Hold reviews rated at or below this; 0 holds none"
    )
    google_review_url: str | None = Field(
        default=None, description="The Google review link shared after a good review; empty clears"
    )
    brand: BrandInput | None = None

    @field_validator("google_review_url")
    @classmethod
    def _check_google(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if v != "" and not v.startswith("https://"):
            raise ValueError("the review link must start with https://")
        return v

    @staticmethod
    def _tax_number(v: str | None, pattern: re.Pattern[str], example: str) -> str | None:
        if v is None:
            return None
        compact = re.sub(r"[\s-]", "", v).upper()
        if compact == "":
            return ""
        if pattern.match(compact) is None:
            raise ValueError(f"enter the number like {example}")
        return compact

    @field_validator("gst_hst_number")
    @classmethod
    def _check_gst(cls, v: str | None) -> str | None:
        return cls._tax_number(v, GST_HST_NUMBER, "123456789RT0001")

    @field_validator("qst_number")
    @classmethod
    def _check_qst(cls, v: str | None) -> str | None:
        return cls._tax_number(v, QST_NUMBER, "1234567890TQ0001")

    @field_validator("pst_number")
    @classmethod
    def _check_pst(cls, v: str | None) -> str | None:
        return cls._tax_number(v, PST_NUMBER, "PST-1234-5678")
