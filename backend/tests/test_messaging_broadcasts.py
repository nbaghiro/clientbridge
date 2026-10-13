import asyncio
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.integrations.twilio import Sms
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Broadcast, Message
from clientbridge.services.consents import prefs_token, record_consent
from clientbridge.services.messaging import open_thread, run_due_broadcasts
from tests.conftest import Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import key, local_hour, ok

BIZ = "bz_birchbark"


async def _audience(db: AsyncSession) -> dict[str, str]:
    """Four reachable clients: agreed, implied, opted out, never asked; the seed is unreachable."""
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None, email=None))
    ids: dict[str, str] = {}
    for i, name in enumerate(["agreed", "implied", "stopped", "never"]):
        client = Client(
            id=new_id("client"),
            business_id=BIZ,
            name=name.title(),
            phone=f"+1514555800{i}",
            email=f"{name}@example.ca",
            status="active",
            tags=["promo"],
            custom_fields={},
        )
        db.add(client)
        ids[name] = client.id
    await db.flush()
    later = clock.now() + timedelta(days=30)
    for channel in ("sms", "email"):
        await record_consent(
            db,
            BIZ,
            ids["agreed"],
            channel=channel,
            status="granted",
            source="form",
            recorded_by=None,
        )
        await record_consent(
            db,
            BIZ,
            ids["implied"],
            channel=channel,
            status="implied",
            source="online_booking",
            recorded_by=None,
            expires_at=later,
        )
        await record_consent(
            db,
            BIZ,
            ids["stopped"],
            channel=channel,
            status="withdrawn",
            source="unsubscribe",
            recorded_by=None,
        )
    return ids


async def test_broadcast_reaches_only_clients_who_agreed(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    now = await local_hour(db, 12)
    out = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={
                "name": "Promo",
                "channel": "sms",
                "body": "Spring sale",
                "audience": {"tags": ["promo"]},
            },
        )
    ).json()
    assert (out["recipient_count"], out["excluded_count"]) == (2, 2)
    await run_due_broadcasts(db, sms, email, now)
    assert sorted(m.to for m in sms.sent) == ["+15145558000", "+15145558001"]
    assert all(m.body.endswith("Reply STOP to opt out.") for m in sms.sent)


async def test_email_broadcast_carries_a_signed_unsubscribe_link(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    ids = await _audience(db)
    now = await local_hour(db, 12)
    ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "News", "channel": "email", "body": "Hello", "audience": {"all": True}},
        )
    )
    await run_due_broadcasts(db, FakeSmsSender(), email, now)
    to_agreed = next(m for m in email.sent if m.to == "agreed@example.ca")
    assert f"/prefs/{prefs_token(ids['agreed'])}" in to_agreed.body
    assert not any(m.to == "stopped@example.ca" for m in email.sent)


async def test_broadcast_row_keeps_its_counts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    now = await local_hour(db, 12)
    out = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "Tags", "channel": "sms", "body": "Hi", "audience": {"tags": ["promo"]}},
        )
    ).json()
    await run_due_broadcasts(db, sms, email, now)
    row = (await db.execute(select(Broadcast).where(Broadcast.id == out["id"]))).scalar_one()
    assert (row.recipient_count, row.excluded_count, row.status) == (2, 2, "sent")


async def test_blank_broadcast_name_or_body_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await _audience(db)
    base = {"name": "Promo", "channel": "sms", "body": "Hi", "audience": {"tags": ["promo"]}}
    for blank in ({"name": "  "}, {"body": " \n "}):
        res = await as_owner.post("/v1/broadcasts", json={**base, **blank})
        assert res.status_code == 422
    assert sms.sent == []
    out = ok(await as_owner.post("/v1/broadcasts", json={**base, "name": "  Promo  "})).json()
    assert out["name"] == "Promo"


async def _scheduled(db: AsyncSession, *, business_id: str = BIZ) -> str:
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=business_id,
        name="Later",
        channel="sms",
        body="Soon",
        audience={},
        status="scheduled",
        scheduled_at=clock.now() + timedelta(days=1),
    )
    db.add(broadcast)
    await db.flush()
    return broadcast.id


async def test_cancel_a_scheduled_broadcast(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    bid = await _scheduled(db)
    out = ok(await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).json()
    assert out["status"] == "canceled"
    later = clock.now() + timedelta(days=2)
    await run_due_broadcasts(db, sms, email, later)
    assert sms.sent == []  # a canceled broadcast never goes out
    assert (await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 409


async def test_cancel_refuses_a_sent_broadcast(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _audience(db)
    await local_hour(db, 12)
    sent = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "Now", "channel": "sms", "body": "Hi"},
            headers=key(),
        )
    ).json()
    assert (await as_owner.post(f"/v1/broadcasts/{sent['id']}/cancel")).status_code == 409


