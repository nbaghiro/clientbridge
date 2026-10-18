"""Contract tier: the real StripeGateway against stripe-mock; locally skipped when it is down."""

import os
import socket
from collections.abc import AsyncIterator
from urllib.parse import urlparse

import pytest
import stripe
from tests.helpers import service_missing

from clientbridge.integrations.stripe import StripeGateway, close_stripe_client

_MOCK_URL = os.environ.get("STRIPE_MOCK_URL", "http://localhost:8708")


def _reachable(url: str) -> bool:
    parsed = urlparse(url)
    try:
        with socket.create_connection(
            (parsed.hostname or "localhost", parsed.port or 80), timeout=0.5
        ):
            return True
    except OSError:
        return False


@pytest.fixture
async def contract_gateway() -> AsyncIterator[StripeGateway]:
    if not _reachable(_MOCK_URL):
        service_missing(f"stripe-mock unreachable at {_MOCK_URL}: run `make stripe-mock`")
    previous = stripe.api_base
    stripe.api_base = _MOCK_URL
    try:
        yield StripeGateway("sk_test_contract", "whsec_contract", "CA")
    finally:
        await close_stripe_client()
        stripe.api_base = previous
