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
from clientbridge.models.payments import Payment
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
    assert result.json()[0]["id"] == "po_one"
    assert result.json()[0]["status"] == status


async def test_staff_cannot_read_connected_account_payouts(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/connect/payouts")).status_code == 403


async def test_payouts_do_not_read_another_business_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.payouts["acct_other"] = [{"id": "po_other"}]
    assert (await as_owner.get("/v1/connect/payouts")).json() == []


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
