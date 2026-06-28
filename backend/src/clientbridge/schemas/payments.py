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


class RefundOut(BaseModel):
    refund_id: str
    status: str


class InteracRequest(BaseModel):
    payment_id: str
    reference_code: str
    send_to: str | None
    amount_cents: int


class InteracWebhookBody(BaseModel):
    reference_code: str
    amount_cents: int


class RemittanceSummary(BaseModel):
    tax_collected_cents: int  # Σ tax on paid invoices — the GST/HST to set aside for CRA
