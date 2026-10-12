from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.ids import new_id
from clientbridge.integrations.twilio import twilio_signature
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.platform import Device, Webhook
from clientbridge.services.consents import texts_stopped
from clientbridge.services.messaging import unread_count
from tests.conftest import BIZ, Factory, FakePushSender
from tests.helpers import TWILIO_TOKEN, ok, text_in, texted

PHONE = "+15145551111"


async def _client_with_phone(db: AsyncSession, phone: str = PHONE) -> str:
    # A fresh client: a seeded one may already have been texted, which changes the routing.
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Inbound Client",
        phone=phone,
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client.id


async def _inbound(db: AsyncSession, sid: str) -> Message | None:
    return (
        await db.execute(select(Message).where(Message.provider_ref == sid))
    ).scalar_one_or_none()


async def _webhook(db: AsyncSession, sid: str) -> Webhook:
    return (await db.execute(select(Webhook).where(Webhook.id == f"twilio_{sid}"))).scalar_one()


async def test_a_reply_lands_on_the_thread_of_the_business_that_texted(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_phone(db)
    await texted(db, cid)
    ok(await text_in(api, {"From": PHONE, "Body": "Can I reschedule?", "MessageSid": "SM_in_1"}))
    msg = await _inbound(db, "SM_in_1")
    assert msg is not None
    assert msg.direction == "in" and msg.body == "Can I reschedule?" and msg.business_id == BIZ
    thread = (await db.execute(select(Thread).where(Thread.id == msg.thread_id))).scalar_one()
    assert thread.client_id == cid and thread.channel == "sms"
    assert await unread_count(db, thread) == 1


async def test_a_number_stored_as_typed_still_matches(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_phone(db, "(514) 555-1111")
    await texted(db, cid)
    ok(await text_in(api, {"From": PHONE, "Body": "hi", "MessageSid": "SM_typed"}))
    msg = await _inbound(db, "SM_typed")
    assert msg is not None and msg.business_id == BIZ


async def test_a_shared_phone_routes_to_the_most_recent_sender(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    ours = await _client_with_phone(db)
    rival = await factory.business(name="Rival Texts")
    theirs = await factory.client(business=rival)
    theirs.phone = PHONE
    now = datetime.now(UTC)
    await texted(db, ours, at=now - timedelta(days=2))
    await texted(db, theirs.id, business_id=rival.id, at=now - timedelta(hours=1))
    ok(await text_in(api, {"From": PHONE, "Body": "Yes please", "MessageSid": "SM_rival"}))
    msg = await _inbound(db, "SM_rival")
    assert msg is not None and msg.business_id == rival.id

    await texted(db, ours, at=now)
    ok(await text_in(api, {"From": PHONE, "Body": "And you", "MessageSid": "SM_ours"}))
    msg = await _inbound(db, "SM_ours")
    assert msg is not None and msg.business_id == BIZ


async def test_stop_applies_only_to_the_business_it_was_routed_to(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    ours = await _client_with_phone(db)
    rival = await factory.business(name="Rival Stop")
    theirs = await factory.client(business=rival)
    theirs.phone = PHONE
    now = datetime.now(UTC)
    await texted(db, ours, at=now - timedelta(days=1))
    await texted(db, theirs.id, business_id=rival.id, at=now)
    ok(await text_in(api, {"From": PHONE, "Body": "STOP", "MessageSid": "SM_stop"}))
    assert await texts_stopped(db, rival.id, theirs.id)
    assert not await texts_stopped(db, BIZ, ours)


async def test_a_number_no_business_texted_is_recorded_unmatched(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _client_with_phone(db)
    rival = await factory.business(name="Rival Silent")
    theirs = await factory.client(business=rival)
    theirs.phone = PHONE
    await db.flush()
    ok(await text_in(api, {"From": PHONE, "Body": "STOP", "MessageSid": "SM_nobody"}))
    assert await _inbound(db, "SM_nobody") is None
    row = await _webhook(db, "SM_nobody")
    assert row.payload["matched"] is False and row.payload["opt_out"] is True
    assert not await texts_stopped(db, rival.id, theirs.id)


async def test_a_tie_between_businesses_is_not_guessed(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    ours = await _client_with_phone(db)
    rival = await factory.business(name="Rival Tie")
    theirs = await factory.client(business=rival)
    theirs.phone = PHONE
    at = datetime.now(UTC)
    await texted(db, ours, at=at)
    await texted(db, theirs.id, business_id=rival.id, at=at)
    ok(await text_in(api, {"From": PHONE, "Body": "hi", "MessageSid": "SM_tie"}))
    assert await _inbound(db, "SM_tie") is None
    assert (await _webhook(db, "SM_tie")).payload["matched"] is False


async def test_a_redelivery_is_recorded_once(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_with_phone(db)
    await texted(db, cid)
    payload = {"From": PHONE, "Body": "hi", "MessageSid": "SM_dup"}
    ok(await text_in(api, payload))
    ok(await text_in(api, payload))
    msgs = (
        (await db.execute(select(Message).where(Message.provider_ref == "SM_dup"))).scalars().all()
    )
    assert len(msgs) == 1
    thread = (await db.execute(select(Thread).where(Thread.id == msgs[0].thread_id))).scalar_one()
    assert await unread_count(db, thread) == 1


def _signed(data: dict[str, str], url: str | None = None) -> dict[str, str]:
    target = url or f"{get_settings().api_base_url}/webhooks/sms"
    return {"X-Twilio-Signature": twilio_signature(TWILIO_TOKEN, target, list(data.items()))}


def test_the_signature_matches_twilios_documented_example() -> None:
    params = {
        "CallSid": "CA1234567890ABCDE",
        "Caller": "+12349013030",
        "Digits": "1234",
        "From": "+12349013030",
        "To": "+18005551212",
    }
    url = "https://mycompany.com/myapp.php?foo=1&bar=2"
    assert twilio_signature("12345", url, list(params.items())) == "0/KCTR6DLpKmkAf8muzZqo1nDgQ="


async def test_a_wrong_signature_is_refused(api: httpx.AsyncClient, db: AsyncSession) -> None:
    data = {"From": PHONE, "Body": "x", "MessageSid": "SM_bad"}
    tampered = _signed({**data, "Body": "y"})
    res = await api.post("/webhooks/sms", data=data, headers=tampered)
    assert res.status_code == 401
    elsewhere = _signed(data, "https://attacker.example/webhooks/sms")
    assert (await api.post("/webhooks/sms", data=data, headers=elsewhere)).status_code == 401
    assert (await db.execute(select(Webhook).where(Webhook.id == "twilio_SM_bad"))).first() is None


async def test_a_missing_signature_is_refused(api: httpx.AsyncClient) -> None:
    res = await api.post("/webhooks/sms", data={"From": PHONE, "Body": "x", "MessageSid": "SM_x"})
    assert res.status_code == 401


async def test_a_signed_request_without_a_message_id_is_400(api: httpx.AsyncClient) -> None:
    assert (await text_in(api, {"From": PHONE, "Body": "x"})).status_code == 400


async def test_a_routed_reply_alerts_only_that_business_staff(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory, push: FakePushSender
) -> None:
    ours = await _client_with_phone(db)
    rival = await factory.business(name="Rival Alerts")
    owner = await factory.user()
    await factory.staff(business=rival, user=owner)
    theirs = await factory.client(business=rival, name="Rival Client")
    theirs.phone = PHONE
    db.add_all(
        [
            Device(id="dvt_ours", business_id=BIZ, user_id="us_dev", token="Ours", platform="ios"),
            Device(
                id="dvt_rival",
                business_id=rival.id,
                user_id=owner.id,
                token="Rival",
                platform="ios",
            ),
        ]
    )
    await texted(db, ours, at=datetime.now(UTC) - timedelta(days=1))
    await texted(db, theirs.id, business_id=rival.id)
    ok(await text_in(api, {"From": PHONE, "Body": "See you at 3", "MessageSid": "SM_push"}))
    [alert] = push.sent
    msg = await _inbound(db, "SM_push")
    assert msg is not None
    assert alert.tokens == ["Rival"] and alert.title == "Rival Alerts"
    assert alert.body == "Message from Rival Client: See you at 3"
    assert alert.data == {"type": "message", "thread_id": msg.thread_id, "client_id": theirs.id}


async def test_an_unmatched_or_repeated_text_alerts_no_one(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    cid = await _client_with_phone(db)
    db.add(Device(id="dvt_quiet", business_id=BIZ, user_id="us_dev", token="T", platform="ios"))
    await db.flush()
    ok(await text_in(api, {"From": PHONE, "Body": "hi", "MessageSid": "SM_nomatch"}))
    assert push.sent == []
    await texted(db, cid)
    payload = {"From": PHONE, "Body": "x" * 300, "MessageSid": "SM_once"}
    ok(await text_in(api, payload))
    ok(await text_in(api, payload))
    assert len(push.sent) == 1 and push.sent[0].body.endswith("…")
    assert len(push.sent[0].body) < 160
