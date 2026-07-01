"""Sync identity + JWKS — /sync/token from session, RS256 public key + roundtrip, prod auth gate."""

import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from clientbridge.core.config import get_settings
from clientbridge.core.security import issue_access_token, sign_rs256
from tests.conftest import Factory


async def test_jwks_endpoint_serves_rsa_public_key(api: httpx.AsyncClient) -> None:
    res = await api.get("/sync/keys")
    assert res.status_code == 200
    keys = res.json()["keys"]
    assert len(keys) == 1
    jwk = keys[0]
    assert jwk["kty"] == "RSA"
    assert jwk["alg"] == "RS256"
    assert jwk["use"] == "sig"
    assert jwk["kid"] and jwk["n"] and jwk["e"]


async def test_rs256_token_verifies_against_jwks(api: httpx.AsyncClient) -> None:
    # exactly what PowerSync does: fetch the JWK, verify an RS256 token's signature with it
    now = int(time.time())
    token = sign_rs256({"sub": "us_test", "aud": "powersync", "iat": now, "exp": now + 60})
    jwk = (await api.get("/sync/keys")).json()["keys"][0]
    public_key = RSAAlgorithm.from_jwk(json.dumps(jwk))
    assert isinstance(public_key, RSAPublicKey)
    claims = jwt.decode(token, public_key, algorithms=["RS256"], audience="powersync")
    assert claims["sub"] == "us_test"


async def test_sync_token_minted_from_session(api: httpx.AsyncClient, factory: Factory) -> None:
    user = await factory.user()
    res = await api.get(
        "/sync/token", headers={"Authorization": f"Bearer {issue_access_token(user.id)}"}
    )
    assert res.status_code == 200
    ps = res.json()["token"]
    s = get_settings()
    claims = jwt.decode(ps, s.jwt_secret, algorithms=["HS256"], audience=s.powersync_audience)
    assert claims["sub"] == user.id


async def test_sync_token_tolerates_empty_bearer(api: httpx.AsyncClient) -> None:
    # the browser sends "Bearer " with an empty token, which the HTTP layer trims to "Bearer"
    for header in ("Bearer", "Bearer ", "bearer "):
        res = await api.get("/sync/token", headers={"Authorization": header})
        assert res.status_code == 200, header
        assert res.json()["token"]


async def test_sync_token_prod_requires_a_real_bearer(
    api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # the empty-bearer dev-user mint is dev-only — outside dev, a missing token must 401
    monkeypatch.setattr(get_settings(), "env", "prod")
    res = await api.get("/sync/token", headers={"Authorization": "Bearer "})
    assert res.status_code == 401


async def test_sync_token_rejects_malformed_token(api: httpx.AsyncClient) -> None:
    res = await api.get("/sync/token", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401
