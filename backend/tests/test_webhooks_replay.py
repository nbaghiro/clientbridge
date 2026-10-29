"""Unapplied events are kept, missed ones replay from current state, and stale news stays quiet."""

import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.integrations.stripe import MissedEvent
from clientbridge.models.messaging import Delivery
from clientbridge.models.payments import Payment
from clientbridge.services import payments
from clientbridge.services.payments import run_replay_missed_events
from tests.conftest import FakePaymentGateway
from tests.helpers import STRIPE, card_pay, enable_payments, provider_ref, sent_invoice


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
