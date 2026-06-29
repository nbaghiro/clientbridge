from pydantic import BaseModel


class OnboardingLink(BaseModel):
    url: str
    charges_enabled: bool


class ConnectStatus(BaseModel):
    connected: bool
    charges_enabled: bool


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
    is_default: bool
    status: str


class DetachResult(BaseModel):
    detached: bool


class InteracWebhookBody(BaseModel):
    reference_code: str
    amount_cents: int


class RemittanceSummary(BaseModel):
    tax_collected_cents: int  # Σ tax on paid invoices — the GST/HST to set aside for CRA


class PublicInvoice(BaseModel):
    number: int | None
    business_name: str
    currency: str
    total_cents: int
    balance_cents: int
    status: str
    accepts_card: bool
    interac_email: str | None


class PublicCardIntent(BaseModel):
    client_secret: str
    stripe_account_id: str
