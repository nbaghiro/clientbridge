"""Sync identity + JWKS — /sync/token from an auth session, RS256 public key + roundtrip."""

import json

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.security import sign_rs256
from tests.conftest import Factory, FakeIdentityProvider, identity_for, session_token


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
    now = int(clock.wall().timestamp())
    token = sign_rs256({"sub": "us_test", "aud": "powersync", "iat": now, "exp": now + 60})
    jwk = (await api.get("/sync/keys")).json()["keys"][0]
    public_key = RSAAlgorithm.from_jwk(json.dumps(jwk))
    assert isinstance(public_key, RSAPublicKey)
    claims = jwt.decode(token, public_key, algorithms=["RS256"], audience="powersync")
    assert claims["sub"] == "us_test"


async def test_sync_token_minted_from_session(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    res = await api.get(
        "/sync/token",
        headers={"X-Session-Token": await session_token(identities, factory.db, user.id)},
    )
    assert res.status_code == 200
    ps = res.json()["token"]
    s = get_settings()
    claims = jwt.decode(ps, s.jwt_secret, algorithms=["HS256"], audience=s.powersync_audience)
    assert claims["sub"] == user.id


async def test_sync_token_requires_a_session(api: httpx.AsyncClient) -> None:
    for headers in ({}, {"X-Session-Token": "unknown"}, {"Authorization": "Bearer anything"}):
        res = await api.get("/sync/token", headers=headers)
        assert res.status_code == 401, headers
        assert "token" not in res.json()


async def test_sync_token_for_a_new_identity_provisions_the_user(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    template = await factory.user()
    await factory.db.delete(template)
    await factory.db.flush()
    token = identities.issue(identity_for(template, email="fresh-sync@test.ca"))
    res = await api.get("/sync/token", headers={"X-Session-Token": token})
    assert res.status_code == 200
    me = (await api.get("/v1/me", headers={"X-Session-Token": token})).json()
    s = get_settings()
    claims = jwt.decode(
        res.json()["token"], s.jwt_secret, algorithms=["HS256"], audience=s.powersync_audience
    )
    assert claims["sub"] == me["user_id"] and me["email"] == "fresh-sync@test.ca"


async def test_revoked_sessions_cannot_exchange_or_call_api(
    api: httpx.AsyncClient, factory: Factory, identities: FakeIdentityProvider
) -> None:
    user = await factory.user()
    headers = {"X-Session-Token": await session_token(identities, factory.db, user.id)}
    assert (await api.get("/sync/token", headers=headers)).status_code == 200
    identities.end_sessions(user.identity_id)
    assert (await api.get("/sync/token", headers=headers)).status_code == 401
    assert (await api.get("/v1/staff/team", headers=headers)).status_code == 401
