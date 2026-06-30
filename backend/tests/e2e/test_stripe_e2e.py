"""Stripe test-mode flows — dormant until STRIPE_TEST_SECRET_KEY is set (see conftest).

What lives here is what only the real API can prove: the KYC requirement shape on a fresh Custom
account, real card-decline mapping, and that our subscription period parsing matches the *current*
API version (the gap the pinned-spec mock leaves open).
"""

import pytest
import stripe

from clientbridge.core.errors import CardDeclined
from clientbridge.integrations.payments import StripeGateway

pytestmark = pytest.mark.e2e


async def test_fresh_account_reports_kyc_requirements(live_gateway: StripeGateway) -> None:
    """A brand-new Custom account is not chargeable and lists what Stripe still needs."""
    account_id = await live_gateway.create_connected_account(
        business_name="E2E Test Co", email="e2e@clientbridge.test", url="https://x.test/book/e2e"
    )
    status = await live_gateway.get_account(account_id)
    assert status.charges_enabled is False
    assert status.details_submitted is False
    # a fresh Custom account always owes Stripe onboarding data
    assert status.currently_due or status.eventually_due


async def test_declined_test_card_maps_to_card_declined(
    live_gateway: StripeGateway, connected_account_id: str
) -> None:
    """Stripe's decline test card surfaces as our CardDeclined (a 402 the client can act on)."""
    customer_id = await live_gateway.create_customer(
        connected_account_id, name="Decline Tester", email="decline@x.test"
    )
    # pm_card_chargeDeclined is Stripe's canonical always-declines test payment method
    await stripe.PaymentMethod.attach_async(
        "pm_card_chargeDeclined", customer=customer_id, stripe_account=connected_account_id
    )
    try:
        await live_gateway.create_payment_intent(
            connected_account_id,
            amount_cents=2000,
            currency="cad",
            customer_id=customer_id,
            application_fee_cents=50,
            metadata={"e2e": "decline"},
            idempotency_key="e2e-decline-1",
            payment_method="pm_card_chargeDeclined",
        )
        raise AssertionError("expected the declined card to raise CardDeclined")
    except CardDeclined:
        pass


async def test_subscription_period_fields_match_current_api(
    live_gateway: StripeGateway, connected_account_id: str
) -> None:
    """create_subscription reads `current_period_*`; a Test Clock proves they exist at this API
    version — the drift stripe-mock (pinned spec) can't catch."""
    clock = await stripe.test_helpers.TestClock.create_async(
        frozen_time=1735689600,
        stripe_account=connected_account_id,  # 2025-01-01
    )
    customer = await stripe.Customer.create_async(
        test_clock=clock.id, stripe_account=connected_account_id
    )
    await stripe.PaymentMethod.attach_async(
        "pm_card_visa", customer=customer.id, stripe_account=connected_account_id
    )
    price_id = await live_gateway.create_price(
        connected_account_id, amount_cents=4500, currency="cad", interval_count=1, frequency="month"
    )
    result = await live_gateway.create_subscription(
        connected_account_id,
        customer_id=customer.id,
        price_id=price_id,
        payment_method_id="pm_card_visa",
    )
    assert result.current_period_end > result.current_period_start
