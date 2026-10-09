from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from clientbridge.core.mirrors import Mirror
from clientbridge.models.billing import DiscountKind, Estimate, Invoice, Line
from clientbridge.models.catalog import TaxClass
from clientbridge.schemas.payments import PublicDocLine, PublicDocTax
from clientbridge.schemas.public import PublicBrand


class DiscountIn(BaseModel):
    kind: DiscountKind
    value: int = Field(gt=0, description="A whole percent (10) or an amount in cents (500)")
    reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _percent_at_most_100(self) -> "DiscountIn":
        if self.kind == "percent" and self.value > 100:
            raise ValueError("a percent discount is at most 100")
        return self


class LineInput(Mirror):
    mirrors = Line

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
    staff_id: str | None = Field(default=None, description="Who did the work (tips, commission)")
    discount: DiscountIn | None = None


class LineOut(Mirror):
    mirrors = Line

    id: str
    description: str
    quantity: float
    unit_amount_cents: int
    amount_cents: int
    tax_amount_cents: int
    tax_class: TaxClass
    item_id: str | None
    booking_id: str | None
    position: int
    optional: bool = False
    selected: bool = False
    staff_id: str | None = None
    discount: DiscountIn | None = None
    discount_cents: int = Field(default=0, description="The line's own discount")
    sale_discount_cents: int = Field(default=0, description="Its share of the document discount")


class InvoiceCreate(Mirror):
    mirrors = Invoice

    discount: DiscountIn | None = Field(default=None, description="Off the whole document")
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    due_at: datetime | None = None
    send: bool = Field(default=False, description="Issue and send it in the same command")


class InvoiceUpdate(Mirror):
    mirrors = Invoice

    discount: DiscountIn | None = Field(default=None, description="Off the whole document")
    lines: list[LineInput] | None = None
    notes: str | None = None
    due_at: datetime | None = None


class InvoiceOut(Mirror):
    mirrors = Invoice
    derived = frozenset({"status"})

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
    discount: DiscountIn | None = None
    discount_cents: int = 0
    lines: list[LineOut]


class EstimateCreate(Mirror):
    mirrors = Estimate

    discount: DiscountIn | None = Field(default=None, description="Off the whole document")
    client_id: str
    lines: list[LineInput] = Field(default_factory=list)
    notes: str | None = None
    valid_until: date | None = None
    send: bool = Field(default=False, description="Number and send it in the same command")


class EstimateUpdate(Mirror):
    mirrors = Estimate

    discount: DiscountIn | None = Field(default=None, description="Off the whole document")
    lines: list[LineInput] | None = None
    notes: str | None = None
    valid_until: date | None = None


class EstimateOut(Mirror):
    mirrors = Estimate
    derived = frozenset({"status"})

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
    discount: DiscountIn | None = None
    discount_cents: int = 0
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
