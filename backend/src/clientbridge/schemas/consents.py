from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBrand


class ConsentExport(BaseModel):
    filename: str
    content: str = Field(description="CSV: one row per consent record, newest last per client")


class PublicPreferences(BaseModel):
    business_name: str
    brand: PublicBrand
    first_name: str
    email_hint: str | None = Field(description="The address on file, partly hidden")
    phone_hint: str | None = Field(description="The last four digits of the number on file")
    email: bool = Field(description="Offers and news by email")
    sms: bool = Field(description="Offers and news by text")


class PublicPreferencesUpdate(BaseModel):
    email: bool
    sms: bool


class PublicUnsubscribe(BaseModel):
    channel: Literal["sms", "email"] | None = Field(
        default=None, description="One channel, or both when null"
    )
