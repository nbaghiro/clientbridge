import json

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.platform import DeviceToken
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender

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


async def test_device_register_scopes_to_caller(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await as_owner.post("/v1/devices/register", json={"token": "ExpoTokC", "platform": "ios"})
    row = (
        await db.execute(select(DeviceToken).where(DeviceToken.token == "ExpoTokC"))
    ).scalar_one()
    assert row.business_id == BIZ and row.user_id == "us_dev"  # bound to the caller's biz + user


async def test_push_target_is_business_scoped(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        DeviceToken(
            id=new_id("device_token"),
            business_id=BIZ,
            user_id="us_dev",
            token="BizTok",
            platform="ios",
        )
    )
    # a DIFFERENT business's device must never be a push target for this business's payment
    other = await factory.business()
    other_user = await factory.user()
    db.add(
        DeviceToken(
            id=new_id("device_token"),
            business_id=other.id,
            user_id=other_user.id,
            token="ForeignTok",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await _sent_invoice(db, cid)
    await _pay_and_settle(as_owner, db, inv_id, "evt_scope")

    assert len(push.sent) == 1
    assert push.sent[0].tokens == ["BizTok"]  # the foreign device is scoped out of the target set


async def test_device_register_rejects_bad_platform(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/devices/register", json={"token": "T", "platform": "blackberry"})
    assert res.status_code == 422


async def test_receipt_is_english_regardless_of_locale(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    # copy is English-only now — a non-English locale no longer changes the notification language
    await _enable(db)
    await db.execute(update(Business).where(Business.id == BIZ).values(locale="fr"))
    await db.flush()
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await _sent_invoice(db, cid)
    await _pay_and_settle(as_owner, db, inv_id, "evt_loc")

    assert email.sent[0].subject == "Receipt from Birchbark Pet Studio"
    assert email.sent[0].body == (
        "Thank you! Your payment of $50.00 CAD to Birchbark Pet Studio was received."
    )
    assert sms.sent[0].body.startswith("Thank you!")


async def test_invoice_sent_carries_pay_link(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    line = {"description": "Groom", "quantity": 1, "unit_amount_cents": 8000}
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})).json()
    sent = await as_owner.post(f"/v1/invoices/{inv['id']}/send")
    assert sent.status_code == 200, sent.text
    token = sent.json()["pay_token"]
    assert token
    assert any(f"/pay/{token}" in m.body for m in email.sent)
    assert any(f"/pay/{token}" in m.body for m in sms.sent)


async def test_interac_request_reaches_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await _sent_invoice(db, cid)
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")
    assert res.status_code == 200, res.text
    ref = res.json()["reference_code"]
    assert ref
    assert any(ref in m.body for m in email.sent)
    assert any(ref in m.body for m in sms.sent)


async def test_refund_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await _sent_invoice(db, cid)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {"id": "evt_rf", "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)
    email.sent.clear()
    sms.sent.clear()

    refund = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund")
    assert refund.status_code == 200, refund.text
    assert any("refund" in m.body.lower() and "$50.00" in m.body for m in email.sent)
    assert any("refund" in m.body.lower() for m in sms.sent)


async def _bookable_item(db: AsyncSession) -> str:
    item_id = (
        await db.execute(
            select(Item.id)
            .where(Item.business_id == BIZ, Item.duration_min.isnot(None), Item.active.is_(True))
            .limit(1)
        )
    ).scalar_one()
    return item_id


def _booking_body(cid: str, item_id: str, starts: str) -> dict[str, str]:
    return {"client_id": cid, "item_id": item_id, "staff_id": "st_owner", "starts_at": starts}


async def test_booking_create_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    item_id = await _bookable_item(db)
    body = _booking_body(cid, item_id, "2027-05-01T17:00:00Z")
    res = await as_owner.post("/v1/bookings", json=body)
    assert res.status_code == 201, res.text
    assert len(email.sent) == 1 and email.sent[0].to == "pat@example.ca"
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145551234"
    assert "2027-05-01" in email.sent[0].body  # the date lands in the business timezone


async def test_booking_cancel_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    item_id = await _bookable_item(db)
    bid = (
        await as_owner.post(
            "/v1/bookings", json=_booking_body(cid, item_id, "2027-05-02T17:00:00Z")
        )
    ).json()["id"]
    email.sent.clear()
    sms.sent.clear()
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert res.status_code == 200, res.text
    assert len(email.sent) == 1 and "cancel" in email.sent[0].body.lower()
    assert len(sms.sent) == 1


async def test_booking_reschedule_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    item_id = await _bookable_item(db)
    bid = (
        await as_owner.post(
            "/v1/bookings", json=_booking_body(cid, item_id, "2027-05-01T17:00:00Z")
        )
    ).json()["id"]
    email.sent.clear()
    sms.sent.clear()
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-05-02T17:00:00Z"})
    assert res.status_code == 200, res.text
    assert len(email.sent) == 1 and "2027-05-02" in email.sent[0].body  # the new time, in tz
    assert len(sms.sent) == 1


async def test_payment_failed_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await _sent_invoice(db, cid)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    email.sent.clear()
    sms.sent.clear()
    event = json.dumps(
        {"id": "evt_pf", "type": "payment_intent.payment_failed", "data": {"object": {"id": pi}}}
    )
    res = await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200, res.text
    assert any("failed" in m.body.lower() for m in email.sent)
    assert len(sms.sent) == 1


async def test_estimate_decline_notifies_business(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
) -> None:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    line = {"description": "Project quote", "quantity": 1, "unit_amount_cents": 5000}
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [line]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    email.sent.clear()
    declined = await as_owner.post(f"/v1/estimates/{est['id']}/decline")
    assert declined.status_code == 200, declined.text
    assert any(
        m.to == "hello@birchbarkpets.ca" and "declined" in m.body.lower() for m in email.sent
    )


async def test_booking_noncancel_patch_sends_no_cancel_notice(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    item_id = await _bookable_item(db)
    bid = (
        await as_owner.post(
            "/v1/bookings", json=_booking_body(cid, item_id, "2027-05-03T17:00:00Z")
        )
    ).json()["id"]
    email.sent.clear()
    sms.sent.clear()
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "completed"})
    assert res.status_code == 200, res.text
    assert email.sent == []  # a non-cancel status change fires no notice
    assert sms.sent == []


async def test_estimate_accept_notifies_business(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
) -> None:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    line = {"description": "Project quote", "quantity": 1, "unit_amount_cents": 5000}
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [line]})).json()
    await as_owner.post(f"/v1/estimates/{est['id']}/send")
    email.sent.clear()
    accepted = await as_owner.post(f"/v1/estimates/{est['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    assert any(
        m.to == "hello@birchbarkpets.ca" and "accepted" in m.body.lower() for m in email.sent
    )


async def test_failing_channel_does_not_500(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _enable(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        DeviceToken(
            id=new_id("device_token"),
            business_id=BIZ,
            user_id="us_dev",
            token="ExpoTokB",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await _sent_invoice(db, cid)

    async def boom(_: object) -> None:
        raise RuntimeError("twilio down")

    monkeypatch.setattr(sms, "send", boom)

    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {"id": "evt_boom", "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    res = await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)

    assert res.status_code == 200  # the SMS failure didn't bubble to the webhook
    assert len(email.sent) == 1  # the other client channel still fired
    assert len(push.sent) == 1  # the staff push still fired
    status = (
        await db.execute(select(Payment.status).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    assert status == "succeeded"  # the settlement persisted
