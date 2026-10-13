"""Every v1 StripeGateway call against stripe-mock; it has no /v2 routes, so v2 calls are e2e."""

import pytest
import stripe

from clientbridge.integrations.stripe import (
    ChargeFees,
    ConnectComponent,
    PostalAddress,
    StripeGateway,
)

pytestmark = pytest.mark.contract

ACCT = "acct_contract"
CUS = "cus_contract"


async def test_create_customer(contract_gateway: StripeGateway) -> None:
    cus = await contract_gateway.create_customer(ACCT, name="Robin Maple", email="robin@x.test")
    assert cus.startswith("cus_")


async def test_create_setup_intent(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_setup_intent(ACCT, customer_id=CUS)
    assert result.id.startswith("seti_") and result.client_secret


async def test_create_price(contract_gateway: StripeGateway) -> None:
    price = await contract_gateway.create_price(
        ACCT,
        amount_cents=4500,
        currency="cad",
        interval_count=1,
        frequency="month",
        product_name="Subscription",
    )
    assert price.startswith("price_")


async def test_get_price(contract_gateway: StripeGateway) -> None:
    terms = await contract_gateway.get_price(ACCT, "price_contract")
    assert terms is not None and terms.amount_cents >= 0 and terms.currency


async def test_create_payment_intent(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_payment_intent(
        ACCT,
        amount_cents=8500,
        currency="cad",
        customer_id=CUS,
        application_fee_cents=213,
        metadata={"invoice_id": "inv_1"},
        idempotency_key="contract-pi-1",
    )
    assert result.id.startswith("pi_") and result.client_secret


async def test_refund(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.refund(
        ACCT, payment_intent_id="pi_contract", amount_cents=500, idempotency_key="contract-re-1"
    )
    assert result.id.startswith("re_") and result.status


async def test_create_connection_token(contract_gateway: StripeGateway) -> None:
    secret = await contract_gateway.create_connection_token(ACCT)
    assert isinstance(secret, str) and secret


async def test_create_terminal_location(contract_gateway: StripeGateway) -> None:
    loc = await contract_gateway.create_terminal_location(
        ACCT,
        display_name="Front desk",
        address=PostalAddress(
            line1="100 Queen St W", city="Toronto", province="ON", postal_code="M5H 2N2"
        ),
    )
    assert loc.startswith("tml_")


async def test_create_subscription(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_subscription(
        ACCT,
        customer_id=CUS,
        price_id="price_contract",
        payment_method_id="pm_contract",
        metadata={"tax_class": "standard", "tax_registered": "true"},
    )
    assert result.id.startswith("sub_") and result.status


async def test_cancel_subscription(contract_gateway: StripeGateway) -> None:
    await contract_gateway.cancel_subscription(ACCT, subscription_id="sub_contract")


async def test_detach_payment_method(contract_gateway: StripeGateway) -> None:
    await contract_gateway.detach_payment_method(ACCT, payment_method_id="pm_contract")


async def test_get_payment_fees(contract_gateway: StripeGateway) -> None:
    fees = await contract_gateway.get_payment_fees(ACCT, payment_intent_id="pi_contract")
    if fees is None:  # stripe-mock never expands the charge's balance transaction
        return
    assert isinstance(fees, ChargeFees)
    assert fees.processing_fee_cents >= 0 and fees.application_fee_cents >= 0


async def test_get_balance_cents(contract_gateway: StripeGateway) -> None:
    assert isinstance(await contract_gateway.get_balance_cents(ACCT, currency="CAD"), int)


@pytest.mark.parametrize("component", ["onboarding", "account", "notices", "payments", "payouts"])
async def test_create_account_session(
    contract_gateway: StripeGateway, component: ConnectComponent
) -> None:
    try:
        secret = await contract_gateway.create_account_session(ACCT, component)
    except stripe.InvalidRequestError as exc:
        if "Unrecognized request URL (POST: /v1/account_sessions)" in str(exc):
            pytest.skip(
                "stripe-mock does not implement Account Sessions; test-mode verification required"
            )
        raise
    assert isinstance(secret, str) and secret
