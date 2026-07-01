"""The `/sync` auth surface: mint a PowerSync token from the app session, and serve the JWKS."""

from fastapi import APIRouter, Header

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Unauthorized
from clientbridge.core.security import decode_jwt, issue_powersync_token, public_jwk

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/token")
async def sync_token(authorization: str = Header(default="")) -> dict[str, str]:
    """Exchange the app session for a short-lived PowerSync token.

    The client's connector calls this (``fetchCredentials``). In dev, an unauthenticated call
    mints a token for ``dev_user_id`` so the apps can connect before auth exists; in prod a valid
    app JWT is required.
    """
    settings = get_settings()
    # Tolerate a bare "Bearer" (the browser sends "Bearer " with an empty token, which the HTTP
    # layer trims) and any casing — only treat it as a token when there's something after "bearer ".
    app_token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if app_token:
        try:
            user_id = str(decode_jwt(app_token)["sub"])
        except Exception as e:
            raise Unauthorized("invalid app token") from e
    elif settings.env == "dev":
        user_id = settings.dev_user_id
    else:
        raise Unauthorized("missing bearer token")
    return {"token": issue_powersync_token(user_id)}


@router.get("/keys")
async def jwks() -> dict[str, list[dict[str, str]]]:
    """JWKS for prod PowerSync auth (the service's `jwks_uri`). Serves the RS256 public key."""
    return {"keys": [public_jwk()]}
