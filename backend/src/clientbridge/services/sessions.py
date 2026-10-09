from datetime import UTC, datetime

from jwt import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Unauthorized
from clientbridge.core.security import decode_jwt
from clientbridge.models.auth import AuthSession
from clientbridge.models.business import User


async def authenticate_access(db: AsyncSession, authorization: str) -> str:
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not token:
        raise Unauthorized("missing bearer token")
    try:
        claims = decode_jwt(token)
    except InvalidTokenError as exc:
        raise Unauthorized("invalid token") from exc
    user_id = claims.get("sub")
    issued, expires = claims.get("iat"), claims.get("exp")
    if (
        claims.get("type") != "access"
        or not isinstance(user_id, str)
        or not user_id
        or type(issued) is not int
        or type(expires) is not int
    ):
        raise Unauthorized("invalid access token")
    if await db.get(User, user_id) is None:
        raise Unauthorized("user not found")
    family = claims.get("sid")
    if (
        not isinstance(family, str)
        or not family
        or await db.scalar(
            select(AuthSession.id)
            .where(
                AuthSession.family_id == family,
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.now(UTC),
            )
            .limit(1)
        )
        is None
    ):
        raise Unauthorized("session revoked or expired")
    return user_id
