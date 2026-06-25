from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import get_session
from clientbridge.core.errors import AppError, Forbidden, Unauthorized
from clientbridge.core.security import decode_jwt
from clientbridge.integrations.email import EmailSender, get_email_sender
from clientbridge.integrations.oauth import OAuthVerifier, get_oauth_verifier
from clientbridge.models.identity import Staff, User

DbSession = Annotated[AsyncSession, Depends(get_session)]
EmailDep = Annotated[EmailSender, Depends(get_email_sender)]
OAuthVerifierDep = Annotated[OAuthVerifier, Depends(get_oauth_verifier)]


async def current_claims(authorization: str = Header(default="")) -> dict[str, object]:
    if not authorization.startswith("Bearer "):
        raise Unauthorized("missing bearer token")
    try:
        return decode_jwt(authorization.removeprefix("Bearer "))
    except Exception as e:
        raise Unauthorized("invalid token") from e


Claims = Annotated[dict[str, object], Depends(current_claims)]


async def current_user_id(authorization: str = Header(default="")) -> str:
    """Resolve the acting user. In dev, an unauthenticated call falls back to `dev_user_id`."""
    token = (
        authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    )
    if token:
        return str(decode_jwt(token)["sub"])
    if get_settings().env == "dev":
        return get_settings().dev_user_id
    raise Unauthorized("missing bearer token")


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


def require_role(*roles: str) -> Callable[..., Awaitable[Principal]]:
    """Dependency factory: 403 unless the actor's role is one of `roles`."""

    async def _check(principal: CurrentPrincipal) -> Principal:
        if principal.role not in roles:
            raise Forbidden(f"requires one of: {', '.join(roles)}")
        return principal

    return _check
