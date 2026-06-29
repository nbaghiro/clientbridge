from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.schemas.billing import LineInput, LineOut


class OrderCreate(BaseModel):
    client_id: str | None = None  # null = walk-in
    lines: list[LineInput] = Field(default_factory=list)


class OrderUpdate(BaseModel):
    lines: list[LineInput] | None = None


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
    lines: list[LineOut]


class CheckoutOut(BaseModel):
    order_id: str
    client_secret: str
    payment_id: str


class ConnectionTokenOut(BaseModel):
    secret: str
