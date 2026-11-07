"""Unapplied events are kept, missed ones replay from current state, and stale news stays quiet."""

import json
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.integrations.stripe import ConnectAccount, MissedEvent
from clientbridge.models.business import Business
from clientbridge.models.ledger import Entry
from clientbridge.models.messaging import Delivery
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Webhook
from clientbridge.models.scheduling import Booking
from clientbridge.services import payments
from clientbridge.services.payments import run_replay_missed_events, run_retry_deferred_payments
from tests.conftest import BIZ, Factory, FakePaymentGateway
from tests.helpers import (
    STRIPE,
    card_pay,
    deposit_payment,
    enable_payments,
    provider_ref,
    sent_invoice,
)


def _succeeded(event_id: str, pi: str, created: int) -> str:
    return json.dumps(
        {
            "id": event_id,
            "type": "payment_intent.succeeded",
            "created": created,
            "data": {"object": {"id": pi}},
        }
    )


async def _invoice_payment(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    await enable_payments(db)
    pay_id = await card_pay(api, db, await sent_invoice(db, total=6000))
    return pay_id, await provider_ref(db, pay_id)


async def _notices(db: AsyncSession, payment_id: str) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(Delivery)
            .where(Delivery.key.startswith(f"stripe:payment:{payment_id}:"))
        )
        or 0
    )


