from datetime import timedelta

import httpx
import pytest
import stripe
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import ChargeFees, StripeResource
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.services import ledger
from clientbridge.services.payments import reconcile_stripe_transactions, source_findings
from tests.conftest import BIZ, FakePaymentGateway
from tests.helpers import client_id, enable_payments, sent_invoice


async def _pending(db: AsyncSession, gateway: FakePaymentGateway) -> Payment:
    await enable_payments(db)
    row = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await client_id(db),
        invoice_id=await sent_invoice(db, total=1000),
        kind="payment",
        amount_cents=1000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref="pi_recovery",
        status="pending",
    )
    db.add(row)
    await db.flush()
    gateway.charges["pi_recovery"] = (1000, 20)
    gateway.objects[("acct_test", "payment_intent", "pi_recovery")] = {
        "id": "pi_recovery",
        "status": "succeeded",
        "latest_charge": "ch_recovered",
    }
    gateway.objects[("acct_test", "charge", "ch_recovered")] = {
        "id": "ch_recovered",
        "created": int((clock.now() - timedelta(days=60)).timestamp()),
    }
    return row


async def test_reconciliation_repairs_charge_and_identifies_exact_unmatched_movement(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    payment = await _pending(db, gateway)
    gateway.objects[("acct_test", "charge", "ch_recovery")] = {
        "id": "ch_recovery",
        "payment_intent": "pi_recovery",
    }
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_charge",
            "source": "ch_recovery",
            "net": 921,
            "currency": "cad",
            "created": int(clock.now().timestamp()),
        },
        {"id": "txn_other", "source": None, "net": -50, "currency": "cad"},
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1
    await db.refresh(payment)
    assert payment.status == "succeeded"
    audit = await db.scalar(select(Audit).where(Audit.action == "ledger.transaction_drift"))
    assert audit is not None
    assert audit.changes["transaction_ids"] == ["txn_other"]
    assert audit.changes["stripe_cents"] == -50
    assert audit.changes["ledger_cents"] == 0
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1


@pytest.mark.parametrize("status", ["pending", "in_transit", "paid", "failed", "canceled"])
async def test_payouts_return_authoritative_status(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, status: str
) -> None:
    await enable_payments(db)
    gateway.payouts["acct_test"] = [
        {
            "id": "po_one",
            "amount": 5000,
            "currency": "cad",
            "status": status,
            "created": int(clock.now().timestamp()),
            "arrival_date": int((clock.now() + timedelta(days=2)).timestamp()),
        }
    ]
    result = await as_owner.get("/v1/connect/payouts")
    assert result.status_code == 200
    assert result.json()["payouts"][0]["id"] == "po_one"
    assert result.json()["payouts"][0]["status"] == status


async def test_staff_cannot_read_connected_account_payouts(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/connect/payouts")).status_code == 403


async def test_payouts_do_not_read_another_business_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.payouts["acct_other"] = [{"id": "po_other"}]
    assert (await as_owner.get("/v1/connect/payouts")).json() == {
        "payouts": [],
        "next_cursor": None,
    }


async def test_recovers_an_old_membership_charge_from_its_stripe_invoice(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="subscription",
        name="Membership",
        price_cents=1000,
        currency="CAD",
        interval=1,
        frequency="month",
    )
    db.add(item)
    await db.flush()
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=await client_id(db),
        item_id=item.id,
        status="active",
        provider_ref="sub_old",
    )
    db.add(sub)
    await db.flush()
    paid_at = int((clock.now() - timedelta(days=60)).timestamp())
    gateway.pay_invoice("in_old", "pi_old", 1000)
    gateway.objects[("acct_test", "invoice_payment", "pi_old")] = {
        "id": "in_old",
        "currency": "cad",
        "amount_paid": 1000,
        "parent": {"subscription_details": {"subscription": "sub_old"}},
        "status_transitions": {"paid_at": paid_at},
    }
    gateway.objects[("acct_test", "charge", "ch_old")] = {"payment_intent": "pi_old"}
    gateway.objects[("acct_test", "payment_intent", "pi_old")] = {
        "id": "pi_old",
        "status": "succeeded",
    }
    gateway.charges["pi_old"] = (1000, 0)
    gateway.transactions["acct_test"] = [
        {"id": "txn_old", "source": "ch_old", "currency": "cad", "net": 941, "created": paid_at}
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    payment = await db.scalar(select(Payment).where(Payment.provider_ref == "pi_old"))
    assert payment is not None and payment.status == "succeeded" and payment.invoice_id is not None
    assert payment.paid_at is not None and int(payment.paid_at.timestamp()) == paid_at
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0


@pytest.mark.parametrize("kind", ["stripe_fee", "tax_fee", "stripe_fx_fee"])
@pytest.mark.parametrize("net", [-150, 150])
async def test_standalone_stripe_fee_is_booked_once(
    db: AsyncSession, gateway: FakePaymentGateway, net: int, kind: str
) -> None:
    await enable_payments(db)
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_fee",
            "source": None,
            "type": kind,
            "net": net,
            "currency": "cad",
            "created": int(clock.now().timestamp()),
        }
    ]
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    for _ in range(2):
        assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
        assert (
            await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
            == before + net
        )


