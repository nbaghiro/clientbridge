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


def issue_jwt(*, user_id: str, business_ids: list[str], role: str) -> str:
    """Mint a token for the client. PowerSync validates this (move to RS256 + JWKS for prod)."""
    s = get_settings()
    now = int(time.time())
    payload = {
        "sub": user_id,
        "iss": s.jwt_issuer,
        "iat": now,
        "exp": now + s.jwt_ttl_seconds,
        "business_ids": business_ids,
        "role": role,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_jwt(token: str) -> dict[str, object]:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=["HS256"], issuer=s.jwt_issuer)
