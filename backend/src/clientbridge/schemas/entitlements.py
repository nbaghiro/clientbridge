from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.catalog import (
    GiftCard,
    Package,
    PackageStatus,
    Subscription,
    SubscriptionStatus,
)


class GiftCardPurchase(Mirror):
    mirrors = GiftCard

    item_id: str | None = None
    amount_cents: int | None = Field(default=None, gt=0)
    recipient: str | None = None
    purchaser_client_id: str | None = None
    payment_method_id: str | None = None
    cash: bool = Field(default=False, description="Paid in cash at the desk; recorded, not charged")


class GiftCardPurchaseOut(BaseModel):
    gift_card_id: str
    code: str
    payment_id: str
    client_secret: str | None = Field(description="Null when paid in cash")


class GiftCardRedeem(BaseModel):
    code: str = Field(min_length=1)
    amount_cents: int


class GiftCardOut(Mirror):
    mirrors = GiftCard
    derived = frozenset({"status"})

    id: str
    code: str
    initial_cents: int
    balance_cents: int
    status: str


class PackagePurchase(Mirror):
    mirrors = Package

    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    payment_method_id: str | None = None
    cash: bool = Field(default=False, description="Paid in cash at the desk; recorded, not charged")


class PackagePurchaseOut(BaseModel):
    package_id: str
    payment_id: str
    client_secret: str | None = Field(description="Null when paid in cash")


class PackageOut(Mirror):
    mirrors = Package

    id: str
    client_id: str
    item_id: str
    sessions_total: int
    sessions_used: int
    status: PackageStatus


class SubscriptionCreate(Mirror):
    mirrors = Subscription

    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    payment_method_id: str = Field(min_length=1)


class SubscriptionOut(Mirror):
    mirrors = Subscription

    id: str
    client_id: str
    item_id: str
    status: SubscriptionStatus
    current_period_start: datetime | None
    current_period_end: datetime | None
