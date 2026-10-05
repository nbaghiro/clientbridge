"""E2E tier against Stripe test mode; skipped unless STRIPE_TEST_SECRET_KEY is exported."""

import os
from collections.abc import Iterator

import pytest
import stripe

from clientbridge.integrations.payments import StripeGateway

_KEY = os.environ.get("STRIPE_TEST_SECRET_KEY")
_WEBHOOK_SECRET = os.environ.get("STRIPE_TEST_WEBHOOK_SECRET", "whsec_e2e_placeholder")
_CONNECTED_ACCOUNT = os.environ.get("STRIPE_TEST_CONNECTED_ACCOUNT")


@pytest.fixture
def live_gateway() -> Iterator[StripeGateway]:
    if not _KEY:
        pytest.skip("set STRIPE_TEST_SECRET_KEY to run the Stripe test-mode E2E tier")
    previous = stripe.api_base
    stripe.api_base = "https://api.stripe.com"  # in case a contract run left it pointed at the mock
    try:
        yield StripeGateway(_KEY, _WEBHOOK_SECRET, "CA")
    finally:
        stripe.api_base = previous


@pytest.fixture
def connected_account_id() -> str:
    if not _CONNECTED_ACCOUNT:
        pytest.skip(
            "set STRIPE_TEST_CONNECTED_ACCOUNT (a charges-enabled test account) for this test"
        )
    return _CONNECTED_ACCOUNT
