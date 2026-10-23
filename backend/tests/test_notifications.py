import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.email_layout import ACCENT
from clientbridge.core.ids import new_id
from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.models.business import Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Message
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Device, File
from clientbridge.services.notifications import (
    business_brand,
    business_email,
    client_email,
    message_notice,
    run_prune_devices,
)
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import begin, card_pay, enable_payments, sent_invoice
from tests.helpers import key as retry_key

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def test_reregistered_device_is_not_pruned(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"token": "ExpoHeartbeat", "platform": "ios"}
    assert (await as_owner.post("/v1/devices/register", json=body)).status_code == 200
    await db.execute(
        update(Device)
        .where(Device.token == body["token"])
        .values(updated_at=clock.now() - timedelta(days=61))
    )
    await db.flush()
    assert (await as_owner.post("/v1/devices/register", json=body)).status_code == 200
    await run_prune_devices(db, clock.now())
    assert await db.scalar(select(Device.id).where(Device.token == body["token"])) is not None


async def test_removed_member_gets_no_payment_push(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory, push: FakePushSender
) -> None:
    await enable_payments(db)
    other = await factory.business()
    member = await db.get(Staff, "st_diego")
    assert member is not None
    member.status = "removed"
    user = await factory.user()
    member.user_id = user.id
    await factory.staff(business=other, user=user)
    for user_id, token in [("us_dev", "ActiveOwner"), (user.id, "RemovedMember")]:
        db.add(
            Device(
                id=new_id("device"), business_id=BIZ, user_id=user_id, token=token, platform="ios"
            )
        )
    await db.flush()
    inv_id = await sent_invoice(db, number=9600)
    await _pay_and_settle(as_owner, db, inv_id, "evt_removed_member")
    assert len(push.sent) == 1 and push.sent[0].tokens == ["ActiveOwner"]


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


