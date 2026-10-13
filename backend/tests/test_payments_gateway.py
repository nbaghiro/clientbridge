from datetime import UTC, datetime
from typing import cast

import pytest
import stripe

from clientbridge.core.errors import Conflict, PaymentsNotConfigured
from clientbridge.integrations import stripe as stripe_module
from clientbridge.integrations.stripe import (
    PlanItem,
    PlanPriceRef,
    PostalAddress,
    StripeGateway,
    plan_item_changes,
    plan_subscription_from,
)


def _missing(param: str) -> stripe.InvalidRequestError:
    return stripe.InvalidRequestError(  # type: ignore[no-untyped-call]
        "No such object", param, code="resource_missing"
    )


def _raises(exc: Exception) -> object:
    async def call(*args: object, **kwargs: object) -> object:
        raise exc

    return call


@pytest.fixture
def gateway(monkeypatch: pytest.MonkeyPatch) -> StripeGateway:
    monkeypatch.setattr(stripe, "api_key", stripe.api_key)
    return StripeGateway("sk_test_unit", "", "CA")


async def test_refund_of_a_payment_from_another_account_is_a_conflict(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe.Refund, "create_async", _raises(_missing("payment_intent")))
    with pytest.raises(Conflict):
        await gateway.refund(
            "acct_x", payment_intent_id="pi_old", amount_cents=100, idempotency_key="k"
        )


async def test_cancel_of_a_subscription_from_another_account_is_a_conflict(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe.Subscription, "cancel_async", _raises(_missing("id")))
    with pytest.raises(Conflict):
        await gateway.cancel_subscription("acct_x", subscription_id="sub_old")


async def test_charge_of_a_card_from_another_account_is_a_conflict(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe.PaymentIntent, "create_async", _raises(_missing("payment_method")))
    with pytest.raises(Conflict):
        await gateway.create_payment_intent(
            "acct_x",
            amount_cents=100,
            currency="CAD",
            customer_id="cus_x",
            application_fee_cents=2,
            metadata={},
            idempotency_key="k",
            payment_method="pm_old",
        )


