"""The real StripeGateway accepts a correctly signed webhook and rejects anything else."""

import hashlib
import hmac
import json
from pathlib import Path

import pytest

from clientbridge.core import clock
from clientbridge.integrations.stripe import StripeGateway, WebhookVerificationError

SECRET = "whsec_test_kQ7rZ8m2vP1nX4tL6yB0cD3eF5gH9jK"
THIN_SECRET = "whsec_test_thin_R4nD0mV2eVeNtDeSt1nAt10n"
PLATFORM_SECRET = "whsec_test_platform_Pl4tF0rMeNdP01nT"
FIXTURES = Path(__file__).parent / "fixtures" / "stripe"
THIN = "account_requirements_updated.json"


def _gateway(secret: str = SECRET, thin_secret: str = THIN_SECRET) -> StripeGateway:
    return StripeGateway("sk_test_unused", secret, "CA", thin_secret, PLATFORM_SECRET)


def _signed_header(payload: bytes, secret: str, *, timestamp: int | None = None) -> str:
    ts = timestamp if timestamp is not None else int(clock.wall().timestamp())
    signed = f"{ts}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def _golden(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_accepts_a_genuinely_signed_thin_account_event() -> None:
    payload = _golden(THIN)
    event = _gateway().verify_webhook(payload, _signed_header(payload, THIN_SECRET))
    assert event.id == "evt_test_65UIRNU7G1XbhCfOim416TgmEI4ASQ3jHxXt8RFwXoeVwO"
    assert event.type == "v2.core.account[requirements].updated"
    assert event.thin is True and event.api_version is None
    assert event.account == "acct_1NG8Du2eZvKYlo2C"


def test_each_kind_of_event_needs_its_own_secret() -> None:
    thin = _golden(THIN)
    snapshot = _golden("payment_intent_succeeded.json")
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(thin, _signed_header(thin, SECRET))
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(snapshot, _signed_header(snapshot, THIN_SECRET))


def test_an_unconfigured_secret_rejects_its_events() -> None:
    thin = _golden(THIN)
    with pytest.raises(WebhookVerificationError, match="no signing secret"):
        _gateway(thin_secret="").verify_webhook(thin, _signed_header(thin, ""))


def test_a_body_that_is_not_an_event_is_rejected() -> None:
    for payload in (b"not json", b"[1, 2]"):
        with pytest.raises(WebhookVerificationError):
            _gateway().verify_webhook(payload, _signed_header(payload, SECRET))


def test_accepts_a_genuinely_signed_payment_event() -> None:
    payload = _golden("payment_intent_succeeded.json")
    event = _gateway().verify_webhook(payload, _signed_header(payload, SECRET))
    assert event.type == "payment_intent.succeeded" and event.thin is False
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
    event = _gateway().verify_webhook(payload, _signed_header(payload, PLATFORM_SECRET))
    assert event.account is None


def test_a_platform_event_needs_the_platform_secret() -> None:
    payload = json.dumps(
        {
            "id": "evt_plan",
            "object": "event",
            "type": "customer.subscription.updated",
            "data": {"object": {"id": "sub_plan", "customer_account": "acct_paying"}},
        }
    ).encode()
    for wrong in (SECRET, THIN_SECRET):
        with pytest.raises(WebhookVerificationError):
            _gateway().verify_webhook(payload, _signed_header(payload, wrong))
    connect = json.loads(payload) | {"account": "acct_paying"}
    connect_payload = json.dumps(connect).encode()
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(connect_payload, _signed_header(connect_payload, PLATFORM_SECRET))
    event = _gateway().verify_webhook(payload, _signed_header(payload, PLATFORM_SECRET))
    assert event.type == "customer.subscription.updated" and event.account is None


def test_rejects_a_tampered_payload() -> None:
    payload = _golden(THIN)
    header = _signed_header(payload, THIN_SECRET)  # signed over the original bytes
    tampered = payload.replace(b"acct_1NG8Du2eZvKYlo2C", b"acct_attacker0000000")
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(tampered, header)


def test_rejects_a_signature_from_the_wrong_secret() -> None:
    payload = _golden("payment_intent_succeeded.json")
    header = _signed_header(payload, "whsec_some_other_secret")
    with pytest.raises(WebhookVerificationError):
        _gateway(SECRET).verify_webhook(payload, header)


def test_rejects_a_stale_timestamp() -> None:
    payload = _golden("payment_intent_succeeded.json")
    header = _signed_header(
        payload, SECRET, timestamp=int(clock.wall().timestamp()) - 1000
    )  # past tolerance
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(payload, header)


def test_rejects_a_malformed_header() -> None:
    payload = _golden("payment_intent_succeeded.json")
    with pytest.raises(WebhookVerificationError):
        _gateway().verify_webhook(payload, "not-a-real-signature")
