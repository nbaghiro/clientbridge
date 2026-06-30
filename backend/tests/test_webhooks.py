import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.platform import WebhookEvent

BIZ = "bz_birchbark"


async def _client_with_phone(db: AsyncSession, phone: str) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    await db.execute(update(Client).where(Client.id == cid).values(phone=phone))
    await db.flush()
    return cid


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
    rows = (
        (await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == "evt_dup")))
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_inbound_sms_creates_in_message(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_with_phone(db, "+15145551111")
    res = await api.post(
        "/webhooks/sms",
        data={"From": "+15145551111", "Body": "Can I reschedule?", "MessageSid": "SM_in_1"},
        headers={"X-Twilio-Signature": "testsecret"},
    )
    assert res.status_code == 200
    msg = (await db.execute(select(Message).where(Message.provider_ref == "SM_in_1"))).scalar_one()
    assert msg.direction == "in" and msg.body == "Can I reschedule?" and msg.business_id == BIZ
    thread = (await db.execute(select(Thread).where(Thread.id == msg.thread_id))).scalar_one()
    assert thread.client_id == cid and thread.channel == "sms" and thread.unread_count == 1


async def test_inbound_sms_redelivery_is_noop(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _client_with_phone(db, "+15145551111")
    payload = {"From": "+15145551111", "Body": "hi", "MessageSid": "SM_dup"}
    headers = {"X-Twilio-Signature": "testsecret"}
    first = await api.post("/webhooks/sms", data=payload, headers=headers)
    second = await api.post("/webhooks/sms", data=payload, headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    msgs = (
        (await db.execute(select(Message).where(Message.provider_ref == "SM_dup"))).scalars().all()
    )
    assert len(msgs) == 1  # the redelivery is deduped on the SID
    thread = (await db.execute(select(Thread).where(Thread.id == msgs[0].thread_id))).scalar_one()
    assert thread.unread_count == 1  # bumped once, not twice


async def test_inbound_sms_bad_secret_401(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/webhooks/sms",
        data={"From": "+1", "Body": "x", "MessageSid": "SM_bad"},
        headers={"X-Twilio-Signature": "wrong"},
    )
    assert res.status_code == 401
