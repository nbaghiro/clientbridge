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
    return stripe.InvalidRequestError("No such object", param, code="resource_missing")


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
    invalid = stripe.InvalidRequestError("Amount too small", "amount", code="amount_too_small")
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
        items=[PlanItem("premium_month"), PlanItem("seat_month", 2)],
        business_id="bz_birchbark",
        trial_end=trial_end,
        success_url="https://app/setup/plan?done=1",
        cancel_url="https://app/setup/plan",
        attempt="1",
    )
    assert url == "https://c"
    assert captured["mode"] == "subscription" and captured["customer_account"] == "acct_paying"
    assert captured["line_items"] == [
        {"price": "price_premium_month", "quantity": 1},
        {"price": "price_seat_month", "quantity": 2},
    ]
    assert captured["subscription_data"] == {
        "billing_mode": {"type": "flexible"},
        "metadata": {"business_id": "bz_birchbark"},
        "trial_end": int(trial_end.timestamp()),
    }
    assert captured["automatic_tax"] == {"enabled": True}
    assert captured["idempotency_key"] == "plan-checkout:bz_birchbark:1"
    await gateway.create_plan_checkout(
        "acct_paying",
        items=[PlanItem("premium_year")],
        business_id="bz_birchbark",
        trial_end=None,
        success_url="https://app/setup/plan?done=1",
        cancel_url="https://app/setup/plan",
        attempt="2",
    )
    assert prices["keys"] == ["premium_month", "seat_month", "premium_year"]
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
            attempt="k",
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
    assert str(captured["idempotency_key"]).startswith("plan-change-1:")
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
    assert sub.items[0].current_period_end == datetime.fromtimestamp(1_900_000_000, tz=UTC)
    assert sub.trial_end == sub.items[0].current_period_end and not sub.cancel_at_period_end


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
    accounts = gateway.client.v2.core.accounts
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


async def test_plan_items_already_in_place_send_nothing_and_changes_key_on_their_body(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch, prices: dict[str, list[str]]
) -> None:
    current = _subscription(("si_plan", "premium_month", 1), ("si_seat", "seat_month", 3))
    sent: list[dict[str, object]] = []

    async def retrieve(subscription_id: str, **params: object) -> stripe.Subscription:
        return stripe.Subscription.construct_from(current, "sk")

    async def modify(subscription_id: str, **params: object) -> stripe.Subscription:
        sent.append(params)
        return stripe.Subscription.construct_from(current, "sk")

    monkeypatch.setattr(stripe.Subscription, "retrieve_async", retrieve)
    monkeypatch.setattr(stripe.Subscription, "modify_async", modify)
    same = [PlanItem("premium_month"), PlanItem("seat_month", 3)]
    await gateway.set_plan_items("sub_plan", items=same, idempotency_key="seats")
    assert sent == []
    for seats in (4, 5):
        more = [PlanItem("premium_month"), PlanItem("seat_month", seats)]
        await gateway.set_plan_items("sub_plan", items=more, idempotency_key="seats")
    first, second = (str(params["idempotency_key"]) for params in sent)
    assert first.startswith("seats:") and second.startswith("seats:") and first != second


async def test_a_price_gone_from_stripe_reads_as_none(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stripe.Price, "retrieve_async", _raises(_missing("price")))
    assert await gateway.get_price("acct_x", "price_deleted") is None


def test_gateways_share_one_stripe_client_per_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stripe, "api_key", stripe.api_key)
    first = StripeGateway("sk_test_shared", "", "CA")
    second = StripeGateway("sk_test_shared", "", "CA")
    other = StripeGateway("sk_test_other", "", "CA")
    assert first.client is second.client and first.client is not other.client


