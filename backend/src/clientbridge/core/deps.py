from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import get_session
from clientbridge.core.errors import Unauthorized
from clientbridge.core.security import decode_jwt

DbSession = Annotated[AsyncSession, Depends(get_session)]


async def current_claims(authorization: str = Header(default="")) -> dict[str, object]:
    if not authorization.startswith("Bearer "):
        raise Unauthorized("missing bearer token")
    try:
        return decode_jwt(authorization.removeprefix("Bearer "))
    except Exception as e:
        raise Unauthorized("invalid token") from e


Claims = Annotated[dict[str, object], Depends(current_claims)]
