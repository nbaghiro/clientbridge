"""Every StripeGateway call exercised against stripe-mock — request shapes + response parsing.

A failure here means our adapter sends something the current Stripe spec rejects, or parses a field
that moved/renamed — exactly the drift the fake can't catch.
"""

import pytest

from clientbridge.integrations.payments import ConnectAccount, StripeGateway

pytestmark = pytest.mark.contract

ACCT = "acct_contract"
CUS = "cus_contract"


async def test_create_connected_account(contract_gateway: StripeGateway) -> None:
    acct = await contract_gateway.create_connected_account(
        business_name="Birchbark Pet Studio",
        email="owner@birchbark.test",
        url="https://x.test/book/b",
    )
    assert isinstance(acct, str) and acct.startswith("acct_")


async def test_create_account_link(contract_gateway: StripeGateway) -> None:
    url = await contract_gateway.create_account_link(
        ACCT, refresh_url="https://x.test/refresh", return_url="https://x.test/return"
    )
    assert url.startswith("http")


async def test_get_account(contract_gateway: StripeGateway) -> None:
    status = await contract_gateway.get_account(ACCT)
    assert isinstance(status, ConnectAccount)
    assert isinstance(status.currently_due, list) and isinstance(status.charges_enabled, bool)


async def test_create_customer(contract_gateway: StripeGateway) -> None:
    cus = await contract_gateway.create_customer(ACCT, name="Robin Maple", email="robin@x.test")
    assert cus.startswith("cus_")


async def test_create_setup_intent(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_setup_intent(ACCT, customer_id=CUS)
    assert result.id.startswith("seti_") and result.client_secret


async def test_create_pad_setup_intent(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_pad_setup_intent(ACCT, customer_id=CUS)
    assert result.id.startswith("seti_") and result.client_secret


async def test_create_price(contract_gateway: StripeGateway) -> None:
    price = await contract_gateway.create_price(
        ACCT, amount_cents=4500, currency="cad", interval_count=1, frequency="month"
    )
    assert price.startswith("price_")


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
        ACCT, display_name="Front desk", country="CA", state="ON"
    )
    assert loc.startswith("tml_")


async def test_create_subscription(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_subscription(
        ACCT, customer_id=CUS, price_id="price_contract", payment_method_id="pm_contract"
    )
    assert result.id.startswith("sub_") and result.status


async def test_cancel_subscription(contract_gateway: StripeGateway) -> None:
    await contract_gateway.cancel_subscription(ACCT, subscription_id="sub_contract")


async def test_detach_payment_method(contract_gateway: StripeGateway) -> None:
    await contract_gateway.detach_payment_method(ACCT, payment_method_id="pm_contract")


async def test_create_terminal_payment_intent(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.create_terminal_payment_intent(
        ACCT,
        amount_cents=3000,
        currency="cad",
        application_fee_cents=75,
        metadata={"order_id": "ord_1"},
        idempotency_key="contract-term-1",
    )
    assert result.id.startswith("pi_") and result.client_secret
