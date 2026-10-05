from datetime import datetime

from pydantic import BaseModel, Field


class GiftCardPurchase(BaseModel):
    item_id: str | None = None
    amount_cents: int | None = Field(default=None, gt=0)
    recipient: str | None = None
    purchaser_client_id: str | None = None
    payment_method_id: str | None = None


class GiftCardPurchaseOut(BaseModel):
    gift_card_id: str
    code: str
    payment_id: str
    client_secret: str


class GiftCardRedeem(BaseModel):
    code: str = Field(min_length=1)
    amount_cents: int


class GiftCardOut(BaseModel):
    id: str
    code: str
    initial_cents: int
    balance_cents: int
    status: str


class PackagePurchase(BaseModel):
    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    payment_method_id: str | None = None


class PackagePurchaseOut(BaseModel):
    package_id: str
    payment_id: str
    client_secret: str


class PackageOut(BaseModel):
    id: str
    client_id: str
    item_id: str
    sessions_total: int
    sessions_used: int
    status: str


class SubscriptionCreate(BaseModel):
    client_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    payment_method_id: str = Field(min_length=1)


class SubscriptionOut(BaseModel):
    id: str
    client_id: str
    item_id: str
    status: str
    current_period_start: datetime | None
    current_period_end: datetime | None
