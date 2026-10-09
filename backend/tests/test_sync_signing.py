import json
import time

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from pydantic import ValidationError

from clientbridge.core.config import Settings, get_settings
from clientbridge.core.security import issue_powersync_token


def private_pem(key: rsa.RSAPrivateKey) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


@pytest.mark.parametrize(
    "field", ["powersync_use_rs256", "powersync_private_key_pem", "powersync_kid"]
)
def test_production_signing_requires_durable_configuration(field: str) -> None:
    pem = private_pem(rsa.generate_private_key(public_exponent=65537, key_size=2048))
    with pytest.raises(ValidationError, match="POWERSYNC"):
        Settings(
            env="prod",
            jwt_secret="private-test-secret",
            refresh_replay_key=Fernet.generate_key().decode(),
            stripe_webhook_secret="test-webhook",
            powersync_use_rs256=field != "powersync_use_rs256",
            powersync_private_key_pem="" if field == "powersync_private_key_pem" else pem,
            powersync_kid="" if field == "powersync_kid" else "rotation-2026-10",
        )


def test_invalid_or_ambiguous_verification_keys_fail_at_startup() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    for kid, pem in (
        ("clientbridge-dev", public),
        ("", public),
        ("old", private_pem(key)),
        ("old", "broken"),
    ):
        with pytest.raises(ValidationError):
            Settings(powersync_previous_public_keys={kid: pem})


async def test_rotation_serves_both_keys_and_only_signs_with_the_current_key(
    api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    old = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    new = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(settings, "powersync_use_rs256", True)
    monkeypatch.setattr(settings, "powersync_kid", "old-key")
    monkeypatch.setattr(settings, "powersync_private_key_pem", private_pem(old))
    old_token = issue_powersync_token("us_rotation")
    monkeypatch.setattr(settings, "powersync_kid", "new-key")
    monkeypatch.setattr(settings, "powersync_private_key_pem", private_pem(new))
    monkeypatch.setattr(
        settings,
        "powersync_previous_public_keys",
        {
            "old-key": old.public_key()
            .public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
            .decode()
        },
    )
    new_token = issue_powersync_token("us_rotation")
    keys = (await api.get("/sync/keys")).json()["keys"]
    assert {key["kid"] for key in keys} == {"old-key", "new-key"}
    assert jwt.get_unverified_header(new_token)["kid"] == "new-key"
    for token in (old_token, new_token):
        key = next(k for k in keys if k["kid"] == jwt.get_unverified_header(token)["kid"])
        assert "d" not in key
        public = RSAAlgorithm.from_jwk(json.dumps(key))
        assert isinstance(public, rsa.RSAPublicKey)
        claims = jwt.decode(
            token,
            public,
            algorithms=["RS256"],
            audience=settings.powersync_audience,
        )
        assert claims["sub"] == "us_rotation"
        assert claims["exp"] <= int(time.time()) + settings.jwt_ttl_seconds
    monkeypatch.setattr(settings, "powersync_previous_public_keys", {})
    assert len((await api.get("/sync/keys")).json()["keys"]) == 1
