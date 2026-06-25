from fastapi import APIRouter

from clientbridge.core.keys import public_jwk

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/keys")
async def jwks() -> dict[str, list[dict[str, str]]]:
    """JWKS for prod PowerSync auth (the service's `jwks_uri`). Serves the RS256 public key."""
    return {"keys": [public_jwk()]}
