import base64
import hashlib
import time
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from clientbridge.core.config import get_settings

_ph = PasswordHasher()
RS256_KID = "clientbridge-rs256"


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
        return sign_rs256(payload)
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256", headers={"kid": s.powersync_kid})


# Prod loads a PEM private key from settings; dev/test (no PEM) generates an ephemeral key on first
# use, so the JWKS endpoint + RS256 roundtrip work without any configuration.
@lru_cache
def _private_key() -> rsa.RSAPrivateKey:
    pem = get_settings().powersync_private_key_pem
    if pem:
        key = serialization.load_pem_private_key(pem.encode(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey):
            raise TypeError("powersync_private_key_pem must be an RSA private key")
        return key
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _b64u(value: int) -> str:
    length = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(length, "big")).rstrip(b"=").decode()


def public_jwk() -> dict[str, str]:
    """The RS256 public key as a JWK (what PowerSync fetches via jwks_uri)."""
    numbers = _private_key().public_key().public_numbers()
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": RS256_KID,
        "n": _b64u(numbers.n),
        "e": _b64u(numbers.e),
    }


def sign_rs256(payload: dict[str, object]) -> str:
    return jwt.encode(payload, _private_key(), algorithm="RS256", headers={"kid": RS256_KID})
