from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.integrations.twilio import Sms
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Broadcast, Delivery, Message, Thread
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.deliveries import SmsDelivery
from clientbridge.schemas.messaging import MessageSend
from clientbridge.services.consents import record_consent
from clientbridge.services.deliveries import dispatch, enqueue, run_deliveries, send_queued
from clientbridge.services.messaging import MessageService, run_due_broadcasts, unread_count
from tests.clock import FROZEN
from tests.conftest import OWNER_USER, Factory, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import local_hour, new_client

BIZ = "bz_birchbark"
OWNER = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")


def _active_client(*, name: str, phone: str, tags: list[str]) -> Client:
    return Client(
        id=new_id("client"),
        business_id=BIZ,
        name=name,
        phone=phone,
        status="active",
        tags=tags,
        custom_fields={},
    )


async def _agree_to_texts(db: AsyncSession) -> None:
    """Record a yes to texts for every client added in the test (the seed clients have none)."""
    await db.flush()
    rows = (await db.execute(select(Client).where(Client.business_id == BIZ))).scalars().all()
    for client in rows:
        await record_consent(
            db,
            BIZ,
            client.id,
            status="granted",
            source="in_person",
            recorded_by=None,
        )


async def _client_with_contact(db: AsyncSession, *, phone: str | None = None) -> str:
    cid = await new_client(db)
    await db.execute(update(Client).where(Client.id == cid).values(phone=phone))
    await db.flush()
    return cid


async def _thread_for(db: AsyncSession, cid: str) -> Thread | None:
    return (
        await db.execute(select(Thread).where(Thread.business_id == BIZ, Thread.client_id == cid))
    ).scalar_one_or_none()


async def test_send_sms_records_out_message(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    res = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi there"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["id"].startswith("msg_")
    assert out["direction"] == "out"
    assert out["status"] == "sent"
    assert (
        len(sms.sent) == 1 and sms.sent[0].to == "+15145551234" and sms.sent[0].body == "Hi there"
    )
    stored = (await db.execute(select(Message).where(Message.id == out["id"]))).scalar_one()
    assert stored.provider_ref == "sms_fake1"
    thread = await _thread_for(db, cid)
    assert thread is not None and thread.id == out["thread_id"]


async def test_second_message_reuses_thread(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    first = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "one"})
    second = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "two"})
    assert first.json()["thread_id"] == second.json()["thread_id"]
    threads = (
        (await db.execute(select(Thread).where(Thread.business_id == BIZ, Thread.client_id == cid)))
        .scalars()
        .all()
    )
    assert len(threads) == 1
    assert len(sms.sent) == 2


async def test_missing_contact_is_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_with_contact(db, phone=None)
    res = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"})
    assert res.status_code == 422


async def test_unknown_client_is_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/messages", json={"client_id": "cl_nope", "body": "Hi"})
    assert res.status_code == 404


