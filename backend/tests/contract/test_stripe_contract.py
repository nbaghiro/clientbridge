"""Every v1 StripeGateway call against stripe-mock; it has no /v2 routes, so v2 calls are e2e."""

import contextlib
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import cast

import pytest
import stripe

from clientbridge.core.errors import Conflict
from clientbridge.integrations.stripe import (
    ChargeFees,
    ConnectComponent,
    PlanItem,
    PlanPriceRef,
    PostalAddress,
    StripeGateway,
    StripeResource,
)

pytestmark = pytest.mark.contract

ACCT = "acct_contract"
CUS = "cus_contract"


async def test_create_customer(contract_gateway: StripeGateway) -> None:
    cus = await contract_gateway.create_customer(
        ACCT, name="Robin Maple", email="robin@x.test", idempotency_key="contract-customer"
    )
    assert cus.startswith("cus_")


async def test_update_customer(contract_gateway: StripeGateway) -> None:
    await contract_gateway.update_customer(ACCT, CUS, name="Robin Oak", email="robin@oak.test")


async def test_lists_undelivered_events(contract_gateway: StripeGateway) -> None:
    since = datetime(2020, 1, 1, tzinfo=UTC)
    missed = await contract_gateway.undelivered_events(ACCT, since=since, limit=5)
    assert len(missed) <= 5
    assert all(e.id.startswith("evt_") and e.object_id for e in missed)


