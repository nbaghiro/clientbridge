from datetime import date

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


class RefundOut(BaseModel):
    refund_id: str
    status: str


class InteracRequest(BaseModel):
    payment_id: str
    reference_code: str
    send_to: str | None
    amount_cents: int


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


class PublicInvoice(BaseModel):
    number: int | None
    business_name: str
    brand: PublicBrand
    currency: str
    total_cents: int
    balance_cents: int
    status: str
    accepts_card: bool
    interac_email: str | None


class PublicCardIntent(BaseModel):
    client_secret: str
    stripe_account_id: str
