from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBrand


class OnboardingLink(BaseModel):
    url: str
    charges_enabled: bool


class ConnectStatus(BaseModel):
    connected: bool
    charges_enabled: bool
    payouts_enabled: bool = False
    details_submitted: bool = False
    kyc_status: str = Field(
        default="not_started",
        description="not_started, pending, restricted, enabled or disabled",
    )
    disabled_reason: str | None = None
    currently_due: list[str] = Field(
        default_factory=list, description="What the business must still submit to Stripe"
    )
    past_due: list[str] = Field(default_factory=list)
    pending_verification: list[str] = Field(
        default_factory=list, description="What Stripe is still reviewing"
    )


class PayIntentOut(BaseModel):
    payment_id: str
    client_secret: str
    amount_cents: int


class SetupIntentOut(BaseModel):
    client_secret: str
    stripe_account_id: str


RefundReason = Literal["service", "skipped", "duplicate", "canceled", "other"]


class RefundIn(BaseModel):
    amount_cents: int | None = Field(default=None, description="Null refunds what is left")
    reason: RefundReason | None = None
    notify: bool = Field(default=True, description="Send the client the credit note")


class RefundOut(BaseModel):
    refund_id: str
    status: str
    credit_note: str | None = None


class RefundPart(BaseModel):
    category: str = Field(description="revenue, tax, deposit, deferred or gift_card")
    code: str = Field(description="The tax code for a tax part, else empty")
    cents: int


class RefundPreview(BaseModel):
    payment_id: str
    amount_cents: int
    refunded_cents: int
    left_cents: int
    fee_cents: int
    refund_cents: int = Field(description="What this preview refunds")
    whole_only: str | None = Field(default=None, description="Why only a full refund is allowed")
    blocked: str | None = Field(default=None, description="Why nothing can be refunded")
    by_hand: bool = Field(description="Money goes back outside Stripe (cash, cheque, e-Transfer)")
    next_credit_note: str
    parts: list[RefundPart]


class InteracRequestIn(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0, description="Null requests the balance")
    channel: Literal["email", "sms"] = "email"
    expires_in_days: int = Field(default=14, ge=1, le=60)


class InteracRequest(BaseModel):
    payment_id: str
    reference_code: str
    send_to: str | None
    amount_cents: int
    channel: str | None = None
    expires_at: datetime | None = None


class PaymentMethodOut(BaseModel):
    id: str
    client_id: str
    brand: str | None
    last4: str | None
    preferred: bool
    status: str


class DetachResult(BaseModel):
    detached: bool


class InteracWebhookBody(BaseModel):
    reference_code: str
    amount_cents: int


class RemittanceSummary(BaseModel):
    tax_collected_cents: int = Field(description="Sales tax collected and not yet filed")


class RemittanceIn(BaseModel):
    period_start: date
    period_end: date


class RemittanceOut(BaseModel):
    period_start: date
    period_end: date
    by_code: dict[str, int]
    total_cents: int


class PublicDocLine(BaseModel):
    description: str
    quantity: float
    unit_amount_cents: int
    amount_cents: int = Field(description="After the line's own discount")
    tax_codes: list[str]
    discount_cents: int = Field(default=0, description="The line's own discount")
    discount_reason: str | None = None


class PublicDocTax(BaseModel):
    code: str
    rate_bps: int
    base_cents: int
    cents: int


class PublicCredit(BaseModel):
    kind: Literal["payment", "deposit"]
    method: str | None
    amount_cents: int
    at: datetime | None


class PublicInterac(BaseModel):
    reference_code: str
    amount_cents: int
    send_to: str | None
    expires_at: datetime | None


class PublicInvoice(BaseModel):
    number: int | None
    business_name: str
    brand: PublicBrand
    currency: str
    subtotal_cents: int = 0
    tax_total_cents: int = 0
    total_cents: int
    balance_cents: int
    status: str
    accepts_card: bool
    interac_email: str | None
    client_name: str | None = None
    issued_at: datetime | None = None
    due_at: datetime | None = None
    notes: str | None = None
    gst_hst_number: str | None = None
    qst_number: str | None = None
    lines: list[PublicDocLine] = Field(default_factory=list)
    discount_cents: int = Field(default=0, description="The discount off the whole invoice")
    discount_reason: str | None = None
    taxes: list[PublicDocTax] = Field(default_factory=list)
    credits: list[PublicCredit] = Field(default_factory=list)
    interac: PublicInterac | None = Field(
        default=None, description="The e-Transfer request still waiting, if any"
    )
    tip_for: list[str] = Field(
        default_factory=list, description="First names of the staff a tip on this invoice goes to"
    )


class TipShareIn(BaseModel):
    staff_id: str
    cents: int = Field(gt=0)


class PublicPayIn(BaseModel):
    tip_cents: int = Field(default=0, ge=0, description="A tip for the staff, outside tax")


class PublicCardIntent(BaseModel):
    client_secret: str
    stripe_account_id: str


class InvoicePaymentIn(BaseModel):
    method: Literal["cash", "interac", "cheque", "card"] = Field(
        description="cash, an e-Transfer already received, a cheque, or the client's saved card"
    )
    amount_cents: int = Field(gt=0)
    tendered_cents: int | None = Field(
        default=None, gt=0, description="Cash handed over; the change is what is above the amount"
    )
    reference: str | None = Field(
        default=None, max_length=80, description="Cheque number or e-Transfer reference"
    )
    received_on: date | None = Field(
        default=None, description="When an e-Transfer or cheque arrived; today when omitted"
    )
    note: str | None = Field(default=None, max_length=500)
    payment_method_id: str | None = Field(
        default=None, description="Card only: a saved card of the invoice's client, or 'default'"
    )
    send_receipt: bool = True


class InvoicePaymentOut(BaseModel):
    payment_id: str
    status: str
    amount_cents: int
    change_cents: int
    balance_cents: int
    client_secret: str | None = None
