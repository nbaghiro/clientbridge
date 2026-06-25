from pydantic import BaseModel, ConfigDict


class OnboardBody(BaseModel):
    name: str
    slug: str
    province: str
    timezone: str | None = None
    locale: str = "en"


class BusinessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    province: str | None
    timezone: str
    locale: str
    status: str


class InviteBody(BaseModel):
    email: str
    role: str = "staff"


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invite_token: str  # raw token, returned once to the inviter (also emailed)
