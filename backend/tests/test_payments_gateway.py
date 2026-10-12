import pytest
import stripe

from clientbridge.core.errors import Conflict
from clientbridge.integrations.stripe import StripeGateway


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