async def test_closing_plan_checkouts_expires_other_tabs_and_finds_a_paid_one(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    def session(sid: str, attempt: str, sub: str | None = None) -> dict[str, object]:
        return {
            "id": sid,
            "object": "checkout.session",
            "mode": "subscription",
            "metadata": {"attempt": attempt},
            "subscription": sub,
        }

    listed = {
        "open": [session("cs_other", "a"), session("cs_mine", "b")],
        "complete": [session("cs_done", "c", "sub_done")],
    }
    expired: list[str] = []

    async def list_sessions(**params: object) -> stripe.ListObject[stripe.checkout.Session]:
        rows = listed[str(params["status"])]
        return stripe.ListObject.construct_from({"object": "list", "data": rows}, "sk")

    async def expire(session_id: str, **params: object) -> None:
        expired.append(session_id)

    async def retrieve(subscription_id: str, **params: object) -> stripe.Subscription:
        status = {"sub_done": "active", "sub_unpaid": "unpaid"}.get(subscription_id, "canceled")
        return stripe.Subscription.construct_from({"id": subscription_id, "status": status}, "sk")

    monkeypatch.setattr(stripe.checkout.Session, "list_async", list_sessions)
    monkeypatch.setattr(stripe.checkout.Session, "expire_async", expire)
    monkeypatch.setattr(stripe.Subscription, "retrieve_async", retrieve)
    assert await gateway.close_plan_checkouts("acct_paying", keep="b") is True
    assert expired == ["cs_other"]
    listed["complete"] = [session("cs_old", "d", "sub_old")]
    assert await gateway.close_plan_checkouts("acct_paying", keep="b") is False
    # Stripe stops billing an unpaid subscription, so it does not block a new Checkout
    listed["complete"] = [session("cs_unpaid", "e", "sub_unpaid")]
    assert await gateway.close_plan_checkouts("acct_paying", keep="b") is False


async def test_a_duplicate_plan_subscription_refunds_each_paid_invoice_payment(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    refunds: list[tuple[str, str]] = []

    async def list_invoices(**params: object) -> stripe.ListObject[stripe.Invoice]:
        assert params["subscription"] == "sub_dup" and params["status"] == "paid"
        rows = [{"id": "in_first", "object": "invoice"}]
        return stripe.ListObject.construct_from({"object": "list", "data": rows}, "sk")

    async def list_payments(**params: object) -> stripe.ListObject[stripe.InvoicePayment]:
        rows = [
            {
                "id": "inpay_1",
                "object": "invoice_payment",
                "payment": {"type": "payment_intent", "payment_intent": "pi_first"},
            },
            {"id": "inpay_2", "object": "invoice_payment", "payment": {"type": "charge"}},
        ]
        return stripe.ListObject.construct_from({"object": "list", "data": rows}, "sk")

    async def refund(**params: object) -> stripe.Refund:
        refunds.append((str(params["payment_intent"]), str(params["idempotency_key"])))
        return stripe.Refund.construct_from({"id": "re_1", "amount": 5649}, "sk")

    monkeypatch.setattr(stripe.Invoice, "list_async", list_invoices)
    monkeypatch.setattr(stripe.InvoicePayment, "list_async", list_payments)
    monkeypatch.setattr(stripe.Refund, "create_async", refund)
    assert await gateway.refund_plan_subscription("sub_dup") == 5649
    assert refunds == [("pi_first", "plan-duplicate:pi_first")]


async def test_shutdown_replaces_stripe_clients_and_transport() -> None:
    first = StripeGateway("sk_test_lifecycle", "", "CA")
    transport = stripe.default_http_client
    await stripe_module.close_stripe_client()
    assert stripe.default_http_client is None
    second = StripeGateway("sk_test_lifecycle", "", "CA")
    assert second.client is not first.client
    assert stripe.default_http_client is not transport
    await stripe_module.close_stripe_client()
    await stripe_module.close_stripe_client()


async def test_customer_creation_has_a_stable_provider_key(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, object]] = []
    updates: list[dict[str, object]] = []

    async def create(**kwargs: object) -> stripe.Customer:
        calls.append(kwargs)
        return stripe.Customer.construct_from({"id": "cus_client"}, "sk_test_unit")

    async def update(identity: str, **kwargs: object) -> stripe.Customer:
        assert identity == "cus_client"
        updates.append(kwargs)
        return stripe.Customer.construct_from({"id": identity}, "sk_test_unit")

    monkeypatch.setattr(stripe.Customer, "create_async", create)
    monkeypatch.setattr(stripe.Customer, "modify_async", update)
    for name in ("Robin", "Robin Updated"):
        assert (
            await gateway.create_customer(
                "acct_business", name=name, email=None, idempotency_key="customer:bz_one:cl_one"
            )
            == "cus_client"
        )
    assert calls[0] == calls[1]
    assert "name" not in calls[0] and "email" not in calls[0]
    assert calls[0]["stripe_account"] == "acct_business"
    assert calls[0]["idempotency_key"] == "customer:bz_one:cl_one"
    assert updates[-1]["name"] == "Robin Updated"


async def test_available_balance_excludes_pending_funds(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def retrieve(**kwargs: object) -> stripe.Balance:
        assert kwargs["stripe_account"] == "acct_business"
        return stripe.Balance.construct_from(
            {
                "available": [{"currency": "cad", "amount": 400}],
                "pending": [{"currency": "cad", "amount": 600}],
            },
            "sk_test_unit",
        )

    monkeypatch.setattr(stripe.Balance, "retrieve_async", retrieve)
    assert (await gateway.get_balance("acct_business", currency="CAD")).available_cents == 400
    assert await gateway.get_balance_cents("acct_business", currency="CAD") == 1000


async def test_terminal_charge_attaches_the_business_customer(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def create(**kwargs: object) -> stripe.PaymentIntent:
        assert kwargs["stripe_account"] == "acct_business"
        assert kwargs["customer"] == "cus_client"
        return stripe.PaymentIntent.construct_from(
            {"id": "pi_sale", "client_secret": "secret", "payment_method_types": ["card_present"]},
            "sk_test_unit",
        )

    monkeypatch.setattr(stripe.PaymentIntent, "create_async", create)
    await gateway.create_terminal_payment_intent(
        "acct_business",
        amount_cents=1000,
        currency="CAD",
        application_fee_cents=20,
        metadata={},
        idempotency_key="sale",
        customer_id="cus_client",
    )


async def test_payout_list_reads_only_the_recent_page(
    gateway: StripeGateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, object]] = []

    async def listing(**kwargs: object) -> stripe.ListObject[stripe.Payout]:
        calls.append(kwargs)
        return stripe.ListObject[stripe.Payout].construct_from(
            {"data": [{"id": "po_recent", "object": "payout"}], "has_more": True}, "sk_test_unit"
        )

    monkeypatch.setattr(stripe.Payout, "list_async", listing)
    assert await gateway.list_payouts("acct_business") == [{"id": "po_recent", "object": "payout"}]
    assert calls == [{"stripe_account": "acct_business", "limit": 24}]
