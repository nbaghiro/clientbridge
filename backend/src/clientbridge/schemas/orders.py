from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.billing import LineInput, LineOut


class OrderCreate(BaseModel):
    client_id: str | None = None  # null = walk-in
    lines: list[LineInput] = Field(default_factory=list)
    receipt_email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    receipt_phone: str | None = Field(default=None, min_length=7, max_length=20)


class OrderUpdate(BaseModel):
    client_id: str | None = None  # null = walk-in; only while nothing is charged
    lines: list[LineInput] | None = None
    receipt_email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    receipt_phone: str | None = Field(default=None, min_length=7, max_length=20)


class OrderPayIn(BaseModel):
    payment_method_id: str | None = None  # a saved card of the order's client, or "default"


class OrderPickupIn(BaseModel):
    status: Literal["ready", "picked_up"]


class OrderOut(BaseModel):
    id: str
    business_id: str
    client_id: str | None
    staff_id: str
    status: str
    currency: str
    subtotal_cents: int
    tax_total_cents: int
    total_cents: int
    amount_paid_cents: int
    balance_cents: int
    paid_at: datetime | None
    receipt_email: str | None = None
    receipt_phone: str | None = None
    source: str = "pos"
    pickup_status: str | None = None
    lines: list[LineOut]


class CheckoutOut(BaseModel):
    order_id: str
    client_secret: str
    payment_id: str


class ConnectionTokenOut(BaseModel):
    secret: str
    location_id: str | None = None  # the business's Terminal Location, for connectReader
