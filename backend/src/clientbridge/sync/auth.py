"""The `/sync` auth surface: mint a PowerSync token from the app session, and serve the JWKS."""

from fastapi import APIRouter, Header

from clientbridge.core.errors import Unauthorized
from clientbridge.core.security import decode_jwt, issue_powersync_token, public_jwk

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/token")
async def sync_token(authorization: str = Header(default="")) -> dict[str, str]:
    """Exchange the app session for a short-lived PowerSync token."""
    # A bare "Bearer" with nothing after it is not a token.
    app_token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if app_token:
        try:
            user_id = str(decode_jwt(app_token)["sub"])
        except Exception as e:
            raise Unauthorized("invalid app token") from e
    else:
        raise Unauthorized("missing bearer token")
    return {"token": issue_powersync_token(user_id)}


@router.get("/keys")
async def jwks() -> dict[str, list[dict[str, str]]]:
    """JWKS for prod PowerSync auth (the service's `jwks_uri`). Serves the RS256 public key."""
    return {"keys": [public_jwk()]}
