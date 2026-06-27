from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ItemKind = Literal["service", "class", "product", "package", "subscription", "gift"]


class ItemBase(BaseModel):
    kind: ItemKind = "service"
    name: str = Field(min_length=1)
    description: str | None = None
    price_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="CAD", min_length=3, max_length=3)
    duration_min: int | None = Field(default=None, ge=0)
    capacity: int | None = Field(default=None, ge=0)
    tax_rate_id: str | None = None
    category: str | None = None
    color: str | None = None
    online_bookable: bool = True
    active: bool = True


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    kind: ItemKind | None = None
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    price_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    duration_min: int | None = Field(default=None, ge=0)
    capacity: int | None = Field(default=None, ge=0)
    tax_rate_id: str | None = None
    category: str | None = None
    color: str | None = None
    online_bookable: bool | None = None
    active: bool | None = None


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    created_at: datetime
    updated_at: datetime
