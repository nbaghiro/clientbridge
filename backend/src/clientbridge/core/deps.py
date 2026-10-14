from typing import Annotated

from fastapi import Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import get_session
from clientbridge.core.errors import AppError, Forbidden, Unauthorized
from clientbridge.integrations.expo import PushSender, get_push_sender
from clientbridge.integrations.identity import Credential, Identity, IdentityProvider
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.integrations.resend import EmailSender, get_email_sender
from clientbridge.integrations.s3 import FileStorage, get_file_storage
from clientbridge.integrations.stripe import PaymentGateway, get_payment_gateway
from clientbridge.integrations.twilio import SmsSender, get_sms_sender
from clientbridge.models.business import Staff, User
from clientbridge.services.auth import AuthService

DbSession = Annotated[AsyncSession, Depends(get_session)]
EmailDep = Annotated[EmailSender, Depends(get_email_sender)]
SmsDep = Annotated[SmsSender, Depends(get_sms_sender)]
PushDep = Annotated[PushSender, Depends(get_push_sender)]
IdentityDep = Annotated[IdentityProvider, Depends(get_identity_provider)]
GatewayDep = Annotated[PaymentGateway, Depends(get_payment_gateway)]
StorageDep = Annotated[FileStorage, Depends(get_file_storage)]


def get_twilio_auth_token() -> str:
    return get_settings().twilio_auth_token


TwilioAuthTokenDep = Annotated[str, Depends(get_twilio_auth_token)]


def get_auth_email_secret() -> str:
    return get_settings().auth_email_hook_secret


def get_resend_webhook_secret() -> str:
    return get_settings().resend_webhook_secret


ResendWebhookSecretDep = Annotated[str, Depends(get_resend_webhook_secret)]


AuthEmailSecretDep = Annotated[str, Depends(get_auth_email_secret)]


_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _credential(request: Request, session_token: str) -> Credential:
    """Mobile sends its session token; web sends the session cookie."""
    if session_token:
        return Credential(session_token=session_token)
    settings = get_settings()
    cookie = request.cookies.get(settings.auth_session_cookie, "")
    if not cookie:
        raise Unauthorized("sign in required", code="unauthenticated")
    # The cookie also rides along from Connect and Pay, so cookie writes must come from the app.
    if (
        request.method not in _SAFE_METHODS
        and request.headers.get("origin", "") not in settings.app_origins()
    ):
        raise Forbidden("request origin not allowed", code="origin_refused")
    return Credential(cookie=cookie)


async def current_identity(
    request: Request, identities: IdentityDep, x_session_token: str = Header(default="")
) -> Identity:
    return await identities.whoami(_credential(request, x_session_token))


CurrentIdentity = Annotated[Identity, Depends(current_identity)]


async def fresh_identity(
    request: Request, identities: IdentityDep, x_session_token: str = Header(default="")
) -> Identity:
    """Skips the whoami cache, for checks a just-verified email or a step-up must pass at once."""
    return await identities.whoami(_credential(request, x_session_token), fresh=True)


FreshIdentity = Annotated[Identity, Depends(fresh_identity)]


async def _provisioned(
    identity: Identity, identities: IdentityProvider, db: AsyncSession, expected_user: str
) -> User:
    user = await AuthService(db).provision(identity, identities)
    if expected_user and expected_user != user.id:
        raise Unauthorized("signed in as a different user", code="session_changed")
    return user


async def current_user(
    identity: CurrentIdentity,
    identities: IdentityDep,
    db: DbSession,
    x_expected_user: str = Header(default=""),
) -> User:
    return await _provisioned(identity, identities, db, x_expected_user)


CurrentUser = Annotated[User, Depends(current_user)]


async def fresh_user(
    identity: FreshIdentity,
    identities: IdentityDep,
    db: DbSession,
    x_expected_user: str = Header(default=""),
) -> User:
    """Provisions from the fresh identity, so a just-verified email relinks on the first retry."""
    return await _provisioned(identity, identities, db, x_expected_user)


FreshUser = Annotated[User, Depends(fresh_user)]


async def current_user_id(user: CurrentUser) -> str:
    return user.id


CurrentUserId = Annotated[str, Depends(current_user_id)]


class Principal(BaseModel):
    """The actor + their active business context — what services authorize against."""

    user_id: str
    business_id: str
    staff_id: str
    role: str


async def current_principal(
    user_id: CurrentUserId,
    db: DbSession,
    x_business_id: str = Header(default=""),
) -> Principal:
    """Resolve the actor's active business. With multiple, the `X-Business-Id` header picks."""
    rows = (
        (await db.execute(select(Staff).where(Staff.user_id == user_id, Staff.status == "active")))
        .scalars()
        .all()
    )
    if not rows:
        raise Forbidden("no active business membership")
    if x_business_id:
        chosen = next((s for s in rows if s.business_id == x_business_id), None)
        if chosen is None:
            raise Forbidden("not a member of that business")
    elif len(rows) == 1:
        chosen = rows[0]
    else:
        raise AppError(
            "multiple businesses — set the X-Business-Id header", code="business_ambiguous"
        )
    return Principal(
        user_id=user_id, business_id=chosen.business_id, staff_id=chosen.id, role=chosen.role
    )


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def is_manager(role: str) -> bool:
    return role in ("owner", "admin")


def assert_role(principal: Principal, *roles: str, message: str) -> None:
    """403 unless the actor holds one of `roles`; for services whose methods vary in access."""
    if principal.role not in roles:
        raise Forbidden(message)


def assert_can_act_as(principal: Principal, staff_id: str | None) -> None:
    """Owner/admin may act for anyone; other staff only for their own bookings/schedule."""
    if is_manager(principal.role):
        return
    if staff_id != principal.staff_id:
        raise Forbidden("staff can only manage their own bookings")
