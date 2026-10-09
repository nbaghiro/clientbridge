from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.clients import Channel
from clientbridge.models.payments import Payment, PaymentMethod, PaymentStatus, PayMethod
from clientbridge.schemas.public import PublicBrand


class ConnectSessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component: Literal["onboarding", "account", "payments", "payouts"]


class ConnectSessionOut(BaseModel):
    client_secret: str


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
    current_deadline: datetime | None = Field(
        default=None, description="When Stripe pauses payouts if what is due isn't sent"
    )
    available_cents: int | None = Field(
        default=None, description="The Stripe balance available to pay out, when connected"
    )


class SetupIntentOut(BaseModel):
    client_secret: str
    stripe_account_id: str


RefundReason = Literal["service", "skipped", "duplicate", "canceled", "other"]


class RefundIn(Mirror):
    mirrors = Payment

    amount_cents: int | None = Field(default=None, description="Null refunds what is left")
    reason: RefundReason | None = None
    notify: bool = Field(default=True, description="Send the client the credit note")


class RefundOut(Mirror):
    mirrors = Payment

    refund_id: str
    status: PaymentStatus
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


class InteracRequestIn(Mirror):
    mirrors = Payment

    amount_cents: int | None = Field(default=None, gt=0, description="Null requests the balance")
    channel: Channel = "email"
    expires_in_days: int = Field(default=14, ge=1, le=60)


class InteracRequest(Mirror):
    mirrors = Payment

    payment_id: str
    reference_code: str
    send_to: str | None
    amount_cents: int
    channel: Channel | None = None
    expires_at: datetime | None = None


class PaymentMethodOut(Mirror):
    mirrors = PaymentMethod

    id: str
    client_id: str
    brand: str | None
    last4: str | None
    preferred: bool
    status: str


class DetachResult(BaseModel):
    detached: bool


class InteracWebhookBody(Mirror):
    mirrors = Payment

    reference_code: str
    amount_cents: int


TaxFamily = Literal["federal", "provincial"]


class RemittanceIn(BaseModel):
    period_start: date
    period_end: date
    family: TaxFamily | None = Field(
        default=None,
        description="federal files GST/HST, provincial files PST/QST; omitted files every code",
    )
    itc_cents: int = Field(
        default=0, ge=0, description="Input tax credits claimed against GST/HST (federal only)"
    )
    confirmation: str | None = Field(default=None, max_length=80)
    filed_on: date | None = Field(default=None, description="Defaults to today")


class RemittanceOut(BaseModel):
    period_start: date
    period_end: date
    family: TaxFamily | None
    by_code: dict[str, int]
    itc_cents: int
    total_cents: int = Field(description="What was paid: the tax owed less input tax credits")
    confirmation: str | None
    filed_on: date


class FiledReturn(BaseModel):
    id: str
    family: TaxFamily | None
    period_start: date
    period_end: date
    by_code: dict[str, int]
    itc_cents: int
    paid_cents: int
    confirmation: str | None
    filed_on: date


class FilingPeriod(BaseModel):
    start: date
    end: date
    due: date
    federal_cents: int = Field(description="GST/HST booked in the period, before credits")
    provincial_cents: int = Field(description="PST/QST booked in the period")
    taxable_cents: int = Field(description="Sales before tax booked in the period (line 101)")
    provincial_taxable_cents: int = Field(description="Sales that carried PST/QST")
    federal_status: Literal["open", "due", "filed"]
    provincial_status: Literal["open", "due", "filed", "none"]
    returns: list[FiledReturn]


class TaxFilings(BaseModel):
    frequency: str
    registered: bool
    federal_code: str | None = Field(description="GST or HST, from the province")
    provincial_code: str | None = Field(description="PST or QST, when the province has one")
    provincial_rate_bps: int | None
    gst_hst_number: str | None
    qst_number: str | None
    federal_set_aside_cents: int = Field(description="GST/HST collected and not yet filed")
    provincial_set_aside_cents: int = Field(description="PST/QST collected and not yet filed")
    next_due: date | None
    periods: list[FilingPeriod] = Field(description="Newest first")


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


class PublicCredit(Mirror):
    mirrors = Payment

    kind: Literal["payment", "deposit"]
    method: PayMethod | None
    amount_cents: int
    at: datetime | None


class PublicInterac(Mirror):
    mirrors = Payment

    reference_code: str
    amount_cents: int
    send_to: str | None
    expires_at: datetime | None


class PublicInvoice(BaseModel):
    tip_base_cents: int = Field(
        default=0, description="Service subtotal before tax; excludes retail and entitlements"
    )
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


class InvoicePaymentIn(Mirror):
    mirrors = Payment

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


class InvoicePaymentOut(Mirror):
    mirrors = Payment

    payment_id: str
    status: PaymentStatus
    amount_cents: int
    change_cents: int
    balance_cents: int
    client_secret: str | None = None


class PaymentSetupLinkOut(BaseModel):
    id: str
    url: str
    expires_at: datetime


class PublicPaymentSetup(BaseModel):
    brand: PublicBrand
    business_name: str
    client_name: str
    expires_at: datetime
    status: str
    stripe_account_id: str
    client_secret: str | None = None
    verification_url: str | None = None
