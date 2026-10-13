import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import ChargeFees, GatewayEvent
from clientbridge.models.business import Business
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Audit, Device, Webhook
from clientbridge.services import ledger
from clientbridge.services.business import kyc_status
from clientbridge.services.payments import record_failed_delivery
from tests.conftest import FakePaymentGateway, FakePushSender
from tests.helpers import client_id, column, enable_payments, sent_invoice

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


def _event(event_id: str, account_id: str, *, charges_enabled: bool = True) -> str:
    body: dict[str, object] = {
        "id": event_id,
        "type": "account.updated",
        "data": {"object": {"id": account_id, "charges_enabled": charges_enabled}},
    }
    return json.dumps(body)


async def test_account_updated_enables_charges(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_x"))
    await db.flush()
    res = await api.post(
        "/webhooks/stripe",
        content=_event("evt_1", "acct_x"),
        headers={"Stripe-Signature": "good"},
    )
    assert res.status_code == 200
    enabled = (
        await db.execute(select(Business.stripe_charges_enabled).where(Business.id == BIZ))
    ).scalar_one()
    assert enabled is True


async def test_account_updated_syncs_kyc_state(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_kyc")
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_kyc",
            "type": "account.updated",
            "data": {
                "object": {
                    "id": "acct_kyc",
                    "charges_enabled": False,
                    "payouts_enabled": False,
                    "details_submitted": True,
                    "requirements": {
                        "currently_due": ["external_account", "individual.id_number"],
                        "past_due": [],
                        "eventually_due": [],
                        "pending_verification": [],
                        "disabled_reason": None,
                    },
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    # details submitted but Stripe still needs things → provider action required
    assert kyc_status(biz) == "restricted"
    assert biz.stripe_details_submitted is True and biz.stripe_payouts_enabled is False
    assert biz.stripe_requirements["currently_due"] == ["external_account", "individual.id_number"]


async def test_account_updated_golden_payload_syncs_state(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    # A full real-shaped account.updated event, read through the live webhook path
    body = (Path(__file__).parent / "fixtures" / "stripe" / "account_updated.json").read_text()
    acct = json.loads(body)["data"]["object"]["id"]
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=acct))
    await db.flush()
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert kyc_status(biz) == "restricted"
    assert biz.stripe_details_submitted is True and biz.stripe_payouts_enabled is False
    assert biz.stripe_requirements["currently_due"] == ["external_account", "individual.id_number"]
    assert biz.stripe_requirements["past_due"] == ["external_account"]


async def test_payment_method_auto_updated_refreshes_card(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_pm"))
    cid = await client_id(db)
    db.add(
        PaymentMethod(
            id="pm_row",
            business_id=BIZ,
            client_id=cid,
            method="card",
            brand="visa",
            last4="4242",
            provider="stripe",
            provider_ref="pm_stripe_1",
            preferred=True,
            mandate_status="none",
            status="active",
        )
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_pm_upd",
            "type": "payment_method.automatically_updated",
            "account": "acct_pm",
            "data": {
                "object": {"id": "pm_stripe_1", "card": {"brand": "mastercard", "last4": "5555"}}
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    pm = (await db.execute(select(PaymentMethod).where(PaymentMethod.id == "pm_row"))).scalar_one()
    assert pm.brand == "mastercard" and pm.last4 == "5555"


async def test_refund_created_records_a_dashboard_refund(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    db.add(
        Payment(
            id="pay_dash",
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            amount_cents=5000,
            currency="cad",
            method="card",
            provider="stripe",
            provider_ref="pi_dash",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_refunded",
            "type": "refund.created",
            "account": "acct_r",
            "data": {
                "object": {
                    "id": "re_dash_1",
                    "payment_intent": "pi_dash",
                    "amount": 5000,
                    "status": "succeeded",
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    refund = (
        await db.execute(
            select(Payment).where(Payment.parent_payment_id == "pay_dash", Payment.kind == "refund")
        )
    ).scalar_one()
    assert refund.amount_cents == 5000
    assert refund.provider_ref == "re_dash_1" and refund.status == "succeeded"


async def test_charge_dispute_alerts_staff(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    cid = await client_id(db)
    db.add(
        Payment(
            id="pay_disp",
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            amount_cents=8000,
            currency="cad",
            method="card",
            provider="stripe",
            provider_ref="pi_disp",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    db.add(
        Device(id="dvt_test", business_id=BIZ, user_id="us_dev", token="ExpoTok", platform="ios")
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_disp",
            "type": "charge.dispute.created",
            "account": "acct_d",
            "data": {"object": {"id": "dp_1", "payment_intent": "pi_disp", "amount": 8000}},
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    assert any("disput" in p.body.lower() for p in push.sent)  # the business's staff were alerted


async def test_bad_signature_rejected(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/webhooks/stripe",
        content=_event("evt_2", "acct_x"),
        headers={"Stripe-Signature": "bad"},
    )
    assert res.status_code == 400


async def test_duplicate_event_is_noop(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_y", stripe_charges_enabled=False)
    )
    await db.flush()
    body = _event("evt_dup", "acct_y", charges_enabled=True)
    first = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    # flip charges back off, then replay the SAME event id — dedup must skip re-dispatch
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=False)
    )
    await db.flush()
    second = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert first.status_code == 200 and second.status_code == 200
    enabled = (
        await db.execute(select(Business.stripe_charges_enabled).where(Business.id == BIZ))
    ).scalar_one()
    assert enabled is False  # replay was a no-op, not a re-enable
    rows = (await db.execute(select(Webhook.id).where(Webhook.id == "evt_dup"))).scalars().all()
    assert len(rows) == 1


def _intent_event(event_id: str, event_type: str, pi: str, **extra: object) -> str:
    obj: dict[str, object] = {"id": pi, **extra}
    return json.dumps({"id": event_id, "type": event_type, "data": {"object": obj}})


async def _pending_payment(db: AsyncSession, pi: str) -> str:
    cid = await client_id(db)
    db.add(
        Payment(
            id=f"pay_{pi}",
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            amount_cents=4000,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref=pi,
            status="pending",
        )
    )
    await db.flush()
    return f"pay_{pi}"


async def _payment_journals(db: AsyncSession, payment_id: str) -> int:
    rows = await db.execute(
        select(Entry.journal_id).where(Entry.source_id == payment_id, Entry.event == "payment")
    )
    return len(set(rows.scalars().all()))


async def test_payment_that_succeeds_after_a_decline_is_settled(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    pay_id = await _pending_payment(db, "pi_retry")
    failed = _intent_event("evt_pf", "payment_intent.payment_failed", "pi_retry")
    assert (await api.post("/webhooks/stripe", content=failed, headers=GOOD)).status_code == 200
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "failed"
    ok = _intent_event("evt_ps", "payment_intent.succeeded", "pi_retry")
    assert (await api.post("/webhooks/stripe", content=ok, headers=GOOD)).status_code == 200
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "succeeded"
    assert await _payment_journals(db, pay_id) == 1
    again = _intent_event("evt_ps2", "payment_intent.succeeded", "pi_retry")
    assert (await api.post("/webhooks/stripe", content=again, headers=GOOD)).status_code == 200
    assert await _payment_journals(db, pay_id) == 1


async def test_canceled_payment_is_not_settled(api: httpx.AsyncClient, db: AsyncSession) -> None:
    pay_id = await _pending_payment(db, "pi_cxl")
    canceled = _intent_event("evt_pc", "payment_intent.canceled", "pi_cxl")
    await api.post("/webhooks/stripe", content=canceled, headers=GOOD)
    ok = _intent_event("evt_pc_ok", "payment_intent.succeeded", "pi_cxl")
    assert (await api.post("/webhooks/stripe", content=ok, headers=GOOD)).status_code == 200
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "canceled"


async def test_our_unrecorded_intent_is_retried_not_acknowledged(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.commit()
    body = _intent_event(
        "evt_early", "payment_intent.succeeded", "pi_early", metadata={"business_id": BIZ}
    )
    res = await api.post("/webhooks/stripe", content=body, headers=GOOD)
    assert res.status_code == 503
    await db.rollback()  # the request's session closes uncommitted
    deferred = await db.execute(select(Webhook).where(Webhook.id == "evt_early"))
    assert deferred.scalar_one_or_none() is None  # a deliberate retry is not a failure
    pay_id = await _pending_payment(db, "pi_early")
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "succeeded"
    assert await column(db, "webhooks", "evt_early", "status") == "processed"


async def test_foreign_intent_is_acknowledged(api: httpx.AsyncClient) -> None:
    body = _intent_event("evt_foreign", "payment_intent.succeeded", "pi_foreign", metadata={})
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200


async def _succeeded_payment(db: AsyncSession, pi: str) -> Payment:
    cid = await client_id(db)
    payment = Payment(
        id=f"pay_{pi}",
        business_id=BIZ,
        client_id=cid,
        kind="payment",
        amount_cents=8000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=pi,
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(payment)
    await db.flush()
    await ledger.post_payment(db, payment)
    return payment


async def _dispute_entries(db: AsyncSession, payment_id: str) -> int:
    rows = await db.execute(
        select(Entry.id).where(Entry.event == "dispute", Entry.source_id == payment_id)
    )
    return len(rows.scalars().all())


def _dispute_event(event_id: str, event_type: str, pi: str, status: str) -> str:
    obj = {"id": f"dp_{pi}", "payment_intent": pi, "amount": 8000, "status": status}
    return json.dumps({"id": event_id, "type": event_type, "data": {"object": obj}})


async def test_dispute_inquiry_withdraws_nothing(api: httpx.AsyncClient, db: AsyncSession) -> None:
    payment = await _succeeded_payment(db, "pi_inq")
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    opened = _dispute_event("evt_inq", "charge.dispute.created", "pi_inq", "warning_needs_response")
    assert (await api.post("/webhooks/stripe", content=opened, headers=GOOD)).status_code == 200
    closed = _dispute_event("evt_inq_c", "charge.dispute.closed", "pi_inq", "warning_closed")
    assert (await api.post("/webhooks/stripe", content=closed, headers=GOOD)).status_code == 200
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert after == before
    assert await _dispute_entries(db, payment.id) == 0


async def test_dispute_withdraws_funds(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _succeeded_payment(db, "pi_chb")
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    opened = _dispute_event("evt_chb", "charge.dispute.created", "pi_chb", "needs_response")
    assert (await api.post("/webhooks/stripe", content=opened, headers=GOOD)).status_code == 200
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert before - after == 8000


async def test_dispute_state_follows_the_case(api: httpx.AsyncClient, db: AsyncSession) -> None:
    payment = await _succeeded_payment(db, "pi_case")
    due = int(datetime(2026, 10, 20, tzinfo=UTC).timestamp())
    opened = {
        "id": "dp_case",
        "payment_intent": "pi_case",
        "amount": 8000,
        "status": "needs_response",
        "reason": "product_not_received",
        "evidence_details": {"due_by": due},
    }
    for event_id, event_type, status in (
        ("evt_case_1", "charge.dispute.created", "needs_response"),
        ("evt_case_2", "charge.dispute.updated", "under_review"),
    ):
        body = json.dumps(
            {"id": event_id, "type": event_type, "data": {"object": {**opened, "status": status}}}
        )
        assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    await db.refresh(payment)
    assert payment.dispute_status == "under_review"
    assert payment.dispute_reason == "product_not_received"
    assert payment.dispute_respond_by == datetime(2026, 10, 20, tzinfo=UTC)
    closed = _dispute_event("evt_case_3", "charge.dispute.closed", "pi_case", "won")
    assert (await api.post("/webhooks/stripe", content=closed, headers=GOOD)).status_code == 200
    assert await column(db, "payments", payment.id, "dispute_status") == "won"


async def test_an_update_for_an_unseen_dispute_books_it(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """A missed or inquiry-stage `created` must not leave the withdrawn funds unbooked."""
    payment = await _succeeded_payment(db, "pi_quiet")
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    body = _dispute_event("evt_quiet", "charge.dispute.updated", "pi_quiet", "under_review")
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    await db.refresh(payment)
    assert payment.dispute_status == "under_review"
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert before - after == 8000


async def test_a_raising_handler_leaves_a_failed_row_the_retry_then_processes(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await enable_payments(db)
    pay_id = await _pending_payment(db, "pi_flaky")
    fees = gateway.get_payment_fees

    async def boom(account_id: str, *, payment_intent_id: str) -> ChargeFees | None:
        raise RuntimeError("stripe is down")

    monkeypatch.setattr(gateway, "get_payment_fees", boom)
    await db.commit()
    body = _intent_event("evt_flaky", "payment_intent.succeeded", "pi_flaky")
    with pytest.raises(RuntimeError):
        await api.post("/webhooks/stripe", content=body, headers=GOOD)
    await db.rollback()
    assert await column(db, "webhooks", "evt_flaky", "status") == "failed"
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "pending"
    monkeypatch.setattr(gateway, "get_payment_fees", fees)
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    assert await column(db, "webhooks", "evt_flaky", "status") == "processed"
    status = (await db.execute(select(Payment.status).where(Payment.id == pay_id))).scalar_one()
    assert status == "succeeded"


async def test_an_inquiry_that_escalates_books_the_dispute(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    """Stripe withdraws the funds when an inquiry becomes a chargeback, not when it opened."""
    payment = await _succeeded_payment(db, "pi_esc")
    db.add(Device(id="dvt_esc", business_id=BIZ, user_id="us_dev", token="ExpoTok", platform="ios"))
    await db.flush()
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    opened = _dispute_event("evt_esc", "charge.dispute.created", "pi_esc", "warning_needs_response")
    assert (await api.post("/webhooks/stripe", content=opened, headers=GOOD)).status_code == 200
    assert await _dispute_entries(db, payment.id) == 0
    assert push.sent == []
    for event_id, event_type in (
        ("evt_esc_2", "charge.dispute.updated"),
        ("evt_esc_3", "charge.dispute.funds_withdrawn"),
    ):
        body = _dispute_event(event_id, event_type, "pi_esc", "needs_response")
        assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
        after = await ledger.balance(
            db, BIZ, owner_type="business", owner_id=BIZ, category="stripe"
        )
        assert before - after == 8000  # booked once, on the escalation
        assert sum("disput" in p.body.lower() for p in push.sent) == 1
    await db.refresh(payment)
    assert payment.dispute_status == "needs_response"
    lost = _dispute_event("evt_esc_4", "charge.dispute.closed", "pi_esc", "lost")
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    assert payment.client_id is not None
    owed = await ledger.balance(
        db, BIZ, owner_type="client", owner_id=payment.client_id, category="receivable"
    )
    assert owed == 0


async def test_an_intent_from_another_account_is_not_booked(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9400, total=5000)
    body = json.dumps(
        {
            "id": "evt_acct",
            "type": "payment_intent.succeeded",
            "account": "acct_other",
            "data": {
                "object": {
                    "id": "pi_acct",
                    "amount": 5000,
                    "currency": "cad",
                    "metadata": {"business_id": BIZ, "invoice_id": inv_id},
                }
            },
        }
    )
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    rows = await db.execute(select(Payment.id).where(Payment.provider_ref == "pi_acct"))
    assert rows.scalar_one_or_none() is None


async def test_an_orphaned_purchase_is_refunded_once(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """A purchase charged off-session whose command never committed has nothing to activate."""
    await enable_payments(db)
    obj = {
        "id": "pi_orphan",
        "amount": 3000,
        "currency": "cad",
        "created": int((datetime.now(UTC) - timedelta(hours=2)).timestamp()),
        "metadata": {"business_id": BIZ, "gift_card_id": "gc_never"},
    }
    for event_id in ("evt_orphan_1", "evt_orphan_2"):
        body = json.dumps(
            {
                "id": event_id,
                "type": "payment_intent.succeeded",
                "account": "acct_test",
                "data": {"object": obj},
            }
        )
        assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    assert gateway.refunds == [("pi_orphan", 3000, True)]
    audits = await db.execute(
        select(Audit).where(
            Audit.action == "payment.orphan_refunded", Audit.entity_id == "pi_orphan"
        )
    )
    assert [a.changes["amount_cents"] for a in audits.scalars()] == [3000]


async def test_a_fresh_purchase_without_its_row_is_retried_not_refunded(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """Its command may still be committing: the card was charged inside the Stripe call."""
    await enable_payments(db)
    await db.commit()
    body = _intent_event(
        "evt_fresh",
        "payment_intent.succeeded",
        "pi_fresh",
        amount=3000,
        created=int(datetime.now(UTC).timestamp()),
        metadata={"business_id": BIZ, "package_id": "pkg_committing"},
    )
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 503
    assert gateway.refunds == []


async def test_a_refund_of_a_charge_still_settling_is_retried(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Card refunds send no later update, so dropping this one would lose it for good."""
    pay_id = await _pending_payment(db, "pi_unsettled")
    await db.commit()
    refund = {"id": "re_early", "payment_intent": "pi_unsettled", "amount": 4000}
    body = json.dumps({"id": "evt_re_early", "type": "refund.created", "data": {"object": refund}})
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 503
    await db.rollback()
    settled = _intent_event("evt_unsettled_ok", "payment_intent.succeeded", "pi_unsettled")
    assert (await api.post("/webhooks/stripe", content=settled, headers=GOOD)).status_code == 200
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    rows = await db.execute(
        select(Payment.amount_cents).where(
            Payment.parent_payment_id == pay_id, Payment.kind == "refund"
        )
    )
    assert rows.scalars().all() == [4000]


async def test_a_dispute_closed_before_it_was_booked_is_written_off(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    payment = await _succeeded_payment(db, "pi_unseen_lost")
    assert payment.client_id is not None
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    lost = _dispute_event("evt_unseen_lost", "charge.dispute.closed", "pi_unseen_lost", "lost")
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert before - after == 8000
    owed = await ledger.balance(
        db, BIZ, owner_type="client", owner_id=payment.client_id, category="receivable"
    )
    assert owed == 0
    assert await column(db, "payments", payment.id, "dispute_status") == "lost"
    written_off = await db.execute(
        select(Entry.id).where(Entry.ref == "dispute:dp_pi_unseen_lost:lost")
    )
    assert written_off.scalars().first() is not None


async def test_a_failed_delivery_never_overwrites_a_processed_row(db: AsyncSession) -> None:
    db.add(
        Webhook(
            id="evt_done",
            provider="stripe",
            event="payout.paid",
            payload={},
            status="processed",
            processed_at=datetime.now(UTC),
        )
    )
    await db.flush()
    event = GatewayEvent(id="evt_done", type="payout.paid", data={})
    await record_failed_delivery(db, event, RuntimeError("the loser of a race"))
    assert await column(db, "webhooks", "evt_done", "status") == "processed"
