from pydantic import BaseModel


class MeOut(BaseModel):
    user_id: str
    email: str
    name: str | None
    email_verified: bool
    aal: str
