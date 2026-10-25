"""Verify sandbox deposit fixture ownership without provider or database writes."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
import stripe
from pydantic import ValidationError
from scripts import e2e_stripe_deposits as deposits
from scripts.e2e_stripe_recover import Manifest
from scripts.e2e_stripe_setup import cleanup_intent


def state() -> dict[str, object]:
    return {
        "run_id": str(uuid4()),
        "account": "acct_owned",
        "platform": "acct_platform",
        "business": "bz_birchbark",
        "database": {},
        "fixtures": [],
        "deposit_fixtures": [
            {
                "booking": "bk_owned",
                "client": "cl_owned",
                "customer": "cus_owned",
                "amount_cents": 2000,
                "currency": "CAD",
            }
        ],
    }


@pytest.mark.parametrize("field,value", [("amount_cents", 2001), ("currency", "USD")])
def test_deposit_fixture_requires_exact_supported_amount(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        deposits.DepositFixture.model_validate(
            {"booking": "bk_owned", "client": "cl_owned", field: value}
        )


def test_deposit_recovery_requires_complete_distinct_lineage() -> None:
    manifest = state()
    assert Manifest.model_validate(manifest).deposit_fixtures[0].booking == "bk_owned"
    manifest["deposit_fixtures"] = [{"booking": "bk_owned", "client": "cl_owned"}]
    with pytest.raises(ValueError, match="incomplete"):
        deposits.deposit_fixtures(manifest, complete=True)
    with pytest.raises(ValidationError, match="incomplete"):
        Manifest.model_validate(manifest)
    manifest = state()
    manifest["fixtures"] = [{"invoice": "inv_owned", "client": "cl_owned", "customer": "cus_owned"}]
    with pytest.raises(ValidationError, match="overlaps"):
        Manifest.model_validate(manifest)


@pytest.mark.asyncio
async def test_customer_boundary_persists_lineage_before_ambiguous_provider_write(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    path = tmp_path / "stripe-fixtures.json"
    manifest = state()
    fixture = deposits.DepositFixture(booking="bk_owned", client="cl_owned")
    manifest["deposit_fixtures"] = [fixture.model_dump(exclude_none=True)]

    async def create(**kwargs: object) -> stripe.Customer:
        saved = json.loads(path.read_text())
        assert saved["deposit_fixtures"] == [
            {"booking": "bk_owned", "client": "cl_owned", "amount_cents": 2000, "currency": "CAD"}
        ]
        assert kwargs["metadata"] == deposits.deposit_tags(
            str(manifest["run_id"]), "bk_owned", "cl_owned"
        )
        raise OSError("ambiguous provider response")

    monkeypatch.setattr(stripe.Customer, "create_async", create)
    with pytest.raises(OSError, match="ambiguous"):
        await deposits.create_deposit_customer(
            path, manifest, fixture, "acct_owned", "Sophie Bennett", "sophie@example.ca"
        )
    with pytest.raises(ValueError, match="incomplete"):
        deposits.deposit_fixtures(json.loads(path.read_text()), complete=True)


@pytest.mark.asyncio
async def test_fully_refunded_deposit_cleanup_does_not_refund_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    intent = stripe.PaymentIntent.construct_from(
        {
            "id": "pi_owned",
            "livemode": False,
            "status": "succeeded",
            "amount": 2000,
            "latest_charge": "ch_owned",
        },
        None,
    )

    async def charge(*args: object, **kwargs: object) -> stripe.Charge:
        return stripe.Charge.construct_from(
            {
                "id": "ch_owned",
                "livemode": False,
                "payment_intent": "pi_owned",
                "amount": 2000,
                "amount_refunded": 2000,
            },
            None,
        )

    async def refunds(**kwargs: object) -> stripe.ListObject[stripe.Refund]:
        return stripe.ListObject[stripe.Refund].construct_from(
            {
                "object": "list",
                "data": [
                    {"id": "re_owned", "object": "refund", "status": "succeeded", "amount": 2000}
                ],
                "has_more": False,
            },
            None,
        )

    async def forbidden(**kwargs: object) -> stripe.Refund:
        pytest.fail("already-refunded deposit must not create another refund")

    monkeypatch.setattr(stripe.Charge, "retrieve_async", charge)
    monkeypatch.setattr(stripe.Refund, "list_async", refunds)
    monkeypatch.setattr(stripe.Refund, "create_async", forbidden)
    assert await cleanup_intent(
        "acct_owned", intent, deposits.deposit_tags("run", "bk_owned", "cl_owned")
    ) == {"intent": "pi_owned", "status": "already_refunded"}


@pytest.mark.parametrize(
    "changed",
    [
        {"livemode": True},
        {"customer": "cus_other"},
        {"amount": 2001},
        {"currency": "usd"},
        {"metadata": {"booking_id": "bk_other", "business_id": "bz_birchbark"}},
        {"metadata": {"booking_id": "bk_owned", "business_id": "bz_other"}},
        {
            "metadata": {
                "booking_id": "bk_owned",
                "business_id": "bz_birchbark",
                "invoice_id": "inv_other",
            }
        },
    ],
)
def test_deposit_cleanup_and_recovery_refuse_unrelated_intent(changed: dict[str, object]) -> None:
    values: dict[str, object] = {
        "id": "pi_owned",
        "livemode": False,
        "customer": "cus_owned",
        "amount": 2000,
        "currency": "cad",
        "metadata": {"booking_id": "bk_owned", "business_id": "bz_birchbark"},
    }
    values.update(changed)
    fixture = deposits.load_deposit(state(), "bk_owned")
    with pytest.raises(ValueError, match="unrelated"):
        deposits.validate_deposit_intent(stripe.PaymentIntent.construct_from(values, None), fixture)


def test_deposit_resend_requires_exact_booking_lineage() -> None:
    from scripts.e2e_stripe_delivery import delivery_tags

    manifest = state()
    intent: dict[str, object] = {
        "customer": "cus_owned",
        "amount": 2000,
        "currency": "cad",
        "metadata": {"booking_id": "bk_owned", "business_id": "bz_birchbark"},
    }
    assert delivery_tags(manifest, intent) == deposits.deposit_tags(
        str(manifest["run_id"]), "bk_owned", "cl_owned"
    )
    intent["metadata"] = {
        "booking_id": "bk_owned",
        "business_id": "bz_birchbark",
        "invoice_id": "inv_other",
    }
    with pytest.raises(ValueError, match="ambiguous"):
        delivery_tags(manifest, intent)
    intent["metadata"] = {"booking_id": "bk_other", "business_id": "bz_birchbark"}
    with pytest.raises(ValueError, match="registered"):
        delivery_tags(manifest, intent)


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_booking", [False, True])
async def test_deposit_recovery_cancels_only_exact_owned_intent(
    monkeypatch: pytest.MonkeyPatch, wrong_booking: bool
) -> None:
    from scripts.e2e_stripe_recover import recover

    manifest = Manifest.model_validate(state())
    env = {
        "STRIPE_TEST_PLATFORM": "acct_platform",
        "STRIPE_TEST_CONNECTED_ACCOUNT": "acct_owned",
        "STRIPE_TEST_OTHER_ACCOUNT": "acct_other",
        "STRIPE_TEST_SECRET_KEY": "sk_test_synthetic_fixture",
    }
    operations: list[str] = []
    payment = stripe.PaymentIntent.construct_from(
        {
            "id": "pi_owned",
            "object": "payment_intent",
            "livemode": False,
            "status": "requires_payment_method",
            "customer": "cus_owned",
            "amount": 2000,
            "currency": "cad",
            "metadata": {
                "booking_id": "bk_other" if wrong_booking else "bk_owned",
                "business_id": "bz_birchbark",
            },
        },
        None,
    )

    async def account(identity: str | None = None) -> stripe.Account:
        return stripe.Account.construct_from(
            {
                "id": identity or "acct_platform",
                "metadata": {
                    "clientbridge_qa": "payments",
                    "clientbridge_qa_environment": "local",
                    "clientbridge_qa_slot": "a" if identity == "acct_owned" else "b",
                },
            },
            None,
        )

    async def balance(**kwargs: object) -> stripe.Balance:
        return stripe.Balance.construct_from({"livemode": False}, None)

    async def customer(identity: str, **kwargs: object) -> stripe.Customer:
        return stripe.Customer.construct_from(
            {
                "id": identity,
                "livemode": False,
                "metadata": deposits.deposit_tags(str(manifest.run_id), "bk_owned", "cl_owned"),
            },
            None,
        )

    async def intents(**kwargs: object) -> stripe.ListObject[stripe.PaymentIntent]:
        return stripe.ListObject[stripe.PaymentIntent].construct_from(
            {"object": "list", "data": [payment.to_dict()], "has_more": False}, None
        )

    async def intent(identity: str, **kwargs: object) -> stripe.PaymentIntent:
        return payment

    async def cancel(identity: str, **kwargs: object) -> stripe.PaymentIntent:
        operations.append(identity)
        payment.status = "canceled"
        return payment

    monkeypatch.setattr(stripe, "api_key", stripe.api_key)
    monkeypatch.setattr(stripe, "api_version", stripe.api_version)
    monkeypatch.setattr(stripe.Account, "retrieve_async", account)
    monkeypatch.setattr(stripe.Balance, "retrieve_async", balance)
    monkeypatch.setattr(stripe.Customer, "retrieve_async", customer)
    monkeypatch.setattr(stripe.PaymentIntent, "list_async", intents)
    monkeypatch.setattr(stripe.PaymentIntent, "retrieve_async", intent)
    monkeypatch.setattr(stripe.PaymentIntent, "cancel_async", cancel)
    if wrong_booking:
        with pytest.raises(ValueError, match="unrelated"):
            await recover(manifest, env, "local", apply=True)
        assert operations == []
    else:
        assert await recover(manifest, env, "local", apply=False) == [
            {"intent": "pi_owned", "status": "planned_cancel"}
        ]
        assert operations == []
        assert await recover(manifest, env, "local", apply=True) == [
            {"intent": "pi_owned", "status": "canceled"}
        ]
        assert operations == ["pi_owned"]
        assert await recover(manifest, env, "local", apply=True) == [
            {"intent": "pi_owned", "status": "already_canceled"}
        ]
        assert operations == ["pi_owned"]