async def test_failing_sender_marks_failed(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")

    async def boom(_: object) -> None:
        raise RuntimeError("twilio down")

    monkeypatch.setattr(sms, "send", boom)
    res = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "failed"
    status = (
        await db.execute(select(Message.status).where(Message.id == res.json()["id"]))
    ).scalar_one()
    assert status == "failed"


async def test_a_message_reaches_the_provider_only_after_its_command_commits(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender, push: FakePushSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    service = MessageService(db, OWNER)
    queued = await service.send_message(MessageSend(client_id=cid, body="Hi"))
    assert queued.status == "queued" and sms.sent == []
    delivery = await db.scalar(select(Delivery).where(Delivery.key == f"message:{queued.id}"))
    assert delivery is not None and delivery.state == "queued"
    await send_queued(db, email, sms, push)
    assert len(sms.sent) == 1 and (await service.message(queued.id)).status == "sent"


async def test_a_message_waiting_for_a_retry_shows_queued_until_it_is_accepted(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    email: FakeEmailSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    real = sms.send

    async def offline(_: Sms) -> str | None:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(sms, "send", offline)
    res = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"})
    assert res.status_code == 200 and res.json()["status"] == "queued"
    monkeypatch.setattr(sms, "send", real)
    clock.travel(FROZEN + timedelta(minutes=2))
    await run_deliveries(db, email, sms, push)
    stored = await db.get(Message, res.json()["id"], populate_existing=True)
    assert stored is not None and stored.status == "sent" and stored.provider_ref is not None


async def test_a_delivery_never_changes_another_business_message(
    db: AsyncSession,
    factory: Factory,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    other = await factory.business()
    cid = await _client_with_contact(db, phone="+15145551234")
    sent = await MessageService(db, OWNER).send_message(MessageSend(client_id=cid, body="Hi"))
    db.info.clear()
    foreign = SmsDelivery(
        message=Sms(to="+15145551234", body="x", from_number="+12365550190"), message_id=sent.id
    )
    identity = await enqueue(db, foreign, key="message:foreign", business_id=other.id)
    await db.commit()
    await dispatch(db, identity, email, sms, push)
    stored = await db.get(Message, sent.id, populate_existing=True)
    assert stored is not None and stored.status == "queued"


async def test_send_is_idempotent(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    body = {"client_id": cid, "body": "Hi"}
    headers = {"Idempotency-Key": "msg-1"}
    first = await as_owner.post("/v1/messages", json=body, headers=headers)
    second = await as_owner.post("/v1/messages", json=body, headers=headers)
    assert first.json()["id"] == second.json()["id"]
    assert len(sms.sent) == 1  # the replay does not re-dispatch


async def test_broadcast_fans_out(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    for i in range(3):
        db.add(
            Client(
                id=new_id("client"),
                business_id=BIZ,
                name=f"Reach {i}",
                phone=f"+1514555900{i}",
                status="active",
                tags=[],
                custom_fields={},
            )
        )
    await _agree_to_texts(db)
    now = await local_hour(db, 12)
    res = await as_owner.post("/v1/broadcasts", json={"name": "Spring promo", "body": "Sale!"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["status"] == "sending" and out["scheduled_at"] is None
    assert out["recipient_count"] == 3
    assert sms.sent == []  # the job sends it, not the request
    assert await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now) >= 1
    assert len(sms.sent) == 3
    assert email.sent == []


async def test_mark_thread_read_zeroes_unread(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Unread Client",
        phone="+15145551234",
        status="active",
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    thread = Thread(
        id=new_id("thread"),
        business_id=BIZ,
        client_id=client.id,
        status="open",
    )
    db.add(thread)
    await db.flush()
    for i in range(3):
        db.add(
            Message(
                id=new_id("message"),
                business_id=BIZ,
                thread_id=thread.id,
                direction="in",
                body=f"ping {i}",
                status="delivered",
            )
        )
    await db.flush()
    assert await unread_count(db, thread) == 3
    res = await as_owner.post(f"/v1/threads/{thread.id}/read")
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["unread_count"] == 0
    assert await unread_count(db, thread) == 0
    assert out["status"] == "open"


async def test_mark_unknown_thread_is_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/threads/th_nope/read")
    assert res.status_code == 404


async def test_thread_tenant_isolation(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    thread = Thread(
        id=new_id("thread"),
        business_id=other.id,
        client_id=foreign.id,
        status="open",
    )
    db.add(thread)
    await db.flush()
    res = await as_owner.post(f"/v1/threads/{thread.id}/read")
    assert res.status_code == 404


async def test_send_to_foreign_client_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    # a real, fully-contactable client in ANOTHER business 404s (scoped lookup, not mere existence)
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    foreign.phone = "+15145550000"
    await db.flush()
    res = await as_owner.post("/v1/messages", json={"client_id": foreign.id, "body": "Hi"})
    assert res.status_code == 404


async def test_staff_cannot_send_a_broadcast_403(
    as_staff: httpx.AsyncClient, sms: FakeSmsSender
) -> None:
    res = await as_staff.post("/v1/broadcasts", json={"name": "Promo", "body": "Sale!"})
    assert res.status_code == 403
    assert sms.sent == []


async def test_broadcast_excludes_other_business(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    sms: FakeSmsSender,
    email: FakeEmailSender,
) -> None:
    # null the seed phones so only the clients added here are reachable
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add(
        Client(
            id=new_id("client"),
            business_id=BIZ,
            name="Ours",
            phone="+15145559001",
            status="active",
            tags=[],
            custom_fields={},
        )
    )
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    foreign.phone = "+15145559999"  # fully contactable, but a different business
    await _agree_to_texts(db)
    now = await local_hour(db, 12)
    res = await as_owner.post("/v1/broadcasts", json={"name": "Ours only", "body": "Sale!"})
    assert res.status_code == 200, res.text
    await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now)
    assert res.json()["recipient_count"] == 1  # only our own client, never the foreign one
    assert [m.to for m in sms.sent] == ["+15145559001"]


async def test_broadcast_audience_tag_filter(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add_all(
        [
            _active_client(name="VIP", phone="+15145559001", tags=["vip"]),
            _active_client(name="Regular", phone="+15145559002", tags=["regular"]),
        ]
    )
    await _agree_to_texts(db)
    now = await local_hour(db, 12)
    res = await as_owner.post(
        "/v1/broadcasts",
        json={"name": "VIP sale", "body": "Hi", "audience": {"tags": ["vip"]}},
    )
    assert res.status_code == 200, res.text
    await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now)
    assert res.json()["recipient_count"] == 1
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145559001"  # only the tagged client


async def test_schedule_broadcast_does_not_send_now(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add(_active_client(name="Later", phone="+15145559003", tags=[]))
    await db.flush()
    future = (clock.now() + timedelta(days=1)).isoformat()
    res = await as_owner.post(
        "/v1/broadcasts",
        json={"name": "Promo", "body": "Soon", "scheduled_at": future},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "scheduled"
    assert sms.sent == []  # nothing dispatched yet
    row = (await db.execute(select(Broadcast).where(Broadcast.id == res.json()["id"]))).scalar_one()
    assert row.status == "scheduled" and row.scheduled_at is not None and row.body == "Soon"


async def test_run_due_broadcasts_sends_when_due(db: AsyncSession, sms: FakeSmsSender) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add(_active_client(name="Due", phone="+15145559004", tags=[]))
    await _agree_to_texts(db)
    # a past `now` so the seeded future-scheduled broadcast (bro_winback) can't also fire
    now = datetime(2020, 1, 2, tzinfo=UTC)
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=BIZ,
        name="Scheduled",
        body="Hello",
        audience={},
        status="scheduled",
        scheduled_at=datetime(2020, 1, 1, tzinfo=UTC),
    )
    db.add(broadcast)
    await db.flush()
    assert await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now) == 1
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145559004"
    row = (await db.execute(select(Broadcast).where(Broadcast.id == broadcast.id))).scalar_one()
    assert row.status == "sent"


async def test_run_due_broadcasts_skips_future(db: AsyncSession, sms: FakeSmsSender) -> None:
    now = datetime(2020, 1, 2, tzinfo=UTC)
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=BIZ,
        name="NotYet",
        body="x",
        audience={},
        status="scheduled",
        scheduled_at=now + timedelta(hours=1),
    )
    db.add(broadcast)
    await db.flush()
    assert await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now) == 0
    assert sms.sent == []


async def test_a_text_goes_to_the_e164_number_of_a_phone_stored_as_typed(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="(514) 555-1234")
    ok = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"})
    assert ok.status_code == 200, ok.text
    assert [m.to for m in sms.sent] == ["+15145551234"]


async def _visit_for(db: AsyncSession, cid: str, token: str | None) -> str:
    slot = (await db.execute(select(Booking.slot_id).limit(1))).scalar_one()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot,
        starts_at=clock.now(),
        client_id=cid,
        status="completed",
        source="manual",
        manage_token=token,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_a_visit_note_carries_the_visit_link(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    visit = await _visit_for(db, cid, "tok_visit_note")
    res = await as_owner.post(
        "/v1/messages",
        json={"client_id": cid, "body": "Bella was great", "booking_id": visit},
    )
    assert res.status_code == 200, res.text
    [sent] = sms.sent
    assert sent.body.startswith("Bella was great") and sent.body.endswith("/m/tok_visit_note")
    stored = await db.get(Message, res.json()["id"])
    assert stored is not None and stored.body == sent.body


async def test_a_visit_note_for_another_clients_visit_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    other = await _client_with_contact(db, phone="+15145559876")
    visit = await _visit_for(db, other, "tok_other")
    res = await as_owner.post(
        "/v1/messages",
        json={"client_id": cid, "body": "Note", "booking_id": visit},
    )
    assert res.status_code == 404
