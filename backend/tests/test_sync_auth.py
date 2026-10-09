"""Sync identity + JWKS — /sync/token from session, RS256 public key + roundtrip, prod auth gate."""

import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from clientbridge.core.config import get_settings
from clientbridge.core.security import sign_rs256
from tests.conftest import Factory, access_token


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
        "/sync/token",
        headers={"Authorization": f"Bearer {await access_token(factory.db, user.id)}"},
    )
    assert res.status_code == 200
    ps = res.json()["token"]
    s = get_settings()
    claims = jwt.decode(ps, s.jwt_secret, algorithms=["HS256"], audience=s.powersync_audience)
    assert claims["sub"] == user.id


async def test_sync_token_rejects_empty_bearer(api: httpx.AsyncClient) -> None:
    # the browser sends "Bearer " with an empty token, which the HTTP layer trims to "Bearer"
    for header in ("Bearer", "Bearer ", "bearer "):
        res = await api.get("/sync/token", headers={"Authorization": header})
        assert res.status_code == 401, header
        assert "token" not in res.json()


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


async def test_sync_token_rejects_wrong_type_and_unknown_user(api: httpx.AsyncClient) -> None:
    settings = get_settings()
    now = int(time.time())
    for subject, kind in (("us_dev", "reset"), ("us_missing_sync", "access")):
        token = jwt.encode(
            {"sub": subject, "type": kind, "iss": settings.jwt_issuer, "iat": now, "exp": now + 60},
            settings.jwt_secret,
            algorithm="HS256",
        )
        res = await api.get("/sync/token", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 401, res.text


async def test_revoked_family_cannot_exchange_or_call_api(
    api: httpx.AsyncClient, factory: Factory
) -> None:
    from clientbridge.services.auth import AuthService

    user = await factory.user()
    pair = await AuthService(factory.db).issue_session(user.id)
    headers = {"Authorization": f"Bearer {pair.access_token}"}
    assert (await api.get("/sync/token", headers=headers)).status_code == 200
    assert (
        await api.post("/auth/logout", json={"refresh_token": pair.refresh_token})
    ).status_code == 204
    assert (await api.get("/sync/token", headers=headers)).status_code == 401
    assert (await api.get("/v1/staff/team", headers=headers)).status_code == 401


async def test_access_requires_a_session_family(api: httpx.AsyncClient) -> None:
    settings = get_settings()
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": "us_dev",
            "type": "access",
            "iss": settings.jwt_issuer,
            "iat": now,
            "exp": now + 60,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    response = await api.get("/sync/token", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401, response.text
