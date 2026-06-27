from pydantic import BaseModel


class OnboardingLink(BaseModel):
    url: str
    charges_enabled: bool


class ConnectStatus(BaseModel):
    connected: bool
    charges_enabled: bool