async def test_other_invalid_requests_still_raise(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    invalid = stripe.InvalidRequestError(  # type: ignore[no-untyped-call]
        "Amount too small", "amount", code="amount_too_small"
    )
    monkeypatch.setattr(stripe.Refund, "create_async", _raises(invalid))
    with pytest.raises(stripe.InvalidRequestError):
        await gateway.refund("acct_x", payment_intent_id="pi", amount_cents=1, idempotency_key="k")


PRODUCTS = {
    "premium_month": ("clientbridge_premium", "month"),
    "premium_year": ("clientbridge_premium", "year"),
    "team_month": ("clientbridge_team", "month"),
    "team_year": ("clientbridge_team", "year"),
    "seat_month": ("clientbridge_seat", "month"),
}


def _price(key: str, *, keyed: bool = True) -> dict[str, object]:
    product, interval = PRODUCTS[key]
    return {
        "id": f"price_{key}",
        "object": "price",
        "lookup_key": key if keyed else None,
        "product": product,
        "recurring": {"interval": interval},
    }


def _subscription(*items: tuple[str, str, int]) -> dict[str, object]:
    return {
        "id": "sub_plan",
        "object": "subscription",
        "status": "trialing",
        "customer_account": "acct_paying",
        "metadata": {"business_id": "bz_birchbark"},
        "cancel_at_period_end": False,
        "trial_end": 1_900_000_000,
        "items": {
            "object": "list",
            "data": [
                {
                    "id": item_id,
                    "object": "subscription_item",
                    "quantity": quantity,
                    "current_period_end": 1_900_000_000,
                    "price": _price(key.removesuffix("~"), keyed=not key.endswith("~")),
                }
                for item_id, key, quantity in items
            ],
        },
    }


@pytest.fixture
def prices(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    monkeypatch.setattr(stripe_module, "_PLAN_PRICES", {})
    asked: dict[str, list[str]] = {"keys": []}

    async def list_prices(**params: object) -> stripe.ListObject[stripe.Price]:
        keys = cast(list[str], params["lookup_keys"])
        asked["keys"] += keys
        known = [_price(k) for k in keys if k in PRODUCTS]
        return stripe.ListObject.construct_from({"object": "list", "data": known}, "sk")

    monkeypatch.setattr(stripe.Price, "list_async", list_prices)
    return asked


async def test_plan_checkout_bills_the_account_with_flexible_mode_tax_and_the_trial(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch, prices: dict[str, list[str]]
) -> None:
    captured: dict[str, object] = {}

    async def create(**params: object) -> stripe.checkout.Session:
        captured.update(params)
        return stripe.checkout.Session.construct_from({"id": "cs_1", "url": "https://c"}, "sk")

    monkeypatch.setattr(stripe.checkout.Session, "create_async", create)
    trial_end = datetime(2030, 1, 15, tzinfo=UTC)
    url = await gateway.create_plan_checkout(
        "acct_paying",
        items=[PlanItem("premium_year"), PlanItem("seat_month", 2)],
        business_id="bz_birchbark",
        trial_end=trial_end,
        success_url="https://app/setup/plan?done=1",
        cancel_url="https://app/setup/plan",
        idempotency_key="plan-checkout-1",
    )
    assert url == "https://c"
    assert captured["mode"] == "subscription" and captured["customer_account"] == "acct_paying"
    assert captured["line_items"] == [
        {"price": "price_premium_year", "quantity": 1},
        {"price": "price_seat_month", "quantity": 2},
    ]
    assert captured["subscription_data"] == {
        "billing_mode": {"type": "flexible"},
        "metadata": {"business_id": "bz_birchbark"},
        "trial_end": int(trial_end.timestamp()),
    }
    assert captured["automatic_tax"] == {"enabled": True}
    assert captured["idempotency_key"] == "plan-checkout-1"
    await gateway.create_plan_checkout(
        "acct_paying",
        items=[PlanItem("premium_year")],
        business_id="bz_birchbark",
        trial_end=None,
        success_url="https://app/setup/plan?done=1",
        cancel_url="https://app/setup/plan",
        idempotency_key="plan-checkout-2",
    )
    assert prices["keys"] == ["premium_year", "seat_month"]  # read once per process
    assert "trial_end" not in cast(dict[str, object], captured["subscription_data"])


async def test_a_price_missing_from_stripe_means_billing_is_not_set_up(
    gateway: StripeGateway, prices: dict[str, list[str]]
) -> None:
    with pytest.raises(PaymentsNotConfigured):
        await gateway.create_plan_checkout(
            "acct_paying",
            items=[PlanItem("gone_month")],
            business_id="bz_birchbark",
            trial_end=None,
            success_url="https://app",
            cancel_url="https://app",
            idempotency_key="k",
        )


async def test_portal_uses_our_configuration_and_needs_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def create(**params: object) -> stripe.billing_portal.Session:
        captured.update(params)
        return stripe.billing_portal.Session.construct_from({"url": "https://portal"}, "sk")

    monkeypatch.setattr(stripe.billing_portal.Session, "create_async", create)
    unset = StripeGateway("sk_test_unit", "", "CA")
    with pytest.raises(PaymentsNotConfigured):
        await unset.create_portal_session("acct_paying", return_url="https://app/setup/plan")
    gateway = StripeGateway("sk_test_unit", "", "CA", portal_configuration="bpc_ours")
    url = await gateway.create_portal_session("acct_paying", return_url="https://app/setup/plan")
    assert url == "https://portal"
    assert captured == {
        "customer_account": "acct_paying",
        "configuration": "bpc_ours",
        "return_url": "https://app/setup/plan",
    }


async def test_plan_change_swaps_the_price_and_drops_the_seat_item(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch, prices: dict[str, list[str]]
) -> None:
    current = _subscription(("si_plan", "premium_month", 1), ("si_seat", "seat_month", 3))
    captured: dict[str, object] = {}

    async def retrieve(subscription_id: str, **params: object) -> stripe.Subscription:
        return stripe.Subscription.construct_from(current, "sk")

    async def modify(subscription_id: str, **params: object) -> stripe.Subscription:
        captured.update(params)
        return stripe.Subscription.construct_from(_subscription(("si_team", "team_month", 1)), "sk")

    monkeypatch.setattr(stripe.Subscription, "retrieve_async", retrieve)
    monkeypatch.setattr(stripe.Subscription, "modify_async", modify)
    result = await gateway.set_plan_items(
        "sub_plan", items=[PlanItem("team_month")], idempotency_key="plan-change-1"
    )
    assert captured["items"] == [
        {"id": "si_plan", "deleted": True},
        {"id": "si_seat", "deleted": True},
        {"price": "price_team_month", "quantity": 1},
    ]
    assert captured["proration_behavior"] == "create_prorations"
    assert captured["idempotency_key"] == "plan-change-1"
    assert [(i.product, i.interval) for i in result.items] == [("clientbridge_team", "month")]
    fetched = await gateway.get_plan_subscription("sub_plan")
    assert [(i.product, i.quantity) for i in fetched.items] == [
        ("clientbridge_premium", 1),
        ("clientbridge_seat", 3),
    ]


def test_seat_changes_keep_the_items_that_stay() -> None:
    current = _subscription(("si_plan", "premium_month", 1), ("si_seat", "seat_month", 3))
    refs = {key: PlanPriceRef(f"price_{key}", *PRODUCTS[key]) for key in PRODUCTS}
    keep = [PlanItem("premium_month"), PlanItem("seat_month", 4)]
    assert plan_item_changes(current, keep, refs) == [{"id": "si_seat", "quantity": 4}]
    first_seat = plan_item_changes(_subscription(("si_plan", "premium_month", 1)), keep, refs)
    assert first_seat == [{"price": "price_seat_month", "quantity": 4}]


def test_a_platform_subscription_parses_with_its_business_and_items() -> None:
    sub = plan_subscription_from(
        _subscription(("si_plan", "premium_year", 1), ("si_seat", "seat_month", 2))
    )
    assert sub.customer_account == "acct_paying" and sub.business_id == "bz_birchbark"
    assert [(i.product, i.interval, i.quantity) for i in sub.items] == [
        ("clientbridge_premium", "year", 1),
        ("clientbridge_seat", "month", 2),
    ]
    assert sub.current_period_end == datetime.fromtimestamp(1_900_000_000, tz=UTC)
    assert sub.trial_end == sub.current_period_end and sub.cancel_at_period_end is False


ADDRESS = PostalAddress("1207 Government Street", "Victoria", "BC", "V8W 1Y9")


@pytest.mark.parametrize(
    ("identity", "sets_address"),
    [
        ({}, True),
        ({"individual": {"address": {"line1": "1 Main St"}}}, False),
        ({"business_details": {"address": {"line1": "1 Main St"}}}, False),
    ],
)
async def test_customer_configuration_keeps_a_verified_address(
    gateway: StripeGateway,
    monkeypatch: pytest.MonkeyPatch,
    identity: dict[str, object],
    sets_address: bool,
) -> None:
    accounts = gateway._client.v2.core.accounts
    updates: list[dict[str, object]] = []

    async def retrieve(account_id: str, params: object = None) -> stripe.StripeObject:
        return stripe.StripeObject.construct_from({"id": account_id, "identity": identity}, "sk")

    async def update(account_id: str, params: dict[str, object]) -> None:
        updates.append(params)

    monkeypatch.setattr(accounts, "retrieve_async", retrieve)
    monkeypatch.setattr(accounts, "update_async", update)
    await gateway.add_customer_configuration("acct_x", address=ADDRESS)
    (body,) = updates
    assert body["configuration"] == {
        "customer": {"capabilities": {"automatic_indirect_tax": {"requested": True}}}
    }
    expected = {
        "business_details": {
            "address": {
                "line1": "1207 Government Street",
                "city": "Victoria",
                "state": "BC",
                "postal_code": "V8W 1Y9",
                "country": "CA",
            }
        }
    }
    assert body.get("identity") == (expected if sets_address else None)


def test_a_subscriber_keeps_their_plan_item_after_its_lookup_key_moves() -> None:
    # "~" marks an old price whose lookup key moved to a new price with transfer_lookup_key
    current = _subscription(("si_plan", "premium_month~", 1), ("si_seat", "seat_month", 3))
    sub = plan_subscription_from(current)
    assert [(i.product, i.interval, i.quantity) for i in sub.items] == [
        ("clientbridge_premium", "month", 1),
        ("clientbridge_seat", "month", 3),
    ]
    refs = {key: PlanPriceRef(f"price_new_{key}", *PRODUCTS[key]) for key in PRODUCTS}
    wanted = [PlanItem("premium_month"), PlanItem("seat_month", 4)]
    assert plan_item_changes(current, wanted, refs) == [{"id": "si_seat", "quantity": 4}]
    yearly = plan_item_changes(current, [PlanItem("premium_year")], refs)
    assert yearly == [
        {"id": "si_plan", "deleted": True},
        {"id": "si_seat", "deleted": True},
        {"price": "price_new_premium_year", "quantity": 1},
    ]
