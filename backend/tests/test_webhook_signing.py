"""Hermetic checks of the real StripeGateway webhook verification.

These exercise `stripe.Webhook.construct_event` for real (the production path the app fakes), so a
genuinely-signed payload is accepted and a tampered / wrong-secret / stale / malformed one is not.
No network: we sign with the same HMAC scheme Stripe uses and feed it straight to the gateway.
"""

import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest

from clientbridge.integrations.payments import StripeGateway, WebhookVerificationError

SECRET = "whsec_test_kQ7rZ8m2vP1nX4tL6yB0cD3eF5gH9jK"
FIXTURES = Path(__file__).parent / "fixtures" / "stripe"


def _gateway(secret: str = SECRET) -> StripeGateway:
    return StripeGateway("sk_test_unused", secret, "CA")


def _signed_header(payload: bytes, secret: str, *, timestamp: int | None = None) -> str:
    ts = timestamp if timestamp is not None else int(time.time())
    signed = f"{ts}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def _golden(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_accepts_a_genuinely_signed_account_event() -> None:
    payload = _golden("account_updated.json")
    event = _gateway().verify_webhook(payload, _signed_header(payload, SECRET))
    assert event.id == "evt_1NG8Du2eZvKYlo2C8b9Hd0Fb"
    assert event.type == "account.updated"
    assert event.account == "acct_1NG8Du2eZvKYlo2C"
    assert event.data["id"] == "acct_1NG8Du2eZvKYlo2C"


def test_accepts_a_genuinely_signed_payment_event() -> None:
    payload = _golden("payment_intent_succeeded.json")
    event = _gateway().verify_webhook(payload, _signed_header(payload, SECRET))
    assert event.type == "payment_intent.succeeded"
    assert event.data["application_fee_amount"] == 213
    assert event.data["metadata"] == {
        "invoice_id": "inv_birchbark_0042",
        "business_id": "bz_birchbark",
    }


def test_event_without_account_yields_none() -> None:
    payload = json.dumps(
        {
            "id": "evt_x",
            "object": "event",
            "type": "charge.refunded",
            "data": {"object": {"id": "ch_1"}},
        }
    ).encode()
    event = _gateway().verify_webhook(payload, _signed_header(payload, SECRET))
    assert event.account is None


def test_rejects_a_tampered_payload() -> None:
    payload = _golden("account_updated.json")
    header = _signed_header(payload, SECRET)  # signed over the original bytes
    tampered = payload.replace(b"acct_1NG8Du2eZvKYlo2C", b"acct_attacker0000000")
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(tampered, header)


def test_rejects_a_signature_from_the_wrong_secret() -> None:
    payload = _golden("account_updated.json")
    header = _signed_header(payload, "whsec_some_other_secret")
    with pytest.raises(WebhookVerificationError):
        _gateway(SECRET).verify_webhook(payload, header)


def test_rejects_a_stale_timestamp() -> None:
    payload = _golden("account_updated.json")
    header = _signed_header(payload, SECRET, timestamp=int(time.time()) - 1000)  # past tolerance
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(payload, header)


def test_rejects_a_malformed_header() -> None:
    payload = _golden("account_updated.json")
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(payload, "not-a-real-signature")
