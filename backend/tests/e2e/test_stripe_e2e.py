"""Provider contracts against isolated, owned Stripe sandbox objects."""

from uuid import uuid4

import pytest
import stripe
from tests.e2e.conftest import StripeRun

from clientbridge.core import clock
from clientbridge.core.errors import CardDeclined, Conflict
from clientbridge.integrations.stripe import TERMS_REQUIREMENT, StripeGateway, merchant_capability

pytestmark = [pytest.mark.e2e, pytest.mark.wall_clock]


async def test_fresh_v2_account_reports_kyc_requirements(live_gateway: StripeGateway) -> None:
    identity = await live_gateway.create_connected_account(
        business_name="QA Test Co",
        email="payments-qa@clientbridge.test",
        url="https://clientbridge.ca",
        configurations=("merchant",),
        idempotency_key=f"qa-account-{uuid4()}",
    )
    try:
        status = await live_gateway.get_account(identity)
        assert status.charges_enabled is False
        assert status.details_submitted is False
        owed = [*status.currently_due, *status.eventually_due, *status.past_due]
        assert any(code.startswith(TERMS_REQUIREMENT) for code in owed)
    finally:
        await live_gateway.client.v2.core.accounts.close_async(
            identity, {"applied_configurations": ["merchant"]}
        )


async def test_pad_capability_request_is_accepted(stripe_run: StripeRun) -> None:
    gateway, account_id = stripe_run.gateway, stripe_run.account
    try:
        await gateway.ensure_pad_capability(account_id)
    except Conflict as exc:
        assert "requirements" in exc.message
    account = await gateway.client.v2.core.accounts.retrieve_async(
        account_id, {"include": ["configuration.merchant"]}
    )
    pad = merchant_capability(account.to_dict(), "acss_debit_payments")
    assert pad.get("status") in {"pending", "active"}


async def test_pad_setup_has_a_scoped_customer(stripe_run: StripeRun) -> None:
    customer = await stripe_run.customer()
    result = await stripe_run.gateway.create_pad_setup_intent(
        stripe_run.account,
        customer_id=customer,
        idempotency_key=f"{stripe_run.namespace}:pad",
    )
    try:
        setup = await stripe.SetupIntent.retrieve_async(
            result.id, stripe_account=stripe_run.account
        )
        assert setup.customer == customer
        assert setup.payment_method_types == ["acss_debit"]
        assert setup.livemode is False
    finally:
        await stripe.SetupIntent.cancel_async(result.id, stripe_account=stripe_run.account)


async def test_terminal_intent_allows_card_present(stripe_run: StripeRun) -> None:
    result = await stripe_run.gateway.create_terminal_payment_intent(
        stripe_run.account,
        amount_cents=3000,
        currency="cad",
        application_fee_cents=75,
        metadata={"clientbridge_qa": stripe_run.namespace},
        idempotency_key=f"{stripe_run.namespace}:terminal",
    )
    stripe_run.intents.append((stripe_run.account, result.id))
    intent = await stripe.PaymentIntent.retrieve_async(result.id, stripe_account=stripe_run.account)
    assert intent.amount == 3000 and intent.application_fee_amount == 75
    assert "card_present" in intent.payment_method_types
    assert intent.livemode is False


async def test_declined_test_card_maps_to_card_declined(stripe_run: StripeRun) -> None:
    customer = await stripe_run.customer()
    method = await stripe.PaymentMethod.attach_async(
        "pm_card_chargeDeclined", customer=customer, stripe_account=stripe_run.account
    )
    with pytest.raises(CardDeclined):
        await stripe_run.gateway.create_payment_intent(
            stripe_run.account,
            amount_cents=2000,
            currency="cad",
            customer_id=customer,
            application_fee_cents=50,
            metadata={"clientbridge_qa": stripe_run.namespace},
            idempotency_key=f"{stripe_run.namespace}:decline",
            payment_method=method.id,
        )


async def test_subscription_period_fields_match_current_api(stripe_run: StripeRun) -> None:
    account = stripe_run.account
    test_clock = await stripe.test_helpers.TestClock.create_async(
        frozen_time=int(clock.wall().timestamp()),
        name=stripe_run.namespace,
        stripe_account=account,
    )
    stripe_run.clocks.append((account, test_clock.id))
    customer = await stripe.Customer.create_async(test_clock=test_clock.id, stripe_account=account)
    method = await stripe.PaymentMethod.attach_async(
        "pm_card_visa", customer=customer.id, stripe_account=account
    )
    price = await stripe_run.gateway.create_price(
        account,
        amount_cents=4500,
        currency="cad",
        interval_count=1,
        frequency="month",
        product_name="QA Membership",
    )
    stripe_run.prices.append((account, price))
    result = await stripe_run.gateway.create_subscription(
        account,
        customer_id=customer.id,
        price_id=price,
        payment_method_id=method.id,
        metadata={"tax_class": "standard", "clientbridge_qa": stripe_run.namespace},
        application_fee_percent=0.3,
    )
    assert result.current_period_end > clock.wall()


async def test_customer_retry_after_rename_stays_on_the_same_account(stripe_run: StripeRun) -> None:
    customer = await stripe_run.customer()
    retried = await stripe_run.gateway.create_customer(
        stripe_run.account,
        name="Renamed QA Customer",
        email="renamed@clientbridge.test",
        idempotency_key=f"{stripe_run.namespace}:customer:0",
    )
    assert retried == customer
    current = await stripe.Customer.retrieve_async(customer, stripe_account=stripe_run.account)
    assert current.name == "Renamed QA Customer"
    assert current.email == "renamed@clientbridge.test"


async def test_customers_and_methods_cannot_cross_connected_accounts(
    stripe_run: StripeRun, other_account_id: str
) -> None:
    first = await stripe_run.customer()
    second = await stripe_run.customer(other_account_id)
    assert first != second
    method = await stripe.PaymentMethod.attach_async(
        "pm_card_visa", customer=first, stripe_account=stripe_run.account
    )
    with pytest.raises(stripe.InvalidRequestError):
        await stripe.Customer.retrieve_async(first, stripe_account=other_account_id)
    with pytest.raises(stripe.InvalidRequestError):
        await stripe.PaymentMethod.retrieve_async(method.id, stripe_account=other_account_id)
