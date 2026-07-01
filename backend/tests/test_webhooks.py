import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import DeviceToken, WebhookEvent
from tests.conftest import FakePushSender

BIZ = "bz_birchbark"


async def _a_client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


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


async def test_account_updated_syncs_kyc_state(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_kyc")
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_kyc",
            "type": "account.updated",
            "data": {
                "object": {
                    "id": "acct_kyc",
                    "charges_enabled": False,
                    "payouts_enabled": False,
                    "details_submitted": True,
                    "requirements": {
                        "currently_due": ["external_account", "individual.id_number"],
                        "past_due": [],
                        "eventually_due": [],
                        "pending_verification": [],
                        "disabled_reason": None,
                    },
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    # details submitted but Stripe still needs things → provider action required
    assert biz.kyc_status == "restricted"
    assert biz.stripe_details_submitted is True and biz.stripe_payouts_enabled is False
    assert biz.stripe_requirements["currently_due"] == ["external_account", "individual.id_number"]


async def test_account_updated_golden_payload_syncs_state(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    # the full real-shaped account.updated event — our parser must ignore the noise and read the
    # requirement buckets through the live webhook path end-to-end.
    body = (Path(__file__).parent / "fixtures" / "stripe" / "account_updated.json").read_text()
    acct = json.loads(body)["data"]["object"]["id"]
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=acct))
    await db.flush()
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.kyc_status == "restricted"
    assert biz.stripe_details_submitted is True and biz.stripe_payouts_enabled is False
    assert biz.stripe_requirements["currently_due"] == ["external_account", "individual.id_number"]
    assert biz.stripe_requirements["past_due"] == ["external_account"]


async def test_payment_method_auto_updated_refreshes_card(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_pm"))
    cid = await _a_client_id(db)
    db.add(
        PaymentMethod(
            id="pm_row",
            business_id=BIZ,
            client_id=cid,
            type="card",
            brand="visa",
            last4="4242",
            provider="stripe",
            provider_ref="pm_stripe_1",
            is_default=True,
            mandate_status="none",
            status="active",
        )
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_pm_upd",
            "type": "payment_method.automatically_updated",
            "account": "acct_pm",
            "data": {
                "object": {"id": "pm_stripe_1", "card": {"brand": "mastercard", "last4": "5555"}}
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    pm = (await db.execute(select(PaymentMethod).where(PaymentMethod.id == "pm_row"))).scalar_one()
    assert pm.brand == "mastercard" and pm.last4 == "5555"


async def test_charge_refunded_records_a_dashboard_refund(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _a_client_id(db)
    db.add(
        Payment(
            id="pay_dash",
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            amount_cents=5000,
            currency="cad",
            method="card",
            provider="stripe",
            provider_ref="pi_dash",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_refunded",
            "type": "charge.refunded",
            "account": "acct_r",
            "data": {
                "object": {
                    "id": "ch_1",
                    "payment_intent": "pi_dash",
                    "amount_refunded": 5000,
                    "refunds": {"data": [{"id": "re_dash_1"}]},
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    refund = (
        await db.execute(
            select(Payment).where(Payment.parent_payment_id == "pay_dash", Payment.kind == "refund")
        )
    ).scalar_one()
    assert refund.amount_cents == 5000
    assert refund.provider_ref == "re_dash_1" and refund.status == "succeeded"


async def test_charge_dispute_alerts_staff(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    cid = await _a_client_id(db)
    db.add(
        Payment(
            id="pay_disp",
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            amount_cents=8000,
            currency="cad",
            method="card",
            provider="stripe",
            provider_ref="pi_disp",
            status="succeeded",
            paid_at=datetime.now(UTC),
        )
    )
    db.add(
        DeviceToken(
            id="dvt_test", business_id=BIZ, user_id="us_dev", token="ExpoTok", platform="ios"
        )
    )
    await db.flush()
    body = json.dumps(
        {
            "id": "evt_disp",
            "type": "charge.dispute.created",
            "account": "acct_d",
            "data": {"object": {"id": "dp_1", "payment_intent": "pi_disp", "amount": 8000}},
        }
    )
    res = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200
    assert any("disput" in p.body.lower() for p in push.sent)  # the business's staff were alerted


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
