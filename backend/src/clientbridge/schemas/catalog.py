from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ItemBase(BaseModel):
    kind: str = "service"
    name: str
    description: str | None = None
    price_cents: int = 0
    currency: str = "CAD"
    duration_min: int | None = None
    capacity: int | None = None
    tax_rate_id: str | None = None
    category: str | None = None
    color: str | None = None
    online_bookable: bool = True
    active: bool = True


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    kind: str | None = None
    name: str | None = None
    description: str | None = None
    price_cents: int | None = None
    currency: str | None = None
    duration_min: int | None = None
    capacity: int | None = None
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
