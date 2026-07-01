from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.crm import Client
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.services.message_service import run_due_broadcasts
from tests.conftest import Factory, FakeEmailSender, FakeSmsSender

BIZ = "bz_birchbark"


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


async def _client_with_contact(
    db: AsyncSession, *, email: str | None = None, phone: str | None = None
) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    await db.execute(update(Client).where(Client.id == cid).values(email=email, phone=phone))
    await db.flush()
    return cid


async def _thread_for(db: AsyncSession, cid: str, channel: str) -> Thread | None:
    return (
        await db.execute(
            select(Thread).where(
                Thread.business_id == BIZ, Thread.client_id == cid, Thread.channel == channel
            )
        )
    ).scalar_one_or_none()


async def test_send_sms_records_out_message(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    res = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi there"}
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["id"].startswith("msg_")
    assert out["direction"] == "out"
    assert out["channel"] == "sms"
    assert out["status"] == "sent"
    assert (
        len(sms.sent) == 1 and sms.sent[0].to == "+15145551234" and sms.sent[0].body == "Hi there"
    )
    thread = await _thread_for(db, cid, "sms")
    assert thread is not None and thread.id == out["thread_id"]
    assert thread.last_message_at is not None


async def test_second_message_reuses_thread(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    first = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "one"}
    )
    second = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "two"}
    )
    assert first.json()["thread_id"] == second.json()["thread_id"]
    threads = (
        (await db.execute(select(Thread).where(Thread.business_id == BIZ, Thread.client_id == cid)))
        .scalars()
        .all()
    )
    assert len(threads) == 1
    assert len(sms.sent) == 2


async def test_send_email_path_as_staff(
    as_staff: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca")
    res = await as_staff.post(
        "/v1/messages", json={"client_id": cid, "channel": "email", "body": "Hello"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "sent"
    assert len(email.sent) == 1 and email.sent[0].to == "pat@example.ca"
    assert email.sent[0].body == "Hello"


async def test_missing_contact_is_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_with_contact(db, email=None, phone=None)
    res = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi"}
    )
    assert res.status_code == 422


async def test_unknown_client_is_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/messages", json={"client_id": "cl_nope", "channel": "sms", "body": "Hi"}
    )
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
    res = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "failed"
    status = (
        await db.execute(select(Message.status).where(Message.id == res.json()["id"]))
    ).scalar_one()
    assert status == "failed"


async def test_send_is_idempotent(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client_with_contact(db, phone="+15145551234")
    body = {"client_id": cid, "channel": "sms", "body": "Hi"}
    headers = {"Idempotency-Key": "msg-1"}
    first = await as_owner.post("/v1/messages", json=body, headers=headers)
    second = await as_owner.post("/v1/messages", json=body, headers=headers)
    assert first.json()["id"] == second.json()["id"]
    assert len(sms.sent) == 1  # the replay does not re-dispatch


async def test_broadcast_fans_out(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
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
    await db.flush()
    res = await as_owner.post(
        "/v1/broadcasts", json={"name": "Spring promo", "channel": "sms", "body": "Sale!"}
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["status"] == "sent"
    assert out["recipient_count"] == 3
    assert len(sms.sent) == 3


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
        channel="sms",
        status="open",
        unread_count=3,
    )
    db.add(thread)
    await db.flush()
    res = await as_owner.post(f"/v1/threads/{thread.id}/read")
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["unread_count"] == 0
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
        channel="sms",
        status="open",
        unread_count=2,
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
    res = await as_owner.post(
        "/v1/messages", json={"client_id": foreign.id, "channel": "sms", "body": "Hi"}
    )
    assert res.status_code == 404


async def test_broadcast_excludes_other_business(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, sms: FakeSmsSender
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
    await db.flush()
    res = await as_owner.post(
        "/v1/broadcasts", json={"name": "Ours only", "channel": "sms", "body": "Sale!"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["recipient_count"] == 1  # only our own client, never the foreign one
    assert [m.to for m in sms.sent] == ["+15145559001"]


async def test_broadcast_audience_tag_filter(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add_all(
        [
            _active_client(name="VIP", phone="+15145559001", tags=["vip"]),
            _active_client(name="Regular", phone="+15145559002", tags=["regular"]),
        ]
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/broadcasts",
        json={"name": "VIP sale", "channel": "sms", "body": "Hi", "audience": {"tags": ["vip"]}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["recipient_count"] == 1
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145559001"  # only the tagged client


async def test_schedule_broadcast_does_not_send_now(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add(_active_client(name="Later", phone="+15145559003", tags=[]))
    await db.flush()
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    res = await as_owner.post(
        "/v1/broadcasts",
        json={"name": "Promo", "channel": "sms", "body": "Soon", "scheduled_at": future},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "scheduled"
    assert sms.sent == []  # nothing dispatched yet
    row = (await db.execute(select(Broadcast).where(Broadcast.id == res.json()["id"]))).scalar_one()
    assert row.status == "scheduled" and row.scheduled_at is not None and row.body == "Soon"


async def test_run_due_broadcasts_sends_when_due(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    db.add(_active_client(name="Due", phone="+15145559004", tags=[]))
    await db.flush()
    # a past `now` so the seeded future-scheduled broadcast (bro_winback) can't also fire
    now = datetime(2020, 1, 2, tzinfo=UTC)
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=BIZ,
        name="Scheduled",
        channel="sms",
        body="Hello",
        audience={},
        status="scheduled",
        scheduled_at=datetime(2020, 1, 1, tzinfo=UTC),
    )
    db.add(broadcast)
    await db.flush()
    assert await run_due_broadcasts(db, sms, email, now) == 1
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145559004"
    row = (await db.execute(select(Broadcast).where(Broadcast.id == broadcast.id))).scalar_one()
    assert row.status == "sent"


async def test_run_due_broadcasts_skips_future(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    now = datetime(2020, 1, 2, tzinfo=UTC)
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=BIZ,
        name="NotYet",
        channel="sms",
        body="x",
        audience={},
        status="scheduled",
        scheduled_at=now + timedelta(hours=1),
    )
    db.add(broadcast)
    await db.flush()
    assert await run_due_broadcasts(db, sms, email, now) == 0
    assert sms.sent == []