async def test_create_setup_intent(
    contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _recorded(monkeypatch, stripe.SetupIntent)
    result = await contract_gateway.create_setup_intent(ACCT, customer_id=CUS)
    assert result.id.startswith("seti_") and result.client_secret
    (params,) = sent
    assert params["allowed_payment_method_types"] == ["card"]


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


async def test_charges_a_saved_bank_account_under_its_mandate(
    contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _recorded(monkeypatch, stripe.PaymentIntent)
    result = await contract_gateway.create_payment_intent(
        ACCT,
        amount_cents=5000,
        currency="cad",
        customer_id=CUS,
        application_fee_cents=50,
        metadata={"invoice_id": "inv_1"},
        idempotency_key="contract-pi-pad",
        payment_method="pm_contract",
        mandate="mandate_contract",
    )
    assert result.id.startswith("pi_")
    (params,) = sent
    assert params["allowed_payment_method_types"] == ["acss_debit"]
    assert params["mandate"] == "mandate_contract"
    assert "payment_method_types" not in params


async def test_pad_setup_asks_for_a_mandate_that_covers_invoices_and_memberships(
    contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _recorded(monkeypatch, stripe.SetupIntent)
    with contextlib.suppress(Conflict):  # stripe-mock answers with card as the only type
        await contract_gateway.create_pad_setup_intent(
            ACCT,
            customer_id=CUS,
            idempotency_key="contract-pad-setup",
        )
    (params,) = sent
    options = cast(dict[str, dict[str, object]], params["payment_method_options"])
    mandate = cast(dict[str, object], options["acss_debit"]["mandate_options"])
    assert mandate["default_for"] == ["invoice", "subscription"]
    assert "payment_schedule" not in mandate and "interval_description" not in mandate


def _recorded(
    monkeypatch: pytest.MonkeyPatch, resource: type[stripe.PaymentIntent] | type[stripe.SetupIntent]
) -> list[dict[str, object]]:
    """Keep each create's parameters while stripe-mock still validates the request."""
    sent: list[dict[str, object]] = []
    create = cast(Callable[..., Awaitable[object]], resource.create_async)

    async def record(**params: object) -> object:
        sent.append(params)
        return await create(**params)

    monkeypatch.setattr(resource, "create_async", record)
    return sent


async def test_refund(contract_gateway: StripeGateway) -> None:
    result = await contract_gateway.refund(
        ACCT, payment_intent_id="pi_contract", amount_cents=500, idempotency_key="contract-re-1"
    )
    assert result.id.startswith("re_") and result.status


async def test_create_connection_token(contract_gateway: StripeGateway) -> None:
    secret = await contract_gateway.create_connection_token(ACCT, location_id="tml_contract")
    assert isinstance(secret, str) and secret


async def test_delete_terminal_location(contract_gateway: StripeGateway) -> None:
    await contract_gateway.delete_terminal_location(ACCT, location_id="tml_contract")


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
        metadata={"business_id": "bz_contract", "tax_class": "standard"},
        application_fee_percent=0.3,
    )
    assert result.id.startswith("sub_") and result.status


@pytest.mark.parametrize("at_period_end", [False, True])
async def test_cancel_subscription(contract_gateway: StripeGateway, at_period_end: bool) -> None:
    await contract_gateway.cancel_subscription(
        ACCT, subscription_id="sub_contract", at_period_end=at_period_end
    )


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


async def test_register_payment_domains(contract_gateway: StripeGateway) -> None:
    await contract_gateway.register_payment_domains(ACCT, ["book.example.com", "pay.example.com"])


@pytest.mark.parametrize("component", ["onboarding", "account", "notices", "payments", "payouts"])
async def test_create_account_session(
    contract_gateway: StripeGateway, component: ConnectComponent
) -> None:
    secret = await contract_gateway.create_account_session(ACCT, component)
    assert isinstance(secret, str) and secret


def _plan_prices(contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch) -> None:
    # stripe-mock's prices carry no lookup key, so the lookup is answered here
    async def prices(keys: Sequence[str]) -> dict[str, PlanPriceRef]:
        return {key: PlanPriceRef(f"price_{key}", f"prod_{key}", "month") for key in keys}

    monkeypatch.setattr(contract_gateway, "_prices", prices)


async def test_create_plan_checkout(
    contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    _plan_prices(contract_gateway, monkeypatch)
    url = await contract_gateway.create_plan_checkout(
        ACCT,
        items=[PlanItem("premium_month"), PlanItem("seat_month", 2)],
        business_id="bz_contract",
        trial_end=datetime(2030, 1, 1, tzinfo=UTC),
        success_url="https://app.example/setup/plan?checkout=done",
        cancel_url="https://app.example/setup/plan",
        attempt="contract-attempt",
    )
    assert url.startswith("https://")


async def test_close_plan_checkouts(contract_gateway: StripeGateway) -> None:
    paid = await contract_gateway.close_plan_checkouts(ACCT, keep="kept")
    assert paid is None or paid.id.startswith("sub_")


async def test_plan_subscription_calls(
    contract_gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    _plan_prices(contract_gateway, monkeypatch)
    sub = await contract_gateway.get_plan_subscription("sub_contract")
    assert sub.id.startswith("sub_") and sub.status
    changed = await contract_gateway.set_plan_items(
        "sub_contract", items=[PlanItem("team_month")], idempotency_key="contract-plan-1"
    )
    assert changed.id.startswith("sub_")
    assert await contract_gateway.refund_plan_subscription("sub_contract") >= 0
    await contract_gateway.cancel_plan_subscription("sub_contract")


async def test_create_portal_session(contract_gateway: StripeGateway) -> None:
    assert contract_gateway.configured
    gateway = StripeGateway("sk_test_contract", "", "CA", portal_configuration="bpc_contract")
    url = await gateway.create_portal_session(ACCT, return_url="https://app.example/setup/plan")
    assert url.startswith("https://")


@pytest.mark.parametrize(
    "resource, identity",
    [
        ("payment_intent", "pi_contract"),
        ("charge", "ch_contract"),
        ("refund", "re_contract"),
        ("payout", "po_contract"),
        ("dispute", "dp_contract"),
        ("subscription", "sub_contract"),
        ("invoice", "in_contract"),
    ],
)
async def test_retrieve_connected_object(
    contract_gateway: StripeGateway, resource: StripeResource, identity: str
) -> None:
    assert (await contract_gateway.retrieve(ACCT, resource, identity))["id"] == identity


async def test_lists_balance_transactions(contract_gateway: StripeGateway) -> None:
    assert await contract_gateway.balance_transactions(ACCT)


async def test_lists_balance_transactions_by_type(contract_gateway: StripeGateway) -> None:
    rows = await contract_gateway.balance_transactions(ACCT, since=0, kind="refund_failure")
    assert isinstance(rows, list)


async def test_lists_payouts(contract_gateway: StripeGateway) -> None:
    page = await contract_gateway.list_payouts(ACCT)
    assert page.payouts
    assert all(isinstance(row.get("id"), str) for row in page.payouts)


async def test_finds_invoice_from_payment(contract_gateway: StripeGateway) -> None:
    assert await contract_gateway.invoice_for_payment(ACCT, "pi_contract") is not None


async def test_lists_payout_transactions(contract_gateway: StripeGateway) -> None:
    page = await contract_gateway.payout_transactions(ACCT, "po_contract", None)
    assert page.transactions
    assert all(row.net == row.amount - row.fee for row in page.transactions)
