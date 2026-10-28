"""Sandbox configuration, result accounting and signed-event isolation."""

import hashlib
import hmac
import json
from pathlib import Path

import httpx
import pytest
import stripe
from fastapi import FastAPI
from scripts.stripe_qa import REQUIRED, environment, results

from clientbridge.core import clock
from clientbridge.integrations.stripe import STRIPE_API_VERSION, StripeGateway, close_stripe_client
from tests.sandbox.conftest import StripeEvents


def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in zip(
        REQUIRED, ("sk_test_qa", "acct_platform", "acct_a", "acct_b"), strict=True
    ):
        monkeypatch.setenv(name, value)


def test_sandbox_requires_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in REQUIRED:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError, match="missing sandbox prerequisites"):
        environment(None)


@pytest.mark.parametrize("value", ["sk_live_not_allowed", "rk_live_not_allowed", "invalid"])
def test_sandbox_rejects_live_or_unknown_keys(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    configured(monkeypatch)
    monkeypatch.setenv("STRIPE_TEST_SECRET_KEY", value)
    with pytest.raises(ValueError, match="only Stripe test-mode"):
        environment(None)


def test_sandbox_requires_distinct_merchants(monkeypatch: pytest.MonkeyPatch) -> None:
    configured(monkeypatch)
    monkeypatch.setenv("STRIPE_TEST_OTHER_ACCOUNT", "acct_a")
    with pytest.raises(ValueError, match="distinct connected accounts"):
        environment(None)


def test_sandbox_forbids_a_developer_profile_in_ci(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI", "true")
    with pytest.raises(ValueError, match="protected environment credentials"):
        environment("clientbridge")


def test_sandbox_sets_required_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    configured(monkeypatch)
    assert environment(None)["STRIPE_E2E_REQUIRED"] == "1"


@pytest.mark.parametrize("child", ["<skipped/>", "<failure/>", "<error/>"])
def test_sandbox_does_not_count_skips_or_failures_as_pass(tmp_path: Path, child: str) -> None:
    report = tmp_path / "junit.xml"
    report.write_text(
        f'<testsuites><testsuite><testcase name="case">{child}</testcase></testsuite></testsuites>'
    )
    assert results(report)["passed"] is False


def test_sandbox_empty_selection_is_not_success(tmp_path: Path) -> None:
    report = tmp_path / "junit.xml"
    report.write_text("<testsuites/>")
    assert results(report)["passed"] is False


def test_sandbox_records_actual_passed_tests(tmp_path: Path) -> None:
    report = tmp_path / "junit.xml"
    report.write_text(
        '<testsuites><testsuite><testcase classname="suite" name="case"/></testsuite></testsuites>'
    )
    assert results(report) == {
        "passed": True,
        "tests": [{"test": "suite::case", "status": "passed"}],
    }


@pytest.mark.parametrize(
    "account,identity,valid,expected",
    [
        ("acct_owned", "pi_owned", True, 1),
        ("acct_other", "pi_owned", True, 0),
        ("acct_owned", "pi_other", True, 0),
        ("acct_owned", "pi_owned", False, 0),
    ],
)
async def test_webhook_capture_checks_signature_account_and_object(
    account: str,
    identity: str,
    valid: bool,
    expected: int,
) -> None:
    previous_key, previous_version = stripe.api_key, stripe.api_version
    try:
        gateway = StripeGateway("sk_test_qa", "whsec_qa", "CA")
        events = StripeEvents(gateway, "acct_owned", {"pi_owned"})
        capture = FastAPI()
        capture.add_api_route("/events", events.capture, methods=["POST"])
        payload = json.dumps(
            {
                "id": "evt_qa",
                "type": "payment_intent.succeeded",
                "account": account,
                "api_version": STRIPE_API_VERSION,
                "data": {"object": {"id": identity}},
            }
        ).encode()
        timestamp = int(clock.wall().timestamp())
        digest = hmac.new(
            b"whsec_qa", str(timestamp).encode() + b"." + payload, hashlib.sha256
        ).hexdigest()
        signature = f"t={timestamp},v1={digest}" if valid else "invalid"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=capture), base_url="http://capture"
        ) as api:
            response = await api.post(
                "/events", content=payload, headers={"stripe-signature": signature}
            )
        assert response.status_code == (204 if valid else 400)
        assert events.queue.qsize() == expected
        if expected:
            assert await events.next("payment_intent.succeeded") == (payload, signature)
    finally:
        await close_stripe_client()
        stripe.api_key, stripe.api_version = previous_key, previous_version


async def test_webhook_wait_preserves_other_event_types() -> None:
    previous_key, previous_version = stripe.api_key, stripe.api_version
    try:
        gateway = StripeGateway("sk_test_qa", "whsec_qa", "CA")
        events = StripeEvents(gateway, "acct_owned", {"pi_owned"})
        signed: list[tuple[bytes, str]] = []
        for kind in ("refund.created", "payment_intent.succeeded"):
            payload = json.dumps(
                {
                    "id": f"evt_{kind}",
                    "type": kind,
                    "account": "acct_owned",
                    "api_version": STRIPE_API_VERSION,
                    "data": {"object": {"id": "pi_owned"}},
                }
            ).encode()
            timestamp = int(clock.wall().timestamp())
            digest = hmac.new(
                b"whsec_qa", str(timestamp).encode() + b"." + payload, hashlib.sha256
            ).hexdigest()
            item = (payload, f"t={timestamp},v1={digest}")
            signed.append(item)
            events.queue.put_nowait(item)
        assert await events.next("payment_intent.succeeded") == signed[1]
        assert await events.next("refund.created") == signed[0]
        assert events.queue.empty()
    finally:
        await close_stripe_client()
        stripe.api_key, stripe.api_version = previous_key, previous_version
