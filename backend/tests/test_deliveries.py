from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import Unprocessable
from clientbridge.integrations.resend import Email
from clientbridge.models.messaging import Delivery
from clientbridge.schemas.deliveries import EmailDelivery
from clientbridge.services.deliveries import dispatch, enqueue, run_deliveries
from tests.conftest import BIZ, FakeEmailSender, FakePushSender, FakeSmsSender


def mail(body: str = "Receipt") -> EmailDelivery:
    return EmailDelivery(message=Email(to="pat@example.ca", subject="Payment", body=body))


async def test_delivery_key_replays_same_content_and_rejects_a_different_request(
    db: AsyncSession,
) -> None:
    first = await enqueue(db, mail(), key="receipt:test", business_id=BIZ)
    assert await enqueue(db, mail(), key="receipt:test", business_id=BIZ) == first
    with pytest.raises(Unprocessable):
        await enqueue(db, mail("Different"), key="receipt:test", business_id=BIZ)
    assert len(list(await db.scalars(select(Delivery).where(Delivery.key == "receipt:test")))) == 1


async def test_connection_failure_is_retried_once_and_accepted_delivery_is_not_resent(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await enqueue(db, mail(), key="receipt:retry", business_id=BIZ)
    await db.commit()
    original = email.send

    async def unavailable(_: Email) -> str | None:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(email, "send", unavailable)
    assert not await dispatch(db, identity, email, sms, push)
    row = await db.get(Delivery, identity)
    assert row is not None and row.state == "queued" and row.next_at is not None
    monkeypatch.setattr(email, "send", original)
    row.next_at = clock.now()
    await db.commit()
    assert await run_deliveries(db, email, sms, push) == 1
    assert await run_deliveries(db, email, sms, push) == 0
    assert len(email.sent) == 1 and email.sent[0].idempotency_key == identity


async def test_expired_worker_claim_is_ambiguous_and_never_blindly_resent(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    identity = await enqueue(db, mail(), key="receipt:crash", business_id=BIZ)
    row = await db.get(Delivery, identity)
    assert row is not None
    row.state, row.claim, row.next_at = (
        "sending",
        "crashed-worker",
        clock.now() - timedelta(seconds=1),
    )
    await db.commit()
    assert await run_deliveries(db, email, sms, push) == 0
    await db.refresh(row)
    assert row.state == "ambiguous" and row.next_at is None
    assert email.sent == []


async def test_unknown_send_failure_preserves_an_ambiguous_outcome(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await enqueue(db, mail(), key="receipt:timeout", business_id=BIZ)
    await db.commit()

    async def timeout(_: Email) -> str | None:
        raise httpx.ReadTimeout("response lost after request")

    monkeypatch.setattr(email, "send", timeout)
    assert not await dispatch(db, identity, email, sms, push)
    row = await db.get(Delivery, identity)
    assert row is not None and row.state == "ambiguous" and row.next_at is None


async def test_only_one_worker_sends_and_a_callback_fences_its_completion(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    import json
    import uuid

    from sqlalchemy import delete

    from clientbridge.core.db import SessionLocal
    from clientbridge.models.platform import Webhook
    from clientbridge.services.messaging import process_email_event

    started, release = asyncio.Event(), asyncio.Event()
    event_id = uuid.uuid4().hex
    original = email.send

    async def slow(message: Email) -> str | None:
        started.set()
        await release.wait()
        return await original(message)

    monkeypatch.setattr(email, "send", slow)
    async with SessionLocal() as setup:
        identity = await enqueue(setup, mail(), key=f"race:{event_id}", business_id=None)
        await setup.commit()

    async def worker() -> bool:
        async with SessionLocal() as session:
            return await dispatch(session, identity, email, sms, push)

    task = asyncio.create_task(worker())
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        assert not await worker()
        async with SessionLocal() as callback:
            await process_email_event(
                callback,
                svix_id=event_id,
                payload=json.dumps(
                    {
                        "type": "email.delivered",
                        "created_at": clock.now().isoformat(),
                        "data": {
                            "email_id": "mail_race",
                            "to": ["pat@example.ca"],
                            "tags": {"delivery": identity},
                        },
                    }
                ).encode(),
            )
            await callback.commit()
        release.set()
        assert not await asyncio.wait_for(task, timeout=5)
        async with SessionLocal() as check:
            row = await check.get(Delivery, identity)
            assert row is not None and row.state == "delivered"
            assert row.provider_ref == "mail_race" and row.claim is None
        assert len(email.sent) == 1
    finally:
        release.set()
        await task
        async with SessionLocal() as cleanup:
            await cleanup.execute(delete(Delivery).where(Delivery.id == identity))
            await cleanup.execute(delete(Webhook).where(Webhook.id == f"resend_{event_id}"))
            await cleanup.commit()


async def test_rolled_back_delivery_is_never_visible_to_a_worker(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    import uuid

    from clientbridge.core.db import SessionLocal

    async with SessionLocal() as transaction:
        identity = await enqueue(transaction, mail(), key=uuid.uuid4().hex, business_id=None)
        await transaction.rollback()
    async with SessionLocal() as worker:
        assert not await dispatch(worker, identity, email, sms, push)
    assert email.sent == []
