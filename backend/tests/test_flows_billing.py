"""Billing flows: estimate to refund, Interac, disputes, payouts, remittance, and subscriptions."""

from datetime import datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.services.business import business_tz
from tests.conftest import BIZ, FakePaymentGateway
from tests.flows import (
    INTERAC,
    business_balance,
    enable_payments,
    invoice,
    ok,
    payment,
    payment_by_ref,
    provider_ref,
    settle,
    stripe_event,
)

AMELIE = "cl_amelie"
MARCUS = "cl_marcus"


async def _sent_invoice(api: httpx.AsyncClient, unit: int = 5000, quantity: float = 1.0) -> str:
    draft = ok(
        await api.post(
            "/v1/invoices",
            json={
                "client_id": AMELIE,
                "lines": [
                    {"description": "Flow work", "quantity": quantity, "unit_amount_cents": unit}
                ],
            },
        ),
        201,
    ).json()
    ok(await api.post(f"/v1/invoices/{draft['id']}/send"))
    return str(draft["id"])


async def test_estimate_to_invoice_partial_pay_and_refund(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    estimate = ok(
        await api.post(
            "/v1/estimates",
            json={
                "client_id": AMELIE,
                "lines": [{"description": "Quote", "quantity": 2, "unit_amount_cents": 5000}],
            },
        ),
        201,
    ).json()
    assert (estimate["status"], estimate["total_cents"]) == ("draft", 11200)
    assert ok(await api.post(f"/v1/estimates/{estimate['id']}/send")).json()["status"] == "sent"
    accepted = ok(await api.post(f"/v1/estimates/{estimate['id']}/accept")).json()
    assert accepted["status"] == "accepted"

    converted = ok(await api.post(f"/v1/estimates/{estimate['id']}/convert"), 201).json()
    assert (converted["status"], converted["total_cents"]) == ("draft", 11200)
    assert converted["balance_cents"] == 11200
    sent = ok(await api.post(f"/v1/invoices/{converted['id']}/send")).json()
    assert sent["status"] == "sent"

    intent = ok(await api.post(f"/v1/payments/invoice/{converted['id']}?amount_cents=5000")).json()
    await settle(api, db, intent["payment_id"])
    partial = await invoice(db, converted["id"])
    assert (partial.status, partial.amount_paid_cents, partial.balance_cents) == (
        "partial",
        5000,
        6200,
    )
    assert partial.paid_at is None

    refund = ok(await api.post(f"/v1/payments/{intent['payment_id']}/refund?amount_cents=2000"))
    assert refund.json()["status"] == "succeeded"
    refunded = await invoice(db, converted["id"])
    assert (refunded.status, refunded.amount_paid_cents, refunded.balance_cents) == (
        "partial",
        3000,
        6200,
    )  # a refund credits the invoice pro rata, so the balance owed does not grow

    rest = ok(await api.post(f"/v1/payments/invoice/{converted['id']}")).json()
    assert rest["amount_cents"] == 6200
    await settle(api, db, rest["payment_id"])
    paid = await invoice(db, converted["id"])
    assert (paid.status, paid.balance_cents, paid.amount_paid_cents) == ("paid", 0, 9200)
    assert paid.paid_at is not None

    ok(await api.post(f"/v1/payments/{rest['payment_id']}/refund"))
    ok(await api.post(f"/v1/payments/{intent['payment_id']}/refund"))
    back = await invoice(db, converted["id"])
    assert (back.status, back.amount_paid_cents) == ("refunded", 0)


async def test_interac_request_is_matched(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    api = as_owner
    inv = await _sent_invoice(api)
    total = (await invoice(db, inv)).total_cents
    request = ok(await api.post(f"/v1/payments/invoice/{inv}/interac")).json()
    assert request["amount_cents"] == total and len(request["reference_code"]) == 8

    ok(
        await api.post(
            "/webhooks/interac",
            json={"reference_code": request["reference_code"], "amount_cents": total},
            headers=INTERAC,
        )
    )
    settled = await payment(db, request["payment_id"])
    assert (settled.status, settled.method) == ("succeeded", "interac")
    paid = await invoice(db, inv)
    assert (paid.status, paid.balance_cents) == ("paid", 0)


async def test_dispute_opens_and_is_won(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    api = as_owner
    await enable_payments(db)
    inv = await _sent_invoice(api)
    intent = ok(await api.post(f"/v1/payments/invoice/{inv}")).json()
    await settle(api, db, intent["payment_id"])
    pi = await provider_ref(db, intent["payment_id"])
    stripe = await business_balance(db, "stripe")
    amount = intent["amount_cents"]

    dispute = {"id": f"dp_{pi}", "payment_intent": pi, "amount": amount}
    await stripe_event(api, "charge.dispute.created", {**dispute, "status": "needs_response"})
    assert await business_balance(db, "stripe") == stripe - amount
    await stripe_event(api, "charge.dispute.closed", {**dispute, "status": "won"})
    assert await business_balance(db, "stripe") == stripe


async def test_payout_paid_then_failed(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    api = as_owner
    await enable_payments(db)
    bank, stripe = await business_balance(db, "bank"), await business_balance(db, "stripe")
    payout = {"id": "po_flow", "amount": 40000, "currency": "cad", "arrival_date": 1700000000}

    await stripe_event(api, "payout.paid", payout)
    assert await business_balance(db, "bank") == bank + 40000
    assert await business_balance(db, "stripe") == stripe - 40000
    await stripe_event(api, "payout.failed", payout)
    assert (await business_balance(db, "bank"), await business_balance(db, "stripe")) == (
        bank,
        stripe,
    )


async def test_remittance_files_the_tax_payable(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    payable = ok(await api.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    await _sent_invoice(api, unit=10000)
    owed = ok(await api.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    assert owed - payable == 1200  # BC GST 5% + PST 7%

    yesterday = datetime.now(await business_tz(db, BIZ)).date() - timedelta(days=1)
    filed = ok(
        await api.post(
            "/v1/payments/remittances",
            json={"period_start": "2000-01-01", "period_end": yesterday.isoformat()},
        ),
        201,
    ).json()
    assert filed["total_cents"] == sum(filed["by_code"].values())
    left = ok(await api.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    assert owed - left == filed["total_cents"]


async def test_subscription_start_and_recurring_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    api = as_owner
    await enable_payments(db)
    sub = ok(
        await api.post(
            "/v1/subscriptions",
            json={"client_id": MARCUS, "item_id": "it_daycare", "payment_method_id": "pm_marcus"},
        ),
        201,
    ).json()
    assert sub["status"] == "active"
    [price] = gateway.created_price_amounts
    gateway.invoice_intents["in_flow"] = "pi_flow_sub"

    charge: dict[str, object] = {
        "id": "in_flow",
        "parent": {"subscription_details": {"subscription": gateway.created_subscriptions[-1]}},
        "amount_paid": price,
        "currency": "cad",
    }
    await stripe_event(api, "invoice.payment_succeeded", charge)
    await stripe_event(api, "invoice.payment_succeeded", charge)
    recorded = await payment_by_ref(db, "pi_flow_sub")
    assert (recorded.status, recorded.amount_cents, recorded.client_id) == (
        "succeeded",
        price,
        MARCUS,
    )
    assert recorded.invoice_id is not None
    minted = await invoice(db, recorded.invoice_id)
    assert (minted.status, minted.total_cents, minted.balance_cents) == ("paid", price, 0)
