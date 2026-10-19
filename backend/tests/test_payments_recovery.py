from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import STRIPE_API_VERSION, GatewayEvent
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.messaging import Delivery
from clientbridge.models.payments import Payment, PaymentStatus
from clientbridge.models.platform import Audit, Webhook
from clientbridge.services import ledger
from clientbridge.services.payments import reconcile_stripe_transactions, run_recover_payments
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


async def test_recovers_a_payment_after_webhook_retries_end(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    payment = await _pending(db, gateway)
    identity = payment.id
    assert await run_recover_payments(db, gateway) == 1
    await db.refresh(payment)
    assert payment.status == "succeeded"
    assert payment.paid_at is not None
    assert payment.paid_at < clock.now() - timedelta(days=59)
    assert await run_recover_payments(db, gateway) == 0
    journal = await ledger.journal_for(db, BIZ, f"payment:{identity}")
    assert journal is not None


async def test_recovers_a_missed_event_once(db: AsyncSession, gateway: FakePaymentGateway) -> None:
    payment = await _pending(db, gateway)
    occurred_at = clock.now() - timedelta(days=2)
    gateway.events["acct_test"] = [
        GatewayEvent(
            id="evt_recovery",
            type="payment_intent.succeeded",
            data={"id": "pi_recovery"},
            account="acct_test",
            api_version=STRIPE_API_VERSION,
            created=occurred_at,
        )
    ]
    assert await run_recover_payments(db, gateway) == 1
    assert await run_recover_payments(db, gateway) == 0
    await db.refresh(payment)
    assert payment.paid_at is not None
    assert (
        int(payment.paid_at.timestamp())
        == gateway.objects[("acct_test", "charge", "ch_recovered")]["created"]
    )
    record = await db.get(Webhook, "evt_recovery")
    assert record is not None and record.status == "processed"


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
    gateway.invoice_intents["in_old"] = "pi_old"
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


@pytest.mark.parametrize(
    "event_type", ["payment_intent.succeeded", "payment_intent.payment_failed"]
)
async def test_recovery_uses_current_object_across_event_versions(
    db: AsyncSession, gateway: FakePaymentGateway, event_type: str
) -> None:
    payment = await _pending(db, gateway)
    gateway.events["acct_test"] = [
        GatewayEvent(
            id="evt_old_version",
            type=event_type,
            data={"id": "pi_recovery", "status": "requires_payment_method"},
            account="acct_test",
            api_version="2020-08-27",
            created=clock.now() - timedelta(days=2),
        )
    ]
    assert await run_recover_payments(db, gateway) == 1
    await db.refresh(payment)
    assert payment.status == "succeeded"
    assert payment.paid_at is not None
    assert (
        int(payment.paid_at.timestamp())
        == gateway.objects[("acct_test", "charge", "ch_recovered")]["created"]
    )
    record = await db.get(Webhook, "evt_old_version")
    assert record is not None and record.status == "processed"


@pytest.mark.parametrize("with_event", [False, True])
async def test_recovery_defers_unavailable_fees_without_failing_the_job(
    db: AsyncSession, gateway: FakePaymentGateway, with_event: bool
) -> None:
    payment = await _pending(db, gateway)
    identity = payment.id
    await db.commit()
    gateway.pending_fees.add("pi_recovery")
    if with_event:
        gateway.events["acct_test"] = [
            GatewayEvent(
                id="evt_deferred",
                type="payment_intent.succeeded",
                data={"id": "pi_recovery"},
                account="acct_test",
                api_version=STRIPE_API_VERSION,
                created=clock.now(),
            )
        ]
    assert await run_recover_payments(db, gateway) == 0
    assert await ledger.journal_for(db, BIZ, f"payment:{identity}") is None
    gateway.pending_fees.clear()
    assert await run_recover_payments(db, gateway) == 1
    assert await run_recover_payments(db, gateway) == 0


async def test_old_recovery_settles_without_sending_a_late_receipt(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    payment = await _pending(db, gateway)
    identity = payment.id
    assert await run_recover_payments(db, gateway) == 1
    assert await db.scalar(select(Delivery.id).where(Delivery.key.contains(identity))) is None


@pytest.mark.parametrize("net", [-150, 150])
async def test_standalone_stripe_fee_is_booked_once(
    db: AsyncSession, gateway: FakePaymentGateway, net: int
) -> None:
    await enable_payments(db)
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_fee",
            "source": None,
            "type": "stripe_fee",
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


async def test_recent_recovery_queues_the_receipt_once(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    payment = await _pending(db, gateway)
    identity = payment.id
    gateway.objects[("acct_test", "charge", "ch_recovered")]["created"] = int(
        clock.now().timestamp()
    )
    assert await run_recover_payments(db, gateway) == 1
    deliveries = list(await db.scalars(select(Delivery.id).where(Delivery.key.contains(identity))))
    assert deliveries
    assert await run_recover_payments(db, gateway) == 0
    assert (
        list(await db.scalars(select(Delivery.id).where(Delivery.key.contains(identity))))
        == deliveries
    )


async def test_recovery_still_reports_a_malformed_provider_object(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _pending(db, gateway)
    await db.commit()
    del gateway.objects[("acct_test", "payment_intent", "pi_recovery")]["latest_charge"]
    with pytest.raises(RuntimeError, match="stripe recovery failed"):
        await run_recover_payments(db, gateway)


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
            "fee": -20,
            "net": -980,
            "currency": "cad",
            "created": stamp,
            "fee_details": [{"type": "application_fee", "amount": -20}],
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


@pytest.mark.parametrize("status, age", [("pending", 31), ("failed", 1)])
async def test_recovery_does_not_poll_abandoned_or_failed_payments(
    db: AsyncSession, gateway: FakePaymentGateway, status: PaymentStatus, age: int
) -> None:
    payment = await _pending(db, gateway)
    payment.status = status
    payment.created_at = clock.now() - timedelta(days=age)
    await db.commit()
    assert await run_recover_payments(db, gateway) == 0
    await db.refresh(payment)
    assert payment.status == status


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


async def test_unreadable_source_fees_defer_without_a_drift_alert(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _pending(db, gateway)
    gateway.pending_fees.add("pi_recovery")
    gateway.objects[("acct_test", "charge", "ch_recovered")]["payment_intent"] = "pi_recovery"
    gateway.transactions["acct_test"] = [
        {
            "id": "txn_deferred",
            "source": "ch_recovered",
            "net": 980,
            "currency": "cad",
            "created": int(clock.now().timestamp()),
        }
    ]
    assert await reconcile_stripe_transactions(db, gateway, BIZ, "acct_test") == 0
    assert list(await db.scalars(select(Audit).where(Audit.action.like("ledger.%")))) == []


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
