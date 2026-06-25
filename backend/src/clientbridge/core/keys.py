"""RS256 keypair for prod PowerSync auth — the public key is served at the JWKS endpoint.

In prod a PEM private key is loaded from settings; dev/test (no PEM) generates an ephemeral key on
first use, so the JWKS endpoint + RS256 roundtrip tests work without any configuration.
"""

import base64
from functools import lru_cache

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from clientbridge.core.config import get_settings

RS256_KID = "clientbridge-rs256"


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
