from typing import Annotated

from fastapi import Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import get_session
from clientbridge.core.errors import AppError, Forbidden, Unauthorized
from clientbridge.core.security import decode_jwt
from clientbridge.integrations.expo import PushSender, get_push_sender
from clientbridge.integrations.google import OAuthVerifier, get_oauth_verifier
from clientbridge.integrations.postmark import EmailSender, get_email_sender
from clientbridge.integrations.s3 import FileStorage, get_file_storage
from clientbridge.integrations.stripe import PaymentGateway, get_payment_gateway
from clientbridge.integrations.twilio import SmsSender, get_sms_sender
from clientbridge.models.business import Staff, User

DbSession = Annotated[AsyncSession, Depends(get_session)]
EmailDep = Annotated[EmailSender, Depends(get_email_sender)]
SmsDep = Annotated[SmsSender, Depends(get_sms_sender)]
PushDep = Annotated[PushSender, Depends(get_push_sender)]
OAuthVerifierDep = Annotated[OAuthVerifier, Depends(get_oauth_verifier)]
GatewayDep = Annotated[PaymentGateway, Depends(get_payment_gateway)]
StorageDep = Annotated[FileStorage, Depends(get_file_storage)]


def get_interac_secret() -> str:
    return get_settings().interac_webhook_secret


InteracSecretDep = Annotated[str, Depends(get_interac_secret)]


def get_sms_webhook_secret() -> str:
    return get_settings().sms_webhook_secret


SmsWebhookSecretDep = Annotated[str, Depends(get_sms_webhook_secret)]


async def current_claims(authorization: str = Header(default="")) -> dict[str, object]:
    if not authorization.startswith("Bearer "):
        raise Unauthorized("missing bearer token")
    try:
        return decode_jwt(authorization.removeprefix("Bearer "))
    except Exception as e:
        raise Unauthorized("invalid token") from e


Claims = Annotated[dict[str, object], Depends(current_claims)]


async def current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise Unauthorized("missing bearer token")
    try:
        return str(decode_jwt(authorization.removeprefix("Bearer ").strip())["sub"])
    except Exception as e:
        raise Unauthorized("invalid token") from e


CurrentUserId = Annotated[str, Depends(current_user_id)]


async def current_user(user_id: CurrentUserId, db: DbSession) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise Unauthorized("user not found")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


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
