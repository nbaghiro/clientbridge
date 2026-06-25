"""OAuth verification adapter (Google). Prod verifies a real id_token against Google's certs; tests
inject a fake returning a fixed profile (the boundary pattern; see .docs/testing.md)."""

import asyncio
from dataclasses import dataclass
from typing import Protocol

import jwt

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Unauthorized

_GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"]


@dataclass(frozen=True)
class OAuthProfile:
    email: str
    email_verified: bool
    name: str | None
    sub: str  # the provider's stable user id


class OAuthVerifier(Protocol):
    async def verify_google(self, id_token: str) -> OAuthProfile: ...


class GoogleOAuthVerifier:  # pragma: no cover — network/prod path, faked in tests
    def __init__(self) -> None:
        self._jwks = jwt.PyJWKClient(_GOOGLE_CERTS)

    async def verify_google(self, id_token: str) -> OAuthProfile:
        try:
            claims = await asyncio.to_thread(self._decode, id_token)
        except Exception as e:
            raise Unauthorized("invalid google token") from e
        name = claims.get("name")
        return OAuthProfile(
            email=str(claims["email"]),
            email_verified=bool(claims.get("email_verified", False)),
            name=name if isinstance(name, str) else None,
            sub=str(claims["sub"]),
        )

    def _decode(self, id_token: str) -> dict[str, object]:
        key = self._jwks.get_signing_key_from_jwt(id_token).key
        claims: dict[str, object] = jwt.decode(
            id_token, key, algorithms=["RS256"], audience=get_settings().google_client_id
        )
        if claims.get("iss") not in _GOOGLE_ISSUERS:
            raise jwt.InvalidIssuerError("unexpected issuer")
        return claims


def get_oauth_verifier() -> OAuthVerifier:  # pragma: no cover — overridden by the fake in tests
    return GoogleOAuthVerifier()
