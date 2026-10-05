import re
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\Z")


class PublicBrand(BaseModel):
    """A business's validated public brand; unset or malformed fields are None."""

    logo_url: str | None = None
    primary: str | None = None
    tagline: str | None = None


class PublicService(BaseModel):
    id: str
    name: str
    description: str | None
    duration_min: int | None
    price_cents: int
    currency: str
    deposit_required: bool
    deposit_amount_cents: int
    image_url: str | None = None


class PublicStaff(BaseModel):
    id: str
    name: str | None
    title: str | None


class PublicAddon(BaseModel):
    id: str
    name: str
    price_cents: int
    currency: str
    image_url: str | None = None


class PublicAddonIn(BaseModel):
    item_id: str
    quantity: int = Field(default=1, ge=1, le=10)


class PublicBookingPage(BaseModel):
    business_name: str
    brand: PublicBrand
    services: list[PublicService]
    staff: list[PublicStaff]
    addons: list[PublicAddon] = Field(
        default_factory=list, description="Products a client can add to a visit"
    )
    stripe_account_id: str | None = Field(
        default=None, description="Connected account for Stripe Elements, once onboarded"
    )


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
    addons: list[PublicAddonIn] = Field(default_factory=list, max_length=10)


class PublicBookingResult(BaseModel):
    booking_id: str
    deposit_client_secret: str | None = None
    stripe_account_id: str | None = Field(
        default=None, description="Connected account for the deposit charge, once onboarded"
    )


# `\Z` rather than `$`, so a trailing newline can't pass.
class PublicShopItem(BaseModel):
    id: str
    name: str
    description: str | None
    price_cents: int
    currency: str
    image_url: str | None = None
    in_stock: bool = True


class PublicShop(BaseModel):
    business_name: str
    brand: PublicBrand
    items: list[PublicShopItem]
    stripe_account_id: str | None = None


class PublicShopLine(BaseModel):
    item_id: str
    quantity: int = Field(ge=1, le=20)


class PublicShopOrderCreate(BaseModel):
    client: PublicBookingClient
    lines: list[PublicShopLine] = Field(min_length=1, max_length=20)


class PublicShopOrderResult(BaseModel):
    order_id: str
    total_cents: int
    currency: str
    client_secret: str
    stripe_account_id: str
