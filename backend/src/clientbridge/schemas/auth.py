from typing import Literal

from pydantic import BaseModel, Field, model_validator

AuthEmailType = Literal[
    "verification_code_valid",
    "verification_code_invalid",
    "recovery_code_valid",
    "recovery_code_invalid",
    "login_code_valid",
    "registration_code_valid",
]


class MeOut(BaseModel):
    user_id: str
    email: str
    name: str | None
    email_verified: bool
    aal: str


class AuthEmailIn(BaseModel):
    """One message from the Kratos courier, shaped by infra/kratos/courier.jsonnet."""

    template_type: AuthEmailType
    to: str = Field(min_length=3, max_length=320)
    code: str | None = Field(default=None, min_length=1, max_length=64)
    expires_in_minutes: int | None = Field(default=None, ge=1)
    link: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _valid_carries_a_code(self) -> "AuthEmailIn":
        if self.template_type.endswith("_valid") and (
            self.code is None or self.expires_in_minutes is None
        ):
            raise ValueError("a code email needs its code and lifespan")
        return self