async def test_a_payment_notice_a_day_late_is_not_sent(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    stale_id, stale_pi = await _invoice_payment(api, db)
    old = int((clock.now() - timedelta(days=2)).timestamp())
    res = await api.post(
        "/webhooks/stripe", content=_succeeded("evt_stale", stale_pi, old), headers=STRIPE
    )
    assert res.status_code == 200
    stale = await db.get(Payment, stale_id, populate_existing=True)
    assert stale is not None and stale.status == "succeeded"
    assert await _notices(db, stale_id) == 0
    fresh_id, fresh_pi = await _invoice_payment(api, db)
    now = int(clock.now().timestamp())
    res = await api.post(
        "/webhooks/stripe", content=_succeeded("evt_fresh_notice", fresh_pi, now), headers=STRIPE
    )
    assert res.status_code == 200
    assert await _notices(db, fresh_id) > 0


async def test_a_missed_event_replays_from_the_objects_current_state_once(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    pay_id, pi = await _invoice_payment(api, db)
    gateway.objects[("acct_test", "payment_intent", pi)] = {
        "id": pi,
        "object": "payment_intent",
        "status": "succeeded",
    }
    gateway.missed["acct_test"] = [
        MissedEvent(
            id="evt_missed_failure",
            type="payment_intent.payment_failed",
            account="acct_test",
            created=clock.now() - timedelta(hours=2),
            object_type="payment_intent",
            object_id=pi,
        ),
        MissedEvent(
            id="evt_missed_unknown",
            type="charge.captured",
            account="acct_test",
            created=clock.now() - timedelta(hours=1),
            object_type="charge",
            object_id="ch_unknown",
        ),
    ]
    assert await run_replay_missed_events(db, gateway) == 1
    payment = await db.get(Payment, pay_id, populate_existing=True)
    assert payment is not None and payment.status == "succeeded"
    assert await run_replay_missed_events(db, gateway) == 0


async def test_events_already_applied_do_not_use_up_the_replay_budget(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id, pi = await _invoice_payment(api, db)
    applied_pi = await provider_ref(db, (await _invoice_payment(api, db))[0])
    now = int(clock.now().timestamp())
    res = await api.post(
        "/webhooks/stripe", content=_succeeded("evt_applied", applied_pi, now), headers=STRIPE
    )
    assert res.status_code == 200
    gateway.objects[("acct_test", "payment_intent", pi)] = {
        "id": pi,
        "object": "payment_intent",
        "status": "succeeded",
    }

    def missed(event_id: str, intent: str, hours: int) -> MissedEvent:
        return MissedEvent(
            id=event_id,
            type="payment_intent.succeeded",
            account="acct_test",
            created=clock.now() - timedelta(hours=hours),
            object_type="payment_intent",
            object_id=intent,
        )

    # Stripe lists an event as undelivered until a later delivery of it succeeds
    gateway.missed["acct_test"] = [missed("evt_applied", applied_pi, 1), missed("evt_lost", pi, 2)]
    monkeypatch.setattr(payments, "_REPLAY_PER_RUN", 1)
    assert await run_replay_missed_events(db, gateway) == 1
    payment = await db.get(Payment, pay_id, populate_existing=True)
    assert payment is not None and payment.status == "succeeded"


async def test_an_account_stripe_cannot_read_leaves_the_others_resynced(
    db: AsyncSession, gateway: FakePaymentGateway, factory: Factory
) -> None:
    """A failed re-read rolls back, so the job must not touch the rows it loaded before it."""
    other_id = (await factory.business()).id
    paused = {"card_status": "active", "currently_due": ["external_account"]}
    for business_id, account in ((BIZ, "acct_test"), (other_id, "acct_other")):
        await db.execute(
            update(Business)
            .where(Business.id == business_id)
            .values(
                stripe_account_id=account,
                stripe_charges_enabled=True,
                stripe_payouts_enabled=False,
                stripe_requirements=paused,
            )
        )
    await db.flush()
    gateway.unreadable_accounts.add("acct_test")
    gateway.accounts["acct_other"] = ConnectAccount(
        id="acct_other",
        charges_enabled=True,
        payouts_enabled=True,
        currently_due=[],
        eventually_due=[],
        past_due=[],
        disabled_reason=None,
        card_status="active",
    )
    assert await run_replay_missed_events(db, gateway) == 0
    resynced = await db.get(Business, other_id, populate_existing=True)
    assert resynced is not None and resynced.stripe_payouts_enabled is True


async def test_the_replay_re_reads_only_open_accounts_that_are_not_enabled(
    db: AsyncSession, gateway: FakePaymentGateway, factory: Factory
) -> None:
    closed_id = (await factory.business()).id
    states = (
        (BIZ, "acct_test", True, {"card_status": "active"}),
        (closed_id, "acct_closed", False, {"card_status": "active", "disabled_reason": "closed"}),
    )
    for business_id, account, payouts, requirements in states:
        await db.execute(
            update(Business)
            .where(Business.id == business_id)
            .values(
                stripe_account_id=account,
                stripe_charges_enabled=True,
                stripe_payouts_enabled=payouts,
                stripe_requirements=requirements,
            )
        )
    await db.flush()
    # Stripe reports both paused, which a re-read would mirror onto them
    for account in ("acct_test", "acct_closed"):
        gateway.accounts[account] = ConnectAccount(
            id=account,
            charges_enabled=True,
            payouts_enabled=False,
            currently_due=["external_account"],
            eventually_due=[],
            past_due=[],
            disabled_reason=None,
            card_status="active",
        )
    assert await run_replay_missed_events(db, gateway) == 0
    enabled = await db.get(Business, BIZ, populate_existing=True)
    closed = await db.get(Business, closed_id, populate_existing=True)
    assert enabled is not None and enabled.stripe_payouts_enabled is True
    assert closed is not None and closed.stripe_requirements["disabled_reason"] == "closed"


async def _deferred(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, event_id: str
) -> tuple[str, str]:
    """A card payment whose success arrived before Stripe could show its fees."""
    pay_id, pi = await _invoice_payment(api, db)
    gateway.pending_fees.add(pi)
    gateway.objects[("acct_test", "payment_intent", pi)] = {
        "id": pi,
        "object": "payment_intent",
        "status": "succeeded",
    }
    body = json.dumps(
        {
            "id": event_id,
            "type": "payment_intent.succeeded",
            "account": "acct_test",
            "data": {"object": {"id": pi, "metadata": {"business_id": BIZ}}},
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers=STRIPE)
    assert (res.status_code, res.json()["error"]) == (503, "retry_later")
    await _received(db, event_id, clock.now())
    return pay_id, pi


async def _received(db: AsyncSession, event_id: str, at: datetime) -> None:
    await db.execute(update(Webhook).where(Webhook.id == event_id).values(created_at=at))
    await db.flush()


async def _status(db: AsyncSession, payment_id: str) -> str:
    payment = await db.get(Payment, payment_id, populate_existing=True)
    assert payment is not None
    return payment.status


async def test_a_payment_deferred_for_its_fees_settles_within_a_minute_once(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    pay_id, pi = await _deferred(api, db, gateway, "evt_early")
    assert await run_retry_deferred_payments(db, gateway) == 0
    assert await _status(db, pay_id) == "pending"
    gateway.pending_fees.discard(pi)
    assert await run_retry_deferred_payments(db, gateway) == 1
    assert await _status(db, pay_id) == "succeeded"
    assert await run_retry_deferred_payments(db, gateway) == 0
    late = _succeeded("evt_early", pi, int(clock.now().timestamp()))
    assert (await api.post("/webhooks/stripe", content=late, headers=STRIPE)).status_code == 200
    journals = await db.scalar(
        select(func.count(func.distinct(Entry.journal_id))).where(Entry.ref == f"payment:{pay_id}")
    )
    assert journals == 1


async def test_a_deferral_older_than_the_window_is_left_to_the_hourly_jobs(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    pay_id, pi = await _deferred(api, db, gateway, "evt_old")
    gateway.pending_fees.discard(pi)
    await _received(db, "evt_old", clock.now() - timedelta(minutes=31))
    assert await run_retry_deferred_payments(db, gateway) == 0
    assert await _status(db, pay_id) == "pending"


async def test_a_deferred_intent_claiming_another_business_settles_nothing(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, factory: Factory
) -> None:
    pay_id, pi = await _deferred(api, db, gateway, "evt_claim")
    gateway.pending_fees.discard(pi)
    other = await factory.business()
    other.stripe_account_id = "acct_other"
    await db.flush()
    gateway.objects[("acct_other", "payment_intent", pi)] = {
        "id": pi,
        "object": "payment_intent",
        "status": "succeeded",
        "metadata": {"business_id": other.id},
    }
    claim = {"id": pi, "metadata": {"business_id": other.id}}
    await db.execute(update(Webhook).where(Webhook.id == "evt_claim").values(payload=claim))
    await db.flush()
    assert await run_retry_deferred_payments(db, gateway) == 0
    assert await _status(db, pay_id) == "pending"


async def test_a_deposit_deferred_for_its_fees_is_collected_within_a_minute(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    booked = await api.post(
        "/book/birchbark",
        json={
            "item_id": "it_groom_lg",
            "staff_id": "st_owner",
            "starts_at": "2027-03-02T16:00:00Z",
            "client": {"name": "Quick Payer", "phone": "+16045550279"},
        },
    )
    booking_id = str(booked.json()["booking_id"])
    pay_id = await deposit_payment(db, booking_id)
    pi = await provider_ref(db, pay_id)
    gateway.pending_fees.add(pi)
    gateway.objects[("acct_test", "payment_intent", pi)] = {
        "id": pi,
        "object": "payment_intent",
        "status": "succeeded",
    }
    intent = {"id": pi, "metadata": {"business_id": BIZ, "booking_id": booking_id}}
    body = json.dumps(
        {
            "id": "evt_deposit_fees",
            "type": "payment_intent.succeeded",
            "account": "acct_test",
            "data": {"object": intent},
        }
    )
    held = await api.post("/webhooks/stripe", content=body, headers=STRIPE)
    assert (held.status_code, held.json()["error"]) == (503, "retry_later")
    assert await run_retry_deferred_payments(db, gateway) == 0
    gateway.pending_fees.discard(pi)
    assert await run_retry_deferred_payments(db, gateway) == 1
    assert await run_retry_deferred_payments(db, gateway) == 0
    assert await _status(db, pay_id) == "succeeded"
    booking = await db.get(Booking, booking_id, populate_existing=True)
    assert booking is not None and booking.deposit_status == "collected"