async def test_payout_contents_are_scoped_and_paginated(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.objects[("acct_test", "payout", "po_contents")] = {
        "id": "po_contents",
        "automatic": True,
        "reconciliation_status": "completed",
    }
    gateway.transactions["po_contents"] = [
        {
            "id": f"txn_{index}",
            "source": f"ch_{index}",
            "amount": 1000,
            "fee": 30,
            "net": 970,
            "currency": "cad",
            "type": "charge",
            "created": int(clock.now().timestamp()),
        }
        for index in range(26)
    ]
    response = await as_owner.get("/v1/connect/payouts/po_contents/transactions")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "available"
    assert len(body["transactions"]) == 24
    assert body["next_cursor"] == "txn_23"
    assert body["transactions"][0]["net_cents"] == 970
    response = await as_owner.get("/v1/connect/payouts/po_contents/transactions?after=txn_23")
    assert response.status_code == 200
    assert len(response.json()["transactions"]) == 2
    assert response.json()["next_cursor"] is None
    assert gateway.payout_transaction_calls == [
        ("acct_test", "po_contents", None),
        ("acct_test", "po_contents", "txn_23"),
    ]


@pytest.mark.parametrize(
    "automatic,state,expected",
    [(False, "not_applicable", "unavailable"), (True, "in_progress", "pending")],
)
async def test_payout_contents_do_not_invent_an_allocation(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    automatic: bool,
    state: str,
    expected: str,
) -> None:
    await enable_payments(db)
    gateway.objects[("acct_test", "payout", "po_contents")] = {
        "id": "po_contents",
        "automatic": automatic,
        "reconciliation_status": state,
    }
    response = await as_owner.get("/v1/connect/payouts/po_contents/transactions")
    assert response.status_code == 200
    assert response.json() == {"status": expected, "transactions": [], "next_cursor": None}
    assert gateway.payout_transaction_calls == []


async def test_staff_cannot_read_payout_contents(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/connect/payouts/po_other/transactions")).status_code == 403


async def test_payout_contents_cannot_read_another_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.objects[("acct_other", "payout", "po_other")] = {
        "id": "po_other",
        "automatic": True,
        "reconciliation_status": "completed",
    }
    assert (await as_owner.get("/v1/connect/payouts/po_other/transactions")).status_code == 404
    assert gateway.payout_transaction_calls == []


async def test_payout_contents_rejects_invalid_cursor(as_owner: httpx.AsyncClient) -> None:
    assert (
        await as_owner.get("/v1/connect/payouts/po_other/transactions?after=bad")
    ).status_code == 422


async def test_orphan_charge_refund_and_returned_fee_reconcile_once(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    stamp = int((clock.now() - timedelta(hours=2)).timestamp())
    gateway.objects[("acct_test", "charge", "ch_orphan")] = {
        "id": "ch_orphan",
        "payment_intent": "pi_orphan",
    }
    gateway.objects[("acct_test", "payment_intent", "pi_orphan")] = {
        "id": "pi_orphan",
        "status": "succeeded",
        "amount": 1000,
        "currency": "cad",
        "created": stamp,
        "metadata": {"business_id": BIZ, "gift_card_id": "gc_never"},
    }
    gateway.objects[("acct_test", "refund", "pyr_orphan")] = {
        "id": "pyr_orphan",
        "payment_intent": "pi_orphan",
        "status": "succeeded",
        "amount": 1000,
    }
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_orphan_charge",
            "source": "ch_orphan",
            "type": "charge",
            "amount": 1000,
            "fee": 60,
            "net": 940,
            "currency": "cad",
            "created": stamp,
            "fee_details": [
                {"type": "stripe_fee", "amount": 40},
                {"type": "application_fee", "amount": 20},
            ],
        },
        {
            "id": "txn_orphan_refund",
            "source": "pyr_orphan",
            "type": "payment_refund",
            "amount": -1000,
            "fee": 0,
            "net": -1000,
            "currency": "cad",
            "created": stamp,
            "fee_details": [],
        },
        {
            "id": "txn_orphan_fee_back",
            "source": "ch_orphan",
            "type": "adjustment",
            "reporting_category": "fee",
            "amount": 20,
            "fee": 0,
            "net": 20,
            "currency": "cad",
            "created": stamp,
            "fee_details": [],
        },
    ]
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    for _ in range(2):
        assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
        assert (
            await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
            == before - 40
        )
    assert gateway.refunds == [("pi_orphan", 1000, True)]
    assert (
        await ledger.balance(
            db, BIZ, owner_type="business", owner_id=BIZ, category="payable", code="orphan"
        )
        == 0
    )


async def test_repeated_drift_keeps_one_finding_and_changed_drift_reopens(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.transactions["acct_test"] = [
        {"id": "txn_unknown", "source": None, "net": -50, "currency": "cad"}
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1
    findings = list(
        await db.scalars(select(Audit).where(Audit.action == "ledger.transaction_drift"))
    )
    assert len(findings) == 1
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=BIZ,
            action="ledger.drift_acknowledged",
            entity_type="audit",
            entity_id=findings[0].id,
            changes={"reason": "reviewed provider adjustment"},
        )
    )
    await db.commit()
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    gateway.transactions["acct_test"][0]["net"] = -75
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1


async def test_malformed_payout_returns_provider_error(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.payouts["acct_test"] = [
        {"id": "po_bad", "amount": 100, "currency": "cad", "status": "paid"}
    ]
    response = await as_owner.get("/v1/connect/payouts")
    assert response.status_code == 502
    assert response.json()["error"] == "provider_unavailable"


async def test_repaired_source_records_resolution_and_reopens_later_drift(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    row: dict[str, object] = {
        "id": "txn_resolved",
        "source": None,
        "net": -50,
        "currency": "cad",
        "created": int(clock.now().timestamp()),
    }
    gateway.transactions["acct_test"] = [row]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1
    row["type"] = "stripe_fee"
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    resolved = list(await db.scalars(select(Audit).where(Audit.action == "ledger.drift_resolved")))
    assert len(resolved) == 1
    row["net"] = -60
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 1
    findings = list(
        await db.scalars(select(Audit).where(Audit.action == "ledger.transaction_drift"))
    )
    assert len(findings) == 2


async def _unreadable_fees(
    db: AsyncSession, gateway: FakePaymentGateway, age: timedelta
) -> list[Audit]:
    await _pending(db, gateway)
    gateway.pending_fees.add("pi_recovery")
    gateway.objects[("acct_test", "charge", "ch_recovered")]["payment_intent"] = "pi_recovery"
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_deferred",
            "source": "ch_recovered",
            "net": 980,
            "currency": "cad",
            "created": int((clock.now() - age).timestamp()),
        }
    ]
    await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test")
    return list(
        await db.scalars(
            select(Audit).where(Audit.action.like("ledger.%"), Audit.action != "ledger.reconciled")
        )
    )


async def test_unreadable_source_fees_defer_without_a_drift_alert(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    assert await _unreadable_fees(db, gateway, timedelta(hours=23)) == []


async def test_unreadable_source_fees_become_a_finding_after_a_day(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    (finding,) = await _unreadable_fees(db, gateway, timedelta(hours=25))
    assert finding.action == "ledger.transaction_drift"
    assert (finding.entity_id, finding.changes["stripe_cents"]) == ("ch_recovered", 980)


async def test_finding_lookups_filter_on_every_audit_entity_index_column(
    db: AsyncSession,
) -> None:
    query = source_findings(BIZ).where(Audit.entity_id == "ch_any")
    sql = str(query.compile(dialect=postgresql.dialect()))
    for column in ("business_id", "entity_type", "entity_id"):
        assert f"audits.{column} = " in sql
    assert await db.scalar(query) is None


async def test_payout_contents_list_only_canadian_dollar_transactions(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.objects[("acct_test", "payout", "po_mixed")] = {
        "id": "po_mixed",
        "automatic": True,
        "reconciliation_status": "completed",
    }
    gateway.transactions["po_mixed"] = [
        {
            "id": f"txn_{currency}",
            "source": f"ch_{currency}",
            "amount": 1000,
            "fee": 30,
            "net": 970,
            "currency": currency,
            "type": "charge",
            "created": int(clock.now().timestamp()),
        }
        for currency in ("cad", "usd")
    ]
    response = await as_owner.get("/v1/connect/payouts/po_mixed/transactions")
    assert [row["id"] for row in response.json()["transactions"]] == ["txn_cad"]


async def test_payout_contents_treat_a_malformed_id_as_missing(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.objects[("acct_test", "payout", "not-a-payout")] = {
        "id": "not-a-payout",
        "automatic": True,
        "reconciliation_status": "completed",
    }
    response = await as_owner.get("/v1/connect/payouts/not-a-payout/transactions")
    assert response.status_code == 404


async def test_payout_contents_answer_a_provider_refusal_as_bad_gateway(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await enable_payments(db)

    async def refused(
        account_id: str | None, resource: StripeResource, identity: str
    ) -> dict[str, object]:
        raise stripe.InvalidRequestError("account cannot read payouts", "payout", code="other")

    monkeypatch.setattr(gateway, "retrieve", refused)
    response = await as_owner.get("/v1/connect/payouts/po_refused/transactions")
    assert response.status_code == 502
    assert response.json()["error"] == "payment_provider_error"


async def test_payout_history_pages_without_losing_older_payouts(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.payouts["acct_test"] = [
        {
            "id": f"po_{index}",
            "amount": 100,
            "currency": "cad",
            "status": "paid",
            "created": int(clock.now().timestamp()),
            "arrival_date": int(clock.now().timestamp()),
        }
        for index in range(30)
    ]
    first = await as_owner.get("/v1/connect/payouts")
    assert first.status_code == 200
    assert len(first.json()["payouts"]) == 24
    assert first.json()["next_cursor"] == "po_23"
    last = await as_owner.get("/v1/connect/payouts?after=po_23")
    assert last.status_code == 200
    assert [row["id"] for row in last.json()["payouts"]] == [f"po_{i}" for i in range(24, 30)]
    assert last.json()["next_cursor"] is None
    assert (await as_owner.get("/v1/connect/payouts?after=po_23")).json() == last.json()
    assert (await as_owner.get("/v1/connect/payouts?after=po_other_account")).status_code == 409
    assert (await as_owner.get("/v1/connect/payouts?after=invalid")).status_code == 422


async def _settled_charge(
    db: AsyncSession, gateway: FakePaymentGateway, name: str, amount: int, fees: ChargeFees
) -> Payment:
    """A settled card charge `pi_<name>` / `ch_<name>` with its fees booked."""
    row = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await client_id(db),
        kind="payment",
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=f"pi_{name}",
        status="succeeded",
        paid_at=clock.now() - timedelta(days=10),
    )
    db.add(row)
    await db.flush()
    await ledger.post_payment(db, row)
    await ledger.post_fees(db, row, fees)
    gateway.objects[("acct_test", "charge", f"ch_{name}")] = {
        "id": f"ch_{name}",
        "payment_intent": f"pi_{name}",
    }
    gateway.objects[("acct_test", "payment_intent", f"pi_{name}")] = {
        "id": f"pi_{name}",
        "status": "succeeded",
    }
    return row


async def _refunded(
    db: AsyncSession, gateway: FakePaymentGateway, charge: Payment, refund_id: str, amount: int
) -> Payment:
    refund = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=charge.client_id,
        kind="refund",
        parent_payment_id=charge.id,
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=refund_id,
        status="succeeded",
        paid_at=clock.now() - timedelta(days=10),
    )
    db.add(refund)
    await db.flush()
    await ledger.post_refund(db, refund, charge)
    gateway.objects[("acct_test", "refund", refund_id)] = {
        "id": refund_id,
        "payment_intent": charge.provider_ref,
        "status": "succeeded",
        "amount": amount,
    }
    return refund


def _txn(
    identity: str, source: str, kind: str, net: int, created: int, **extra: object
) -> dict[str, object]:
    return {
        "id": identity,
        "source": source,
        "type": kind,
        "amount": net,
        "fee": 0,
        "net": net,
        "currency": "cad",
        "created": created,
        "fee_details": [],
        **extra,
    }


async def _findings(db: AsyncSession) -> list[Audit]:
    return list(
        await db.scalars(
            select(Audit).where(
                Audit.business_id == BIZ,
                Audit.action.in_(("ledger.transaction_drift", "ledger.transaction_failed")),
            )
        )
    )


async def _window_from(db: AsyncSession, created: int) -> None:
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=BIZ,
            action="ledger.reconciled",
            entity_type="business",
            entity_id=BIZ,
            changes={"transaction_id": "txn_before", "created": created},
        )
    )
    await db.commit()


async def test_a_returned_application_fee_reconciles_on_the_charge_it_came_from(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """Stripe posts the returned fee as an adjustment on the charge (sandbox check 2)."""
    await enable_payments(db)
    charge = await _settled_charge(db, gateway, "fee_back", 10000, ChargeFees(400, 300, None))
    refund = await _refunded(db, gateway, charge, "re_fee_back", 10000)
    await ledger.post_fee_return(db, charge, refund.id)
    now = int(clock.now().timestamp())
    old = now - 10 * 86400
    gateway.transactions["acct_test"] = [
        _txn("txn_fee_back", "ch_fee_back", "adjustment", 300, now, reporting_category="fee"),
        _txn("txn_refund", "re_fee_back", "refund", -10000, old),
        {
            **_txn("txn_charge", "ch_fee_back", "charge", 9300, old),
            "amount": 10000,
            "fee": 700,
            "fee_details": [
                {"type": "application_fee", "amount": 300},
                {"type": "stripe_fee", "amount": 400},
            ],
        },
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    await _window_from(db, now - 600)
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    assert ("acct_test", None, "ch_fee_back") in gateway.transaction_calls
    assert await _findings(db) == []


async def test_a_refund_that_failed_reconciles_against_its_reversal(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """Stripe's `source` filter leaves out the `refund_failure` row, so it is read by type."""
    await enable_payments(db)
    charge = await _settled_charge(db, gateway, "refund_fails", 5000, ChargeFees(175, 0, None))
    refund = await _refunded(db, gateway, charge, "re_refund_fails", 2000)
    refund.status = "failed"
    await ledger.reverse_refund(db, refund, charge)
    gateway.objects[("acct_test", "refund", "re_refund_fails")]["status"] = "failed"
    now = int(clock.now().timestamp())
    await _window_from(db, now - 600)
    gateway.transactions["acct_test"] = [
        _txn("txn_refund_back", "re_refund_fails", "refund_failure", 2000, now),
        _txn("txn_refund_out", "re_refund_fails", "refund", -2000, now - 10 * 86400),
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    assert await _findings(db) == []


@pytest.mark.parametrize("dispute", ["du_recovered", "dp_recovered"])
async def test_a_dispute_withdrawal_is_recovered_and_reconciled(
    db: AsyncSession, gateway: FakePaymentGateway, dispute: str
) -> None:
    """Disputes are `du_` today and `dp_` on older ones; both are repaired and compared."""
    await enable_payments(db)
    charge = await _settled_charge(db, gateway, "disputed", 10000, ChargeFees(320, 300, None))
    withdrawal = {
        **_txn("txn_dispute", dispute, "adjustment", -11500, int(clock.now().timestamp())),
        "amount": -10000,
        "fee": 1500,
        "reporting_category": "dispute",
    }
    gateway.objects[("acct_test", "dispute", dispute)] = {
        "id": dispute,
        "payment_intent": charge.provider_ref,
        "amount": 10000,
        "status": "needs_response",
        "balance_transactions": [withdrawal],
    }
    gateway.transactions["acct_test"] = [withdrawal]
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    for _ in range(2):
        assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert after == before - 11500
    await db.refresh(charge)
    assert charge.dispute_status == "needs_response"