async def test_staff_cannot_cancel(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _scheduled(db)
    assert (await as_staff.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 403


async def test_cancel_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Broadcasts")
    bid = await _scheduled(db, business_id=other.id)
    assert (await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 404
    row = (await db.execute(select(Broadcast).where(Broadcast.id == bid))).scalar_one()
    assert row.status == "scheduled"


async def test_cancel_unknown_broadcast_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/broadcasts/bc_nope/cancel")).status_code == 404


async def test_cancel_needs_a_session_401(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _scheduled(db)
    assert (await unauth.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 401


async def test_the_job_sends_a_due_broadcast_and_keeps_its_counts(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    ids = await _audience(db)
    bid = await _scheduled(db)
    await db.execute(
        update(Broadcast).where(Broadcast.id == bid).values(audience={"tags": ["promo"]})
    )
    await local_hour(db, 12)
    later = clock.now() + timedelta(days=2)
    assert await run_due_broadcasts(db, sms, email, later) >= 1
    row = (
        await db.execute(
            select(Broadcast).where(Broadcast.id == bid).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert (row.recipient_count, row.excluded_count, row.status) == (2, 2, "sent")
    stopped = await db.get(Client, ids["stopped"])
    assert stopped is not None
    assert stopped.phone not in {m.to for m in sms.sent}
    assert sorted(m.to for m in sms.sent) == ["+15145558000", "+15145558001"]


def _promo(**extra: object) -> dict[str, object]:
    return {
        "name": "Promo",
        "channel": "sms",
        "body": "Hi",
        "audience": {"tags": ["promo"]},
        **extra,
    }


async def _brand(db: AsyncSession, **changes: object) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.brand = {**business.brand, **changes}
    await db.flush()


async def test_a_broadcast_email_names_the_business_address_and_contact(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _audience(db)
    now = await local_hour(db, 12)
    await _brand(db, address="12 Main St, Victoria, BC", email="hi@birchbark.example")
    ok(await as_owner.post("/v1/broadcasts", json=_promo(channel="email", body="News")))
    await run_due_broadcasts(db, FakeSmsSender(), email, now)
    body = next(m.body for m in email.sent if m.to == "agreed@example.ca")
    assert "12 Main St, Victoria, BC" in body and "hi@birchbark.example" in body
    sent = next(m for m in email.sent if m.to == "agreed@example.ca")
    assert sent.reply_to == "hi@birchbark.example" and sent.idempotency_key is not None


async def test_a_broadcast_without_a_mailing_address_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _audience(db)
    await _brand(db, address="  ")
    res = await as_owner.post("/v1/broadcasts", json=_promo())
    assert res.status_code == 422 and res.json()["error"] == "broadcast_address_missing"
    await _brand(db, address="12 Main St", email=None, phone=None, website=None)
    await db.execute(update(Business).where(Business.id == BIZ).values(billing_email=None))
    res = await as_owner.post("/v1/broadcasts", json=_promo())
    assert res.status_code == 422 and res.json()["error"] == "broadcast_contact_missing"
    count = await db.execute(select(Broadcast.id).where(Broadcast.name == "Promo"))
    assert count.first() is None


async def test_a_scheduled_broadcast_waits_when_its_address_is_removed(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    bid = await _scheduled(db)
    now = await local_hour(db, 12)
    await _brand(db, address=None)
    assert await run_due_broadcasts(db, sms, email, now + timedelta(days=2)) == 0
    assert sms.sent == []
    assert (await db.get(Broadcast, bid)) is not None


async def test_an_immediate_broadcast_in_quiet_hours_is_queued_for_the_morning(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    now = await local_hour(db, 23)
    out = ok(await as_owner.post("/v1/broadcasts", json=_promo())).json()
    assert out["status"] == "scheduled"
    morning = datetime.fromisoformat(out["scheduled_at"])
    business = await db.get(Business, BIZ)
    assert business is not None
    local = morning.astimezone(ZoneInfo(business.timezone))
    assert local.time() == time(9) and timedelta(0) < morning - now < timedelta(hours=11)
    assert await run_due_broadcasts(db, sms, email, now) == 0
    assert sms.sent == []
    assert await run_due_broadcasts(db, sms, email, morning) >= 1
    row = await db.get(Broadcast, out["id"])
    assert row is not None and row.status == "sent"
    assert sorted(m.to for m in sms.sent) == ["+15145558000", "+15145558001"]


async def test_a_time_picked_in_quiet_hours_moves_to_nine(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _audience(db)
    await _brand(db)
    business = await db.get(Business, BIZ)
    assert business is not None
    zone = ZoneInfo(business.timezone)
    day = (clock.now().astimezone(zone) + timedelta(days=2)).date()
    late = datetime.combine(day, time(22, 30), tzinfo=zone)
    out = ok(await as_owner.post("/v1/broadcasts", json=_promo(scheduled_at=late.isoformat())))
    moved = datetime.fromisoformat(out.json()["scheduled_at"]).astimezone(zone)
    assert (moved.date(), moved.time()) == (day + timedelta(days=1), time(9))


async def test_a_sending_broadcast_pauses_in_quiet_hours(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    bid = await _scheduled(db)
    await db.execute(update(Broadcast).where(Broadcast.id == bid).values(status="sending"))
    now = await local_hour(db, 22)
    assert await run_due_broadcasts(db, sms, email, now) == 0
    assert sms.sent == []
    now = await local_hour(db, 10)
    assert await run_due_broadcasts(db, sms, email, now) >= 1
    assert len(sms.sent) == 2


class _CrashingSms(FakeSmsSender):
    def __init__(self, crash_on: int) -> None:
        super().__init__()
        self.crash_on = crash_on
        self.calls = 0

    async def send(self, sms: Sms) -> None:
        self.calls += 1
        if self.calls == self.crash_on:
            raise asyncio.CancelledError  # the worker dies mid-send, past `except Exception`
        await super().send(sms)


async def _many(db: AsyncSession, n: int) -> list[str]:
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None))
    ids = []
    for i in range(n):
        client = Client(
            id=new_id("client"),
            business_id=BIZ,
            name=f"Many {i}",
            phone=f"+1514555700{i}",
            status="active",
            tags=["many"],
            custom_fields={},
        )
        db.add(client)
        ids.append(client.id)
    await db.flush()
    for cid in ids:
        await record_consent(
            db, BIZ, cid, channel="sms", status="granted", source="form", recorded_by=None
        )
    return ids


async def test_a_broadcast_that_crashes_partway_resumes_without_duplicates(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _many(db, 4)
    now = await local_hour(db, 12)
    out = ok(await as_owner.post("/v1/broadcasts", json=_promo(audience={"tags": ["many"]})))
    bid = out.json()["id"]
    crashing = _CrashingSms(crash_on=3)
    with pytest.raises(asyncio.CancelledError):
        await run_due_broadcasts(db, crashing, email, now)
    assert len(crashing.sent) == 2
    row = await db.get(Broadcast, bid)
    assert row is not None and row.status == "sending"

    retry = FakeSmsSender()
    assert await run_due_broadcasts(db, retry, email, now) >= 1
    assert len(retry.sent) == 1
    delivered = [m.to for m in crashing.sent + retry.sent]
    assert len(delivered) == len(set(delivered)) == 3
    statuses = (
        (await db.execute(select(Message.status).where(Message.broadcast_id == bid)))
        .scalars()
        .all()
    )
    assert sorted(statuses) == ["queued", "sent", "sent", "sent"]  # the crashed send is not retried
    assert await run_due_broadcasts(db, retry, email, now) == 0
    assert len(retry.sent) == 1


async def test_a_failed_send_is_recorded_and_the_rest_still_go(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _many(db, 3)
    now = await local_hour(db, 12)
    out = ok(await as_owner.post("/v1/broadcasts", json=_promo(audience={"tags": ["many"]})))
    real = sms.send

    async def flaky(message: Sms) -> None:
        if message.to.endswith("1"):
            raise RuntimeError("carrier refused")
        await real(message)

    monkeypatch.setattr(sms, "send", flaky)
    assert await run_due_broadcasts(db, sms, email, now) >= 1
    statuses = (
        (await db.execute(select(Message.status).where(Message.broadcast_id == out.json()["id"])))
        .scalars()
        .all()
    )
    assert sorted(statuses) == ["failed", "sent", "sent"] and len(sms.sent) == 2


async def test_a_recipient_with_a_message_already_is_skipped(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    ids = await _many(db, 2)
    now = await local_hour(db, 12)
    bid = ok(
        await as_owner.post("/v1/broadcasts", json=_promo(audience={"tags": ["many"]}))
    ).json()["id"]
    thread = await open_thread(db, BIZ, ids[0], "sms")
    db.add(
        Message(
            id=new_id("message"),
            business_id=BIZ,
            thread_id=thread.id,
            direction="out",
            channel="sms",
            body="Hi",
            status="sent",
            broadcast_id=bid,
        )
    )
    await db.flush()
    await run_due_broadcasts(db, sms, email, now)
    assert [m.to for m in sms.sent] == ["+15145557001"]
