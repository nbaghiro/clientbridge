from fastapi import APIRouter

from clientbridge.core.deps import DbSession, EmailDep, OAuthVerifierDep
from clientbridge.schemas.auth import (
    AcceptInviteBody,
    ForgotPasswordBody,
    LoginBody,
    OAuthGoogleBody,
    RefreshBody,
    RegisterBody,
    ResetPasswordBody,
    TokenPair,
    VerifyEmailBody,
)
from clientbridge.services.auth_service import AuthService
from clientbridge.services.staff_service import StaffService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenPair, status_code=201)
async def register(body: RegisterBody, db: DbSession, email_sender: EmailDep) -> TokenPair:
    svc = AuthService(db)
    user = await svc.register(body.email, body.password, body.name)
    pair = await svc.issue_session(user.id)
    await svc.send_verification(user.id, user.email, email_sender)
    return pair


@router.post("/login", response_model=TokenPair)
async def login(body: LoginBody, db: DbSession) -> TokenPair:
    svc = AuthService(db)
    user = await svc.authenticate(body.email, body.password)
    return await svc.issue_session(user.id)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshBody, db: DbSession) -> TokenPair:
    return await AuthService(db).rotate(body.refresh_token)


@router.post("/logout", status_code=204)
async def logout(body: RefreshBody, db: DbSession) -> None:
    await AuthService(db).revoke(body.refresh_token)


@router.post("/accept-invite", response_model=TokenPair)
async def accept_invite(body: AcceptInviteBody, db: DbSession) -> TokenPair:
    user = await StaffService(db).accept_invite(
        token=body.token, name=body.name, password=body.password
    )
    return await AuthService(db).issue_session(user.id)


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordBody, db: DbSession, email_sender: EmailDep
) -> dict[str, str]:
    # always 200 + the same body, whether or not the email exists (no enumeration)
    await AuthService(db).request_password_reset(body.email, email_sender)
    return {"status": "ok"}


@router.post("/reset-password", status_code=204)
async def reset_password(body: ResetPasswordBody, db: DbSession) -> None:
    await AuthService(db).reset_password(body.token, body.new_password)


@router.post("/verify-email", status_code=204)
async def verify_email(body: VerifyEmailBody, db: DbSession) -> None:
    await AuthService(db).verify_email(body.token)


@router.post("/oauth/google", response_model=TokenPair)
async def oauth_google(
    body: OAuthGoogleBody, db: DbSession, verifier: OAuthVerifierDep
) -> TokenPair:
    profile = await verifier.verify_google(body.id_token)
    svc = AuthService(db)
    user = await svc.oauth_login(profile)
    return await svc.issue_session(user.id)
