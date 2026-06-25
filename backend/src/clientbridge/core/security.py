import hashlib
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from clientbridge.core.config import get_settings

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except VerifyMismatchError:
        return False


def issue_access_token(user_id: str) -> str:
    """Short-lived app access token. Business/role are re-derived from the DB per request."""
    s = get_settings()
    now = int(time.time())
    payload = {
        "sub": user_id,
        "type": "access",
        "iss": s.jwt_issuer,
        "iat": now,
        "exp": now + s.access_token_ttl_seconds,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def hash_token(token: str) -> str:
    """SHA-256 of an opaque high-entropy token (refresh / one-time) — stored instead of the raw."""
    return hashlib.sha256(token.encode()).hexdigest()


def decode_jwt(token: str) -> dict[str, object]:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=["HS256"], issuer=s.jwt_issuer)


def issue_powersync_token(user_id: str) -> str:
    """Short-lived token the client presents to the PowerSync service (HS256, aud=powersync).

    PowerSync reads `sub` as the user id; the sync rules derive the user's businesses/role from the
    `staff` table. (Move to RS256 + JWKS for prod.)
    """
    s = get_settings()
    now = int(time.time())
    payload: dict[str, object] = {
        "sub": user_id,
        "aud": s.powersync_audience,
        "iat": now,
        "exp": now + s.jwt_ttl_seconds,
    }
    if s.powersync_use_rs256:  # prod: RS256, verified by PowerSync via the JWKS endpoint
        from clientbridge.core.keys import sign_rs256

        return sign_rs256(payload)
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256", headers={"kid": s.powersync_kid})
