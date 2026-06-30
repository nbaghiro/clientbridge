from datetime import datetime

from pydantic import BaseModel, model_validator


class PublicService(BaseModel):
    id: str
    name: str
    description: str | None
    duration_min: int | None
    price_cents: int
    currency: str
    deposit_required: bool
    deposit_amount_cents: int


class PublicStaff(BaseModel):
    id: str
    name: str | None
    title: str | None


class PublicBookingPage(BaseModel):
    business_name: str
    services: list[PublicService]
    staff: list[PublicStaff]
    stripe_account_id: str | None = None  # connected account to mount Elements, when onboarded


class PublicSlot(BaseModel):
    starts_at: datetime
    ends_at: datetime


class PublicSlots(BaseModel):
    slots: list[PublicSlot]


class PublicBookingClient(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None

    @model_validator(mode="after")
    def _contactable(self) -> "PublicBookingClient":
        if not self.email and not self.phone:
            raise ValueError("provide an email or phone")
        return self


class PublicBookingCreate(BaseModel):
    item_id: str
    staff_id: str
    starts_at: datetime
    client: PublicBookingClient


class PublicBookingResult(BaseModel):
    booking_id: str
    deposit_client_secret: str | None = None
    stripe_account_id: str | None = None  # connected account for the deposit charge, when onboarded