async def _pay_and_settle(
    client: httpx.AsyncClient, db: AsyncSession, inv_id: str, event_id: str
) -> None:
    pay = {"payment_id": await card_pay(client, db, inv_id)}
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
    await enable_payments(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        Device(
            id=new_id("device"),
            business_id=BIZ,
            user_id="us_dev",
            token="ExpoTok1",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await sent_invoice(db, client=cid, number=9600)
    await _pay_and_settle(as_owner, db, inv_id, "evt_n1")

    assert len(email.sent) == 1 and email.sent[0].to == "pat@example.ca"
    assert email.sent[0].reply_to == "hello@birchbark.example"
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145551234"
    assert len(push.sent) == 1 and push.sent[0].tokens == ["ExpoTok1"]


async def test_no_contact_skips_client_channels(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await enable_payments(db)
    cid = await _client_with_contact(db, email=None, phone=None)
    inv_id = await sent_invoice(db, client=cid, number=9600)
    await _pay_and_settle(as_owner, db, inv_id, "evt_n2")
    assert email.sent == []  # nothing to send to
    assert sms.sent == []
    assert push.sent == []  # no devices registered


async def test_device_register_upserts(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = {"token": "ExpoTokX", "platform": "android"}
    first = await as_owner.post("/v1/devices/register", json=body)
    assert first.status_code == 200 and first.json()["registered"] is True
    await as_owner.post("/v1/devices/register", json=body)  # same token again
    rows = (await db.execute(select(Device).where(Device.token == "ExpoTokX"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].platform == "android"


async def test_device_register_scopes_to_caller(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await as_owner.post("/v1/devices/register", json={"token": "ExpoTokC", "platform": "ios"})
    row = (await db.execute(select(Device).where(Device.token == "ExpoTokC"))).scalar_one()
    assert row.business_id == BIZ and row.user_id == "us_dev"  # bound to the caller's biz + user


async def test_push_target_is_business_scoped(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    await enable_payments(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        Device(
            id=new_id("device"),
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
        Device(
            id=new_id("device"),
            business_id=other.id,
            user_id=other_user.id,
            token="ForeignTok",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await sent_invoice(db, client=cid, number=9600)
    await _pay_and_settle(as_owner, db, inv_id, "evt_scope")

    assert len(push.sent) == 1
    assert push.sent[0].tokens == ["BizTok"]  # the foreign device is scoped out of the target set


async def test_device_register_rejects_bad_platform(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/devices/register", json={"token": "T", "platform": "blackberry"})
    assert res.status_code == 422


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
    assert any(f"http://pay.localhost:8709/i/{token}" in m.body for m in email.sent)
    assert any(f"/i/{token}" in m.body for m in sms.sent)


async def test_client_emails_carry_the_business_design(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _client_with_contact(db, email="pat@example.ca", phone=None)
    line = {"description": "Groom", "quantity": 1, "unit_amount_cents": 8000}
    inv = (await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})).json()
    token = (await as_owner.post(f"/v1/invoices/{inv['id']}/send")).json()["pay_token"]
    mail = next(m for m in email.sent if m.to == "pat@example.ca")
    assert mail.html is not None and f"http://pay.localhost:8709/i/{token}" in mail.body
    assert (
        f'<a href="http://pay.localhost:8709/i/{token}"' in mail.html and "Pay invoice" in mail.html
    )
    assert "Sent with Clientbridge" in mail.html and "a client of" in mail.html


async def test_a_logo_shows_only_when_mail_apps_can_show_it(db: AsyncSession) -> None:
    business, other = await Factory(db).business(), await Factory(db).business()

    async def logo(owner: str, content_type: str, *, uploaded: bool = True) -> str:
        file = File(
            id=new_id("file"),
            business_id=owner,
            parent_type="business",
            parent_id=owner,
            purpose="logo",
            s3_key=new_id("file"),
            content_type=content_type,
            uploaded_at=clock.now() if uploaded else None,
        )
        db.add(file)
        await db.flush()
        return file.id

    shown = await logo(business.id, "image/png")
    hidden = [
        await logo(business.id, "image/svg+xml"),
        await logo(business.id, "image/webp"),
        await logo(business.id, "image/png", uploaded=False),
        await logo(other.id, "image/png"),
    ]
    business.brand = {"logo_file_id": shown, "primary": "#2F6B4F"}
    brand = await business_brand(db, business)
    assert brand.logo_url is not None and brand.logo_url.endswith(f"/media/{shown}")
    assert brand.accent == "#2F6B4F"
    for file_id in hidden:
        business.brand = {"logo_file_id": file_id, "primary": "not-a-colour"}
        brand = await business_brand(db, business)
        assert brand.logo_url is None and brand.accent == ACCENT, file_id


async def test_refund_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    await enable_payments(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await sent_invoice(db, client=cid, number=9600)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {"id": "evt_rf", "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)
    email.sent.clear()
    sms.sent.clear()

    refund = await as_owner.post(
        f"/v1/payments/{pay['payment_id']}/refund", json={}, headers=retry_key()
    )
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
    assert email.sent[0].reply_to == "hello@birchbark.example"
    assert len(sms.sent) == 1 and sms.sent[0].to == "+15145551234"
    assert "on Saturday, May 1 at 10:00 a.m." in email.sent[0].body  # in the business timezone


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
    assert len(email.sent) == 1 and "to Sunday, May 2 at 10:00 a.m." in email.sent[0].body
    assert len(sms.sent) == 1


async def test_payment_failed_notifies_client(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    await enable_payments(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    inv_id = await sent_invoice(db, client=cid, number=9600)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
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
        m.to == "hello@birchbark.example" and "declined" in m.body.lower() for m in email.sent
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
    await begin(db, bid)
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
        m.to == "hello@birchbark.example" and "accepted" in m.body.lower() for m in email.sent
    )


async def test_failing_channel_does_not_500(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await enable_payments(db)
    cid = await _client_with_contact(db, email="pat@example.ca", phone="+15145551234")
    db.add(
        Device(
            id=new_id("device"),
            business_id=BIZ,
            user_id="us_dev",
            token="ExpoTokB",
            platform="ios",
        )
    )
    await db.flush()
    inv_id = await sent_invoice(db, client=cid, number=9600)

    async def boom(_: object) -> None:
        raise RuntimeError("twilio down")

    monkeypatch.setattr(sms, "send", boom)

    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
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


async def test_sign_out_unregisters_only_the_callers_device(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ok_body = {"token": "ExpoMine", "platform": "ios"}
    assert (await as_owner.post("/v1/devices/register", json=ok_body)).status_code == 200
    db.add(
        Device(
            id="dvt_other", business_id=BIZ, user_id="us_diego", token="ExpoTheirs", platform="ios"
        )
    )
    await db.flush()
    for token in ("ExpoMine", "ExpoTheirs", "ExpoUnknown"):
        res = await as_owner.post("/v1/devices/unregister", json={"token": token})
        assert res.status_code == 200 and res.json() == {"registered": False}
    tokens = set((await db.execute(select(Device.token))).scalars().all())
    assert "ExpoMine" not in tokens and "ExpoTheirs" in tokens


async def test_unregister_needs_a_session(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/devices/unregister", json={"token": "ExpoMine"})
    assert res.status_code == 401


async def test_tenant_email_builders_apply_the_conventions(db: AsyncSession) -> None:
    business = await Factory(db).business()
    business.billing_email = "owner@test.ca"
    note = Message(
        id="msg_builder",
        business_id=business.id,
        thread_id="th_x",
        direction="out",
        channel="email",
        status="queued",
    )
    brand = await business_brand(db, business)
    notice = message_notice(SOURCE_LOCALE, business.name, "Body")
    mail = client_email(business, brand, "pat@test.ca", notice, message=note)
    assert mail.reply_to == "owner@test.ca" and mail.idempotency_key == "msg_builder"
    assert mail.tags == {"business": business.id, "message": "msg_builder"}
    plain = client_email(business, brand, "pat@test.ca", notice)
    assert plain.idempotency_key is None and plain.tags == {"business": business.id}
    pat = Client(id="cl_builder", business_id=business.id, name="Pat")
    assert client_email(business, brand, "pat@test.ca", notice, client=pat).tags == {
        "business": business.id,
        "client": "cl_builder",
    }
    alert = business_email(business, "owner@test.ca", notice)
    assert alert.reply_to is None and alert.tags == {"business": business.id}


async def test_payment_receipt_is_durable_when_provider_cannot_connect(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import text

    await enable_payments(db)
    cid = await _client_with_contact(db, email="retry@example.ca", phone=None)
    invoice = await sent_invoice(db, client=cid, number=9601)

    async def unavailable(_: object) -> None:
        raise httpx.ConnectError("provider unavailable")

    monkeypatch.setattr(email, "send", unavailable)
    await _pay_and_settle(as_owner, db, invoice, "evt_durable_receipt")
    state = await db.scalar(
        text("SELECT state FROM deliveries WHERE payload->>'channel' = 'email'")
    )
    assert state == "queued"
