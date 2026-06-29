from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BookingCreate(BaseModel):
    client_id: str
    item_id: str
    staff_id: str
    starts_at: datetime
    resource_id: str | None = None
    subject_id: str | None = None


class BookingPatch(BaseModel):
    starts_at: datetime | None = None
    status: Literal["confirmed", "completed", "canceled", "no_show"] | None = None


class BookingOut(BaseModel):
    id: str
    business_id: str
    session_id: str
    client_id: str
    staff_id: str | None
    item_id: str
    status: str
    source: str
    price_cents: int
    deposit_amount_cents: int
    deposit_status: str
    starts_at: datetime
    ends_at: datetime


class DepositOut(BaseModel):
    booking_id: str
    payment_id: str
    client_secret: str
