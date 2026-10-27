import logging

import httpx
import pytest
import stripe

from clientbridge.integrations.stripe import ConnectComponent
from tests.conftest import FakePaymentGateway

HEADERS = {"request-id": "req_test"}


def _failing(gateway: FakePaymentGateway, monkeypatch: pytest.MonkeyPatch, exc: Exception) -> None:
    async def session(account_id: str, component: ConnectComponent) -> str:
        raise exc

    monkeypatch.setattr(gateway, "create_account_session", session)


@pytest.mark.parametrize(
    ("exc", "status_code", "code"),
    [
        (
            stripe.InvalidRequestError("charge is disputed", None, code="charge_disputed"),
            409,
            "payment_disputed",
        ),
        (
            stripe.InvalidRequestError("amount too small", "amount", code="amount_too_small"),
            422,
            "amount_too_small",
        ),
        (stripe.IdempotencyError("keys were reused"), 409, "idempotency_mismatch"),
        (stripe.CardError("declined", None, "card_declined"), 402, "card_declined"),
        (
            stripe.InvalidRequestError("no such account", "account", code="resource_missing"),
            502,
            "payment_provider_error",
        ),
        (stripe.APIConnectionError("network down"), 502, "payment_provider_error"),
        (stripe.RateLimitError("slow down"), 502, "payment_provider_error"),
    ],
)
async def test_stripe_errors_answer_with_a_stable_code(
    as_owner: httpx.AsyncClient,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
    exc: stripe.StripeError,
    status_code: int,
    code: str,
) -> None:
    _failing(gateway, monkeypatch, exc)
    response = await as_owner.post("/v1/connect/session", json={"component": "payments"})
    assert response.status_code == status_code
    assert response.json()["error"] == code


async def test_stripe_error_hides_stripe_text_and_logs_the_request_id(
    as_owner: httpx.AsyncClient,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    exc = stripe.InvalidRequestError(
        "Secret detail from Stripe", "amount", code="parameter_invalid_integer", headers=HEADERS
    )
    _failing(gateway, monkeypatch, exc)
    with caplog.at_level(logging.WARNING, logger="clientbridge.stripe"):
        response = await as_owner.post("/v1/connect/session", json={"component": "payments"})
    assert response.status_code == 502
    body = response.json()
    assert body["error"] == "payment_provider_error"
    assert "Secret" not in body["message"]
    assert body["message"] == body["message"].lower()
    [record] = [r for r in caplog.records if r.name == "clientbridge.stripe"]
    assert record.levelno == logging.WARNING
    assert "req_test" in record.getMessage()
    assert "parameter_invalid_integer" in record.getMessage()
