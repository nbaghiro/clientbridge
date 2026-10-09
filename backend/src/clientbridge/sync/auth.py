"""The `/sync` auth surface: mint a PowerSync token from the app session, and serve the JWKS."""

from fastapi import APIRouter

from clientbridge.core.deps import CurrentUserId
from clientbridge.core.security import issue_powersync_token, public_jwks

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/token")
async def sync_token(user_id: CurrentUserId) -> dict[str, str]:
    return {"token": issue_powersync_token(user_id)}


@router.get("/keys")
async def jwks() -> dict[str, list[dict[str, str]]]:
    """JWKS for prod PowerSync auth (the service's `jwks_uri`). Serves the RS256 public key."""
    return {"keys": public_jwks()}
