from datetime import timedelta
from email.message import EmailMessage
from typing import Literal

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.emails import reserved_email
from clientbridge.core.errors import Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.phones import reserved_phone
from clientbridge.integrations.resend import Email, SmtpEmailSender
from clientbridge.integrations.twilio import ConsoleSmsSender, Sms
from clientbridge.models.business import Business
from clientbridge.models.messaging import Delivery, Message, Thread
from clientbridge.schemas.deliveries import DeliveryPayload, EmailDelivery, SmsDelivery
from clientbridge.services.consents import record_text_reply
from clientbridge.services.deliveries import (
    DELIVERIES_JOB,
    delivery_key,
    dispatch,
    enqueue,
    run_deliveries,
    send_queued,
)
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeJobs, FakePushSender, FakeSmsSender


def mail(body: str = "Receipt") -> EmailDelivery:
    return EmailDelivery(message=Email(to="pat@example.ca", subject="Payment", body=body))


def text(to: str) -> SmsDelivery:
    return SmsDelivery(message=Sms(to=to, body="Reminder", from_number="+12365550190"))


async def test_in_production_reserved_recipients_fail_without_reaching_the_provider(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "env", "prod")
    reserved: list[DeliveryPayload] = [
        EmailDelivery(message=Email(to="Pat@EXAMPLE.COM", subject="Hi", body="Hi")),
        EmailDelivery(message=Email(to="pat@mail.example.org", subject="Hi", body="Hi")),
        EmailDelivery(message=Email(to="hannah@birchbark.example", subject="Hi", body="Hi")),
        EmailDelivery(message=Email(to="pat@clinic.test", subject="Hi", body="Hi")),
        text("+12505550142"),
    ]
    real: list[DeliveryPayload] = [mail(), text("+12505550200"), text("+12505551234")]
    ids = {
        await enqueue(db, payload, key=f"reserved:{index}", business_id=BIZ): payload
        for index, payload in enumerate([*reserved, *real])
    }
    await db.commit()
    await run_deliveries(db, email, sms, push)
    rows = {row.id: row for row in await db.scalars(select(Delivery).where(Delivery.id.in_(ids)))}
    for identity, payload in ids.items():
        expected = ("failed", "reserved_address") if payload in reserved else ("accepted", None)
        assert (rows[identity].state, rows[identity].error) == expected
    assert {m.to for m in email.sent if m.tags.get("delivery") in ids} == {"pat@example.ca"}
    texted = {m.to for m in sms.sent}
    assert {"+12505550200", "+12505551234"} <= texted and "+12505550142" not in texted


@pytest.mark.parametrize("env", ["dev", "staging"])
async def test_outside_production_reserved_recipients_are_sent_in_simulation(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
    monkeypatch: pytest.MonkeyPatch,
    env: Literal["dev", "staging"],
) -> None:
    monkeypatch.setattr(get_settings(), "env", env)
    business = await db.get(Business, BIZ)
    assert business is not None
    client = await factory.client(business=business)
    thread = Thread(id=new_id("thread"), business_id=BIZ, client_id=client.id, channel="sms")
    db.add(thread)
    await db.flush()
    message = Message(
        id=new_id("message"),
        business_id=BIZ,
        thread_id=thread.id,
        direction="out",
        channel="sms",
        body="Reminder",
        status="queued",
    )
    db.add(message)
    await db.flush()
    sms_payload = SmsDelivery(
        message=Sms(to="+12505550142", body="Reminder", from_number="+12365550190"),
        message_id=message.id,
    )
    email_payload = EmailDelivery(
        message=Email(to="hannah@birchbark.example", subject="Hi", body="Hi")
    )
    ids = [
        await enqueue(db, sms_payload, key=f"simulated:{env}:sms", business_id=BIZ),
        await enqueue(db, email_payload, key=f"simulated:{env}:email", business_id=BIZ),
    ]
    await db.commit()
    assert [await dispatch(db, identity, email, sms, push) for identity in ids] == [True, True]
    rows = list(await db.scalars(select(Delivery).where(Delivery.id.in_(ids))))
    assert {(row.state, row.error, row.provider_ref) for row in rows} == {("accepted", None, None)}
    assert (email.sent, sms.sent) == ([], [])
    await db.refresh(message)
    assert message.status == "sent"


