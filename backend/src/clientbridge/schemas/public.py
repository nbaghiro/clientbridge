import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# `\Z` rather than `$`, so a trailing newline can't pass.
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
    kind: str = "service"
    category: str | None = None
    color: str | None = None
    staff_ids: list[str] = Field(default_factory=list, description="Who can be booked for it")


class PublicStaff(BaseModel):
    id: str
    name: str | None
    title: str | None
    color: str | None = None


class PublicAddon(BaseModel):
    id: str
    name: str
    price_cents: int
    currency: str
    image_url: str | None = None
    description: str | None = None
    in_stock: bool = True
    addon_for: list[str] = Field(
        default_factory=list, description="Services it is offered with; empty means all"
    )


class PublicAddonIn(BaseModel):
    item_id: str
    quantity: int = Field(default=1, ge=1, le=10)


class PublicPolicy(BaseModel):
    self_service: bool
    cancel_cutoff_hours: int
    reschedule_cutoff_hours: int
    late_cancel_deposit: str
    max_reschedules: int


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
    slug: str = ""
    now: datetime | None = Field(default=None, description="The business's clock, in its zone")
    policy: PublicPolicy | None = None
    rating: float | None = Field(default=None, description="Average of published reviews")
    review_count: int = 0


class PublicSlot(BaseModel):
    starts_at: datetime
    ends_at: datetime
    staff_id: str | None = Field(default=None, description="Who the time is with")


class PublicSlots(BaseModel):
    slots: list[PublicSlot]


class PublicDay(BaseModel):
    date: date
    count: int = Field(description="Open start times that day")
    closed: bool = Field(description="The business is closed all day")
    reason: str | None = None


class PublicDays(BaseModel):
    days: list[PublicDay]


class ManagedAddon(BaseModel):
    name: str
    quantity: int
    unit_cents: int


class ManagedBooking(BaseModel):
    """A client's own booking, as their manage link shows it."""

    booking_id: str
    business_name: str
    brand: PublicBrand
    slug: str
    client_name: str
    pet_name: str | None
    service: PublicService
    staff: PublicStaff
    starts_at: datetime
    ends_at: datetime
    status: str
    deposit_cents: int
    deposit_status: str
    addons: list[ManagedAddon]
    reschedules_used: int
    policy: PublicPolicy
    now: datetime
    can_move: bool
    can_cancel: bool
    blocked: str | None = Field(default=None, description="Why a change is refused online")


class ManageReschedule(BaseModel):
    starts_at: datetime


class ManageCancelResult(BaseModel):
    deposit: Literal["refunded", "kept", "none"]
    refund_cents: int


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
    pet_name: str | None = Field(default=None, max_length=60)
    note: str | None = Field(default=None, max_length=1000)


class PublicBookingResult(BaseModel):
    booking_id: str
    status: str = "confirmed"
    manage_token: str | None = None
    deposit_cents: int = 0
    deposit_client_secret: str | None = None
    stripe_account_id: str | None = Field(
        default=None, description="Connected account for the deposit charge, once onboarded"
    )


class PublicShopItem(BaseModel):
    id: str
    name: str
    description: str | None
    price_cents: int
    currency: str
    image_url: str | None = None
    in_stock: bool = True
    category: str | None = None
    stock_left: int | None = Field(default=None, description="Null when stock isn't tracked")


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
