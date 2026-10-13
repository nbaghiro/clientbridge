"""Flows only the real Stripe API can prove: KYC shape, real declines, period parsing."""

from uuid import uuid4

import pytest
import stripe

from clientbridge.core.errors import CardDeclined, Conflict
from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
    TERMS_REQUIREMENT,
    StripeGateway,
    merchant_capability,
)

pytestmark = [pytest.mark.e2e, pytest.mark.wall_clock]


async def test_fresh_v2_account_reports_kyc_requirements(live_gateway: StripeGateway) -> None:
    """A new Accounts v2 merchant is not chargeable and lists what Stripe still needs."""
    account_id = await live_gateway.create_connected_account(
        business_name="E2E Test Co",
        email="e2e@clientbridge.test",
        url="https://x.test/book/e2e",
        configurations=("merchant",),
        idempotency_key=f"e2e-account-{uuid4()}",
    )
    status = await live_gateway.get_account(account_id)
    assert status.charges_enabled is False
    assert status.details_submitted is False
    owed = [*status.currently_due, *status.eventually_due, *status.past_due]
    assert any(code.startswith(TERMS_REQUIREMENT) for code in owed)
    url = await live_gateway.create_account_link(
        account_id, refresh_url="https://x.test/refresh", return_url="https://x.test/return"
    )
    assert url.startswith("https://")


async def test_pad_capability_request_is_accepted(
    live_gateway: StripeGateway, connected_account_id: str
) -> None:
    """Stripe accepts the acss_debit_payments request and reviews or enables it."""
    try:
        await live_gateway.ensure_pad_capability(connected_account_id)
    except Conflict as exc:
        assert "requirements" in exc.message  # pending review, not a rejected request
    client = stripe.StripeClient(str(stripe.api_key), stripe_version=STRIPE_API_VERSION)
    account = await client.v2.core.accounts.retrieve_async(
        connected_account_id, {"include": ["configuration.merchant"]}
    )
    pad = merchant_capability(account.to_dict(), "acss_debit_payments")
    assert pad.get("status") in {"pending", "active"}
    if pad.get("status") == "active":
        customer_id = await live_gateway.create_customer(
            connected_account_id, name="PAD Tester", email="pad@x.test"
        )
        result = await live_gateway.create_pad_setup_intent(
            connected_account_id,
            customer_id=customer_id,
            idempotency_key=f"e2e-pad-{uuid4()}",
            interval_description="When an invoice or a scheduled membership payment is due",
        )
        assert result.id.startswith("seti_") and result.client_secret


async def test_terminal_intent_allows_card_present(
    live_gateway: StripeGateway, connected_account_id: str
) -> None:
    """endive takes allowed_payment_method_types and keeps card_present for the reader."""
    result = await live_gateway.create_terminal_payment_intent(
        connected_account_id,
        amount_cents=3000,
        currency="cad",
        application_fee_cents=75,
        metadata={"e2e": "terminal"},
        idempotency_key=f"e2e-terminal-{uuid4()}",
    )
    assert result.id.startswith("pi_") and result.client_secret


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
    """A Test Clock proves `current_period_*` exist at the pinned API version."""
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
        connected_account_id,
        amount_cents=4500,
        currency="cad",
        interval_count=1,
        frequency="month",
        product_name="Subscription",
    )
    result = await live_gateway.create_subscription(
        connected_account_id,
        customer_id=customer.id,
        price_id=price_id,
        payment_method_id="pm_card_visa",
        metadata={"tax_class": "standard", "tax_registered": "true"},
    )
    assert result.current_period_end > result.current_period_start
