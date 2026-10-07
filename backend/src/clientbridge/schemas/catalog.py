from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clientbridge.schemas.billing import TaxClass

ItemKind = Literal["service", "class", "product", "package", "subscription", "gift"]
DepositType = Literal["none", "fixed", "percent"]
GiftAmount = Annotated[int, Field(gt=0)]
Frequency = Literal["day", "week", "month", "year"]


class ItemBase(BaseModel):
    kind: ItemKind = "service"
    name: str = Field(min_length=1)
    description: str | None = None
    price_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="CAD", pattern="^[A-Z]{3}$")
    duration_min: int | None = Field(default=None, ge=0)
    capacity: int | None = Field(default=None, ge=0)
    category: str | None = None
    color: str | None = None
    active: bool = True
    tax_class: TaxClass = "standard"
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    cost_cents: int | None = Field(default=None, ge=0)
    track_stock: bool = False
    sell_online: bool = Field(
        default=False, description="Products only: listed in the online shop and as add-ons"
    )
    low_stock_at: int | None = Field(default=None, ge=0)
    buffer_before_min: int = Field(default=0, ge=0)
    buffer_after_min: int = Field(default=0, ge=0)
    deposit_type: DepositType = "none"
    deposit_value: float | None = Field(
        default=None, ge=0, description="Cents for a fixed deposit, a percent for a percent one"
    )
    session_count: int | None = Field(default=None, ge=1)
    validity_days: int | None = Field(default=None, ge=1)
    interval: int | None = Field(default=None, ge=1)
    frequency: Frequency | None = None
    covers_item_id: str | None = Field(
        default=None, description="Packages only: the service or class each visit covers"
    )
    visits_per_period: int | None = Field(
        default=None, ge=1, description="Memberships only: visits included each period"
    )
    member_discount_bps: int | None = Field(
        default=None, ge=0, le=10000, description="Memberships only: members' retail discount"
    )
    gift_amounts: list[GiftAmount] | None = Field(
        default=None, max_length=12, description="Gift cards only: suggested amounts in cents"
    )


class ItemCreate(ItemBase):
    online_bookable: bool | None = Field(
        default=None, description="Defaults by kind: services and classes only"
    )


class ItemUpdate(BaseModel):
    kind: ItemKind | None = None
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    price_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern="^[A-Z]{3}$")
    duration_min: int | None = Field(default=None, ge=0)
    capacity: int | None = Field(default=None, ge=0)
    category: str | None = None
    color: str | None = None
    online_bookable: bool | None = None
    active: bool | None = None
    tax_class: TaxClass | None = None
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    cost_cents: int | None = Field(default=None, ge=0)
    track_stock: bool | None = None
    sell_online: bool | None = None
    low_stock_at: int | None = Field(default=None, ge=0)
    buffer_before_min: int | None = Field(default=None, ge=0)
    buffer_after_min: int | None = Field(default=None, ge=0)
    deposit_type: DepositType | None = None
    deposit_value: float | None = Field(default=None, ge=0)
    session_count: int | None = Field(default=None, ge=1)
    validity_days: int | None = Field(default=None, ge=1)
    interval: int | None = Field(default=None, ge=1)
    frequency: Frequency | None = None
    covers_item_id: str | None = None
    visits_per_period: int | None = Field(default=None, ge=1)
    member_discount_bps: int | None = Field(default=None, ge=0, le=10000)
    gift_amounts: list[GiftAmount] | None = Field(default=None, max_length=12)


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    online_bookable: bool
    stock_on_hand: int | None
    business_id: str
    created_at: datetime
    updated_at: datetime


class RestockIn(BaseModel):
    quantity: int = Field(description="Negative for a count correction; never zero")
    note: str | None = None
    unit_cost_cents: int | None = Field(
        default=None, ge=0, description="What each unit cost; updates the product's cost"
    )

    @field_validator("quantity")
    @classmethod
    def _not_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("quantity can't be zero")
        return v
