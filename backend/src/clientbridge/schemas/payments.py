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