async def test_a_local_sink_receives_a_reserved_recipient_outside_production(
    db: AsyncSession,
    email: FakeEmailSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mailpit: list[EmailMessage] = []

    def deliver(_: SmtpEmailSender, message: EmailMessage) -> None:
        mailpit.append(message)

    monkeypatch.setattr(SmtpEmailSender, "_deliver", deliver)
    smtp = SmtpEmailSender("smtp://localhost:1025", "no-reply@clientbridge.ca")
    console = ConsoleSmsSender()
    mail_id = await enqueue(
        db,
        EmailDelivery(message=Email(to="hannah@birchbark.example", subject="Hi", body="Hi")),
        key="sink:email",
        business_id=BIZ,
    )
    text_id = await enqueue(db, text("+12505550142"), key="sink:sms", business_id=BIZ)
    await db.commit()
    assert await dispatch(db, mail_id, smtp, console, push)
    assert await dispatch(db, text_id, email, console, push)
    assert [m["To"] for m in mailpit] == ["hannah@birchbark.example"]
    monkeypatch.setattr(get_settings(), "env", "prod")
    refused = await enqueue(db, text("+12505550143"), key="sink:prod", business_id=BIZ)
    await db.commit()
    assert not await dispatch(db, refused, email, console, push)
    row = await db.get(Delivery, refused)
    assert row is not None and (row.state, row.error) == ("failed", "reserved_address")


@pytest.mark.parametrize(
    ("address", "reserved"),
    [
        ("pat@example.com", True),
        ("pat@EXAMPLE.NET", True),
        ("pat@shop.example.org.", True),
        ("pat@birchbark.example", True),
        ("pat@clinic.test", True),
        ("pat@host.invalid", True),
        ("pat@localhost", True),
        ("pat@example.ca", False),
        ("pat@notexample.com", False),
        ("pat@example.com.au", False),
        ("pat@testing.ca", False),
    ],
)
def test_reserved_email_domains(address: str, reserved: bool) -> None:
    assert reserved_email(address) is reserved


@pytest.mark.parametrize(
    ("number", "reserved"),
    [
        ("+12505550100", True),
        ("(604) 555-0199", True),
        ("+12505550200", False),
        ("+12505550099", False),
        ("+12505551234", False),
        ("+442079460100", False),
        ("not a number", False),
    ],
)
def test_reserved_phone_numbers(number: str, reserved: bool) -> None:
    assert reserved_phone(number) is reserved


async def test_delivery_key_replays_same_content_and_rejects_a_different_request(
    db: AsyncSession,
) -> None:
    first = await enqueue(db, mail(), key="receipt:test", business_id=BIZ)
    assert await enqueue(db, mail(), key="receipt:test", business_id=BIZ) == first
    with pytest.raises(Unprocessable):
        await enqueue(db, mail("Different"), key="receipt:test", business_id=BIZ)
    assert len(list(await db.scalars(select(Delivery).where(Delivery.key == "receipt:test")))) == 1


def test_a_delivery_key_dedupes_by_subject_unless_each_call_sends() -> None:
    assert delivery_key("payment", "pay_1") == "payment:pay_1"
    first, second = (delivery_key("invoice-sent", "inv_1", each=True) for _ in range(2))
    assert first.startswith("invoice-sent:inv_1:dlv_") and first != second


async def test_send_queued_sends_what_the_session_queued_once_and_then_forgets_it(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await send_queued(db, email, sms, push)
    first = await enqueue(db, mail(), key="receipt:collected", business_id=BIZ)
    assert await enqueue(db, mail(), key="receipt:collected", business_id=BIZ) == first
    await enqueue(db, mail("Other"), key="receipt:other", business_id=BIZ)
    await db.commit()
    assert await send_queued(db, email, sms, push) == 2
    assert await send_queued(db, email, sms, push) == 0
    assert len(email.sent) == 2


async def test_a_request_sends_one_notice_and_wakes_the_worker_for_the_rest(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    jobs: FakeJobs,
) -> None:
    jobs.work = False
    for each in range(3):
        await enqueue(db, mail(f"Notice {each}"), key=f"receipt:bulk{each}", business_id=BIZ)
    await db.commit()
    assert await send_queued(db, email, sms, push, jobs) == 1
    assert [m.body for m in email.sent] == ["Notice 0"] and jobs.enqueued == [DELIVERIES_JOB]
    assert await run_deliveries(db, email, sms, push) == 2
    assert sorted(m.body for m in email.sent) == ["Notice 0", "Notice 1", "Notice 2"]


async def test_a_request_with_nothing_left_does_not_wake_the_worker(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    jobs: FakeJobs,
) -> None:
    await enqueue(db, mail(), key="receipt:single", business_id=BIZ)
    await db.commit()
    assert await send_queued(db, email, sms, push, jobs) == 1
    assert await send_queued(db, email, sms, push, jobs, inline=0) == 0
    assert jobs.enqueued == []


async def test_a_webhook_sends_nothing_inline_and_leaves_it_to_the_worker(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    jobs: FakeJobs,
) -> None:
    jobs.work = False
    identity = await enqueue(db, mail(), key="receipt:webhook", business_id=BIZ)
    await db.commit()
    assert await send_queued(db, email, sms, push, jobs, inline=0) == 0
    assert email.sent == [] and jobs.enqueued == [DELIVERIES_JOB]
    row = await db.get(Delivery, identity)
    assert row is not None and row.state == "queued"


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

    def ours() -> list[Email]:
        return [m for m in email.sent if m.tags.get("delivery") == identity]

    await run_deliveries(db, email, sms, push)
    await db.refresh(row)
    assert row.state == "accepted" and len(ours()) == 1
    await run_deliveries(db, email, sms, push)
    assert len(ours()) == 1 and ours()[0].idempotency_key == identity


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
    await run_deliveries(db, email, sms, push)
    await db.refresh(row)
    assert row.state == "ambiguous" and row.next_at is None
    assert not [m for m in email.sent if m.tags.get("delivery") == identity]


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


async def test_a_text_queued_before_a_stop_is_skipped_for_consent(
    db: AsyncSession,
    factory: Factory,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    business = await factory.business()
    client = await factory.client(business=business)
    client.phone = "(250) 555-1234"
    other = await factory.business()
    await db.flush()
    queued = await enqueue(db, text("+12505551234"), key="notice:stopped", business_id=business.id)
    elsewhere = await enqueue(
        db, text("+12505551234"), key="notice:elsewhere", business_id=other.id
    )
    await db.commit()
    await record_text_reply(db, client, stop=True)
    await db.commit()
    await run_deliveries(db, email, sms, push)
    rows = {
        r.id: r
        for r in await db.scalars(select(Delivery).where(Delivery.id.in_([queued, elsewhere])))
    }
    assert (rows[queued].state, rows[queued].error) == ("failed", "consent_withdrawn")
    assert rows[elsewhere].state == "accepted"
    assert len([m for m in sms.sent if m.to == "+12505551234"]) == 1


async def test_a_stop_still_holds_back_a_simulated_text(
    db: AsyncSession,
    factory: Factory,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    business = await factory.business()
    client = await factory.client(business=business)
    client.phone = "(250) 555-0142"
    await db.flush()
    queued = await enqueue(db, text("+12505550142"), key="notice:demo", business_id=business.id)
    await db.commit()
    await record_text_reply(db, client, stop=True)
    await db.commit()
    assert not await dispatch(db, queued, email, sms, push)
    row = await db.get(Delivery, queued)
    assert row is not None and (row.state, row.error) == ("failed", "consent_withdrawn")
