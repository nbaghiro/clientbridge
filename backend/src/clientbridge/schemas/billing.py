from datetime import date, datetime

from pydantic import BaseModel, Field


class LineInput(BaseModel):
    description: str
    quantity: float = 1.0
    unit_amount_cents: int = 0
    item_id: str | None = None
    booking_id: str | None = None


class LineOut(BaseModel):
    id: str
    description: str
    quantity: float
    unit_amount_cents: int
    amount_cents: int
    tax_amount_cents: int
    item_id: str | None
    booking_id: str | None
    position: int


class InvoiceCreate(BaseModel):
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    due_at: datetime | None = None


class InvoiceUpdate(BaseModel):
    lines: list[LineInput] | None = None
    notes: str | None = None
    due_at: datetime | None = None


class InvoiceOut(BaseModel):
    id: str
    business_id: str
    client_id: str
    number: int | None
    status: str
    currency: str
    subtotal_cents: int
    tax_total_cents: int
    total_cents: int
    amount_paid_cents: int
    balance_cents: int
    issued_at: datetime | None
    due_at: datetime | None
    paid_at: datetime | None
    voided_at: datetime | None
    notes: str | None
    lines: list[LineOut]


class EstimateCreate(BaseModel):
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    valid_until: date | None = None


class EstimateUpdate(BaseModel):
    lines: list[LineInput] | None = None
    notes: str | None = None
    valid_until: date | None = None


class EstimateOut(BaseModel):
    id: str
    business_id: str
    client_id: str
    number: int | None
    status: str
    subtotal_cents: int
    tax_total_cents: int
    total_cents: int
    valid_until: date | None
    accepted_at: datetime | None
    declined_at: datetime | None
    converted_invoice_id: str | None
    notes: str | None
    lines: list[LineOut]
