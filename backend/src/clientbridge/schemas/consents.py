from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBrand


class ConsentExport(BaseModel):
    filename: str
    content: str = Field(description="CSV: one row per consent record, newest last per client")


class PublicPreferences(BaseModel):
    business_name: str
    brand: PublicBrand
    first_name: str
    phone_hint: str | None = Field(description="The last four digits of the number on file")
    sms: bool = Field(description="Offers and news by text")


class PublicPreferencesUpdate(BaseModel):
    sms: bool
