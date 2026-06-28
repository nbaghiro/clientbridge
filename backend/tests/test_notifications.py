import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.platform import DeviceToken
from tests.conftest import FakeEmailSender, FakePushSender, FakeSmsSender

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _client_with_contact(db: AsyncSession, *, email: str | None, phone: str | None) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    await db.execute(update(Client).where(Client.id == cid).values(email=email, phone=phone))
    await db.flush()
    return cid


async def _sent_invoice(db: AsyncSession, cid: str, *, total: int = 5000) -> str:
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9600,
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        balance_cents=total,
    )
    db.add(inv)
    await db.flush()
    return inv.id


async def _pay_and_settle(
    client: httpx.AsyncClient, db: AsyncSession, inv_id: str, event_id: str
) -> None:
    pay = (await client.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {"id": event_id, "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    await client.post("/webhooks/stripe", content=event, headers=GOOD)


async def test_card_success_sends_receipt_and_push(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        DeviceToken(
            id=new_id("device_token"),
            business_id=BIZ,
            user_id="us_dev",
            token="ExpoTok1",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await _sent_invoice(db, cid)
    await _pay_and_settle(as_owner, db, inv_id, "evt_n1")

    assert len(email.sent) == 1 and email.sent[0].to == "pat@example.ca"
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145551234"
    assert len(push.sent) == 1 and push.sent[0].tokens == ["ExpoTok1"]


async def test_no_contact_skips_client_channels(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email=None, phone=None)
    inv_id = await _sent_invoice(db, cid)
    await _pay_and_settle(as_owner, db, inv_id, "evt_n2")
    assert email.sent == []  # nothing to send to
    assert sms.sent == []
    assert push.sent == []  # no devices registered


async def test_device_register_upserts(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = {"token": "ExpoTokX", "platform": "android"}
    first = await as_owner.post("/v1/devices/register", json=body)
    assert first.status_code == 200 and first.json()["registered"] is True
    await as_owner.post("/v1/devices/register", json=body)  # same token again
    rows = (
        (await db.execute(select(DeviceToken).where(DeviceToken.token == "ExpoTokX")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].platform == "android"


async def test_device_register_rejects_bad_platform(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/devices/register", json={"token": "T", "platform": "blackberry"})
    assert res.status_code == 422
