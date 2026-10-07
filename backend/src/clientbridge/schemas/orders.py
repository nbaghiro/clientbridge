from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.billing import DiscountIn, LineInput, LineOut
from clientbridge.schemas.payments import PublicDocLine, PublicDocTax, TipShareIn
from clientbridge.schemas.public import PublicBrand

_PIN = r"^[0-9]{4}$"


class OrderCreate(BaseModel):
    client_id: str | None = Field(default=None, description="Null for a walk-in")
    lines: list[LineInput] = Field(default_factory=list)
    discount: DiscountIn | None = Field(default=None, description="Off the whole sale")
    approval_pin: str | None = Field(
        default=None,
        pattern=_PIN,
        description="An owner's or admin's PIN for an over-limit discount",
    )
    note: str | None = Field(default=None, max_length=200, description="Why the sale is held")
    receipt_email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    receipt_phone: str | None = Field(default=None, min_length=7, max_length=20)


class OrderUpdate(BaseModel):
    client_id: str | None = Field(
        default=None, description="Null for a walk-in; changeable until something is charged"
    )
    lines: list[LineInput] | None = None
    discount: DiscountIn | None = Field(default=None, description="Off the whole sale")
    approval_pin: str | None = Field(default=None, pattern=_PIN)
    note: str | None = Field(default=None, max_length=200)
    receipt_email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    receipt_phone: str | None = Field(default=None, min_length=7, max_length=20)


class TipIn(BaseModel):
    tip_cents: int = Field(default=0, ge=0, description="Outside tax, owed to the staff")
    tip_split: list[TipShareIn] | None = Field(
        default=None, description="Who gets the tip; by line value to each line's staff if omitted"
    )


class OrderPayIn(TipIn):
    payment_method_id: str | None = Field(
        default=None, description="A saved card of the order's client, or 'default'"
    )


class OrderCashIn(TipIn):
    tendered_cents: int = Field(ge=0, description="Cash handed over")


class OrderCashOut(BaseModel):
    payment_id: str
    amount_cents: int
    tip_cents: int
    change_cents: int


class OrderReceiptIn(BaseModel):
    channel: Literal["email", "sms"]
    to: str = Field(min_length=3, max_length=200, description="An email address or phone number")


class PinIn(BaseModel):
    pin: str = Field(pattern=_PIN)


class OrderPickupIn(BaseModel):
    status: Literal["ready", "picked_up"]


class OrderOut(BaseModel):
    id: str
    business_id: str
    client_id: str | None
    staff_id: str
    number: int | None = None
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
    ready_at: datetime | None = None
    picked_up_at: datetime | None = None
    note: str | None = None
    discount: DiscountIn | None = None
    discount_cents: int = 0
    approved_by: str | None = None
    deposit_cents: int = Field(default=0, description="Visit deposits applied or still to apply")
    due_cents: int = Field(default=0, description="What is left to charge, before any tip")
    tip_cents: int = 0
    receipt_channel: str | None = None
    receipt_sent_at: datetime | None = None
    lines: list[LineOut]


class PublicReceiptPayment(BaseModel):
    kind: Literal["payment", "deposit", "refund"]
    method: str
    amount_cents: int
    tip_cents: int = 0
    at: datetime | None


class PublicReceipt(BaseModel):
    number: int | None
    business_name: str
    brand: PublicBrand
    gst_hst_number: str | None = None
    qst_number: str | None = None
    client_name: str | None = None
    served_by: list[str] = Field(default_factory=list)
    status: str
    currency: str
    created_at: datetime
    lines: list[PublicDocLine]
    discount_cents: int = 0
    discount_reason: str | None = None
    subtotal_cents: int
    taxes: list[PublicDocTax]
    tax_total_cents: int
    total_cents: int
    tip_cents: int = 0
    payments: list[PublicReceiptPayment]


class OrderCheckoutIn(TipIn):
    pass


class CheckoutOut(BaseModel):
    order_id: str
    client_secret: str
    payment_id: str


class ConnectionTokenOut(BaseModel):
    secret: str
    location_id: str | None = Field(
        default=None, description="The business's Terminal location, for connectReader"
    )
