from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clientbridge.schemas.billing import TaxClass

ItemKind = Literal["service", "class", "product", "package", "subscription", "gift"]
DepositType = Literal["none", "fixed", "percent"]
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

    @field_validator("quantity")
    @classmethod
    def _not_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("quantity can't be zero")
        return v


class TaxClassChange(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=500)
    tax_class: TaxClass


class TaxClassResult(BaseModel):
    count: int
