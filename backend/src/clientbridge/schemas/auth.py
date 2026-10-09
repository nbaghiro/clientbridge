from uuid import UUID

from pydantic import BaseModel


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginBody(BaseModel):
    email: str
    password: str


class LogoutBody(BaseModel):
    refresh_token: str


class RefreshBody(LogoutBody):
    attempt_id: UUID


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AcceptInviteBody(BaseModel):
    token: str
    name: str | None = None
    password: str


class ForgotPasswordBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


class VerifyEmailBody(BaseModel):
    token: str


class OAuthGoogleBody(BaseModel):
    id_token: str
