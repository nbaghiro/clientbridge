from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.payments import PublicDocLine, PublicDocTax
from clientbridge.schemas.public import PublicBrand

TaxClass = Literal["standard", "federal_only", "exempt"]


class LineInput(BaseModel):
    description: str
    quantity: float = Field(1.0, gt=0)
    unit_amount_cents: int = Field(0, ge=0)
    item_id: str | None = None
    booking_id: str | None = None
    tax_class: TaxClass | None = Field(
        default=None, description="Defaults to the item's class, else standard"
    )
    optional: bool = Field(
        default=False, description="Estimates only: an add-on the client may tick when accepting"
    )


class LineOut(BaseModel):
    id: str
    description: str
    quantity: float
    unit_amount_cents: int
    amount_cents: int
    tax_amount_cents: int
    tax_class: str
    item_id: str | None
    booking_id: str | None
    position: int
    optional: bool = False
    selected: bool = False


class InvoiceCreate(BaseModel):
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    due_at: datetime | None = None
    send: bool = Field(default=False, description="Issue and send it in the same command")


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
    pay_token: str | None
    lines: list[LineOut]


class EstimateCreate(BaseModel):
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    valid_until: date | None = None
    send: bool = Field(default=False, description="Number and send it in the same command")


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
    decline_reason: str | None = None
    view_token: str | None = None
    lines: list[LineOut]


class EstimateDecline(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class PublicEstimateLine(PublicDocLine):
    id: str
    optional: bool
    selected: bool
    tax_cents: int
    tax_by_code: dict[str, int]


class PublicEstimate(BaseModel):
    number: int | None
    business_name: str
    brand: PublicBrand
    contact_email: str | None
    gst_hst_number: str | None
    qst_number: str | None
    client_name: str | None
    status: str
    currency: str
    subtotal_cents: int
    tax_total_cents: int
    total_cents: int
    issued_at: datetime | None
    valid_until: date | None
    notes: str | None
    decline_reason: str | None
    lines: list[PublicEstimateLine]
    taxes: list[PublicDocTax]


class PublicEstimateAccept(BaseModel):
    line_ids: list[str] = Field(
        default_factory=list, description="The optional add-ons the client ticked"
    )


class PublicEstimateDecline(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
