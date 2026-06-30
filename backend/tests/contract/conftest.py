"""Contract tier: the real StripeGateway against stripe-mock (the official OpenAPI mock).

These never hit the fake — they run the production gateway so every request shape is validated
against the live API spec and every response is parsed by our real mapping code. stripe-mock is
stateless
(canned, spec-conformant responses), so we assert shapes, not persisted state. Auto-skips when the
mock isn't running. Start it with `make stripe-mock`; run the tier with `make test-contract`.
"""

import os
import socket
from collections.abc import Iterator
from urllib.parse import urlparse

import pytest
import stripe

from clientbridge.integrations.payments import StripeGateway

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
def contract_gateway() -> Iterator[StripeGateway]:
    if not _reachable(_MOCK_URL):
        pytest.skip(f"stripe-mock unreachable at {_MOCK_URL} — run `make stripe-mock`")
    previous = stripe.api_base
    stripe.api_base = _MOCK_URL
    try:
        yield StripeGateway("sk_test_contract", "whsec_contract", "CA")
    finally:
        stripe.api_base = previous
