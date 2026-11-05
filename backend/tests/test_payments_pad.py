import hashlib
import json
from dataclasses import replace
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import MandateState
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod, PaymentSetupLink
from clientbridge.services.payments import default_method_ref, resolve_saved_method_ref
from tests.conftest import BIZ, Factory, FakePaymentGateway, FakeSmsSender
from tests.helpers import client_id, column, enable_payments, replied_stop, sent_invoice
from tests.helpers import key as retry_key


async def _link(api: httpx.AsyncClient, db: AsyncSession) -> tuple[PaymentSetupLink, str]:
    await enable_payments(db)
    cid = "cl_amelie"
    client = await db.get(Client, cid)
    assert client is not None
    response = await api.post(f"/v1/payments/pad-links/{cid}")
    assert response.status_code == 200, response.text
    body = response.json()
    token = parse_qs(urlsplit(body["url"]).fragment)["token"][0]
    link = await db.get(PaymentSetupLink, body["id"])
    assert link is not None
    return link, token


def _header(token: str) -> dict[str, str]:
    return {"X-Payment-Setup-Token": token}


async def _event(
    api: httpx.AsyncClient,
    kind: str,
    obj: dict[str, object],
    *,
    event: str = "evt_pad",
    account: str = "acct_test",
) -> None:
    response = await api.post(
        "/webhooks/stripe",
        content=json.dumps(
            {"id": event, "type": kind, "account": account, "data": {"object": obj}}
        ),
        headers={"Stripe-Signature": "good"},
    )
    assert response.status_code == 200, response.text


async def _start(api: httpx.AsyncClient, token: str, email: str = "pad@example.test") -> str:
    response = await api.post(
        "/payment-method/start", headers=_header(token), json={"email": email}
    )
    assert response.status_code == 200, response.text
    return str(response.json()["client_secret"]).split("_secret")[0]


def _authorized(
    gateway: FakePaymentGateway, intent_id: str, *, status: str = "active"
) -> dict[str, object]:
    current = gateway.pad_intents[intent_id]
    pm: dict[str, object] = {
        "id": "pm_authorized",
        "type": "acss_debit",
        "customer": current.customer_id,
        "acss_debit": {"last4": "0001", "bank_name": "Test bank"},
    }
    gateway.pad_intents[intent_id] = replace(
        current, status="succeeded", payment_method=pm, mandate_id="mandate_test"
    )
    gateway.mandates["mandate_test"] = MandateState(
        id="mandate_test", status=status, payment_method_id="pm_authorized"
    )
    return pm


async def test_pad_link_stores_only_hash_and_does_not_start_until_client_action(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    assert link.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert link.token_hash != token and link.setup_intent_id is None
    response = await as_owner.get("/payment-method", headers=_header(token))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["client_secret"] is None
    assert response.json()["status"] == "not_started"
    assert response.json()["brand"]["public_slug"] == "birchbark"
    assert not gateway.pad_intents
    first = await _start(as_owner, token)
    second = await _start(as_owner, token)
    assert first == second
    assert len(gateway.pad_intents) == 1
    assert (await as_owner.get("/payment-method", headers=_header(token))).json()[
        "client_secret"
    ] is None


async def test_pad_rejects_missing_invalid_expired_and_revoked_tokens(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    assert (await as_owner.get("/payment-method")).status_code == 422
    assert (await as_owner.get("/payment-method", headers=_header("bad"))).status_code == 422
    assert (await as_owner.get("/payment-method", headers=_header("a" * 43))).status_code == 404
    link, token = await _link(as_owner, db)
    link.expires_at = clock.now() - timedelta(seconds=1)
    await db.commit()
    assert (
        await as_owner.post(
            "/payment-method/start",
            headers=_header(token),
            json={"email": "pad@example.test"},
        )
    ).status_code == 404
    second, token2 = await _link(as_owner, db)
    assert (await as_owner.delete(f"/v1/payments/pad-links/{second.id}")).status_code == 204
    assert (await as_owner.get("/payment-method", headers=_header(token2))).status_code == 404
    assert (await as_owner.delete("/v1/payments/pad-links/nope")).status_code == 404


async def test_new_link_replaces_old_and_validates_business_customer_identity(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    first, token = await _link(as_owner, db)
    second, token2 = await _link(as_owner, db)
    assert first.id != second.id
    assert (await as_owner.get("/payment-method", headers=_header(token))).status_code == 404
    client = await db.get(Client, second.client_id)
    assert client is not None
    client.stripe_customer_id = "cus_changed"
    await db.commit()
    assert (await as_owner.get("/payment-method", headers=_header(token2))).status_code == 404
    third, token3 = await _link(as_owner, db)
    business = await db.get(Business, third.business_id)
    assert business is not None
    business.stripe_account_id = "acct_changed"
    await db.commit()
    assert (
        await as_owner.post(
            "/payment-method/start",
            headers=_header(token3),
            json={"email": "pad@example.test"},
        )
    ).status_code == 404


async def test_pad_links_are_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    other = await factory.business()
    client = await factory.client(business=other)
    assert (await as_owner.post(f"/v1/payments/pad-links/{client.id}")).status_code == 404


async def test_staff_cannot_issue_or_revoke_bank_links(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/payments/pad-links/cl_amelie")).status_code == 403
    assert (await as_staff.delete("/v1/payments/pad-links/nope")).status_code == 403


async def test_link_requires_a_connected_account(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 200
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_account_id = None
    await db.commit()
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 409


async def test_pad_start_requires_a_valid_payer_email(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, token = await _link(as_owner, db)
    assert (await as_owner.post("/payment-method/start", headers=_header(token))).status_code == 422
    invalid = await as_owner.post(
        "/payment-method/start", headers=_header(token), json={"email": "not-an-email"}
    )
    assert invalid.status_code == 422


async def test_attached_bank_is_pending_until_verified_setup_and_mandate(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    pm = _authorized(gateway, intent)
    await _event(as_owner, "payment_method.attached", pm)
    method = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one()
    assert method.mandate_status == "pending"
    assert await default_method_ref(db, BIZ, link.client_id) != "pm_authorized"
    with pytest.raises(Conflict):
        await resolve_saved_method_ref(db, BIZ, method.id, link.client_id)
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_verified")
    assert await column(db, "payment_methods", method.id, "mandate_status") == "active"
    assert await resolve_saved_method_ref(db, BIZ, method.id, link.client_id) == "pm_authorized"
    context = (await as_owner.get("/payment-method", headers=_header(token))).json()
    assert context["status"] == "succeeded" and context["client_secret"] is None
    await _event(as_owner, "payment_method.attached", pm, event="evt_late_attached")
    assert await column(db, "payment_methods", method.id, "mandate_status") == "active"
    gateway.mandates["mandate_test"] = replace(gateway.mandates["mandate_test"], status="inactive")
    await _event(
        as_owner,
        "mandate.updated",
        {"id": "mandate_test", "status": "active"},
        event="evt_old_active_payload",
    )
    assert await column(db, "payment_methods", method.id, "mandate_status") == "revoked"
    with pytest.raises(Conflict):
        await resolve_saved_method_ref(db, BIZ, method.id, link.client_id)


async def test_setup_before_attached_is_safe_and_old_mandate_event_cannot_activate(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    pm = _authorized(gateway, intent, status="inactive")
    await _event(as_owner, "mandate.updated", {"id": "mandate_test"})
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_setup")
    await _event(as_owner, "payment_method.attached", pm, event="evt_attached")
    method = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one()
    assert await column(db, "payment_methods", method.id, "mandate_status") == "revoked"
    assert await default_method_ref(db, BIZ, link.client_id) != "pm_authorized"


async def test_setup_wrong_account_customer_or_mandate_does_not_activate(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    _, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    _authorized(gateway, intent)
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, account="acct_other")
    assert (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one_or_none() is None
    gateway.mandates["mandate_test"] = replace(
        gateway.mandates["mandate_test"], payment_method_id="pm_other"
    )
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_mismatch")
    assert (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one_or_none() is None
    gateway.pad_intents[intent] = replace(gateway.pad_intents[intent], customer_id="cus_other")
    assert (
        await as_owner.post(
            "/payment-method/start",
            headers=_header(token),
            json={"email": "pad@example.test"},
        )
    ).status_code == 409


async def test_revoked_link_cannot_activate_unfinished_setup(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    _authorized(gateway, intent)
    await as_owner.delete(f"/v1/payments/pad-links/{link.id}")
    await _event(as_owner, "setup_intent.succeeded", {"id": intent})
    assert (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one_or_none() is None


async def test_microdeposit_verification_and_processing_never_claim_active(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    _, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    gateway.pad_intents[intent] = replace(
        gateway.pad_intents[intent],
        status="requires_action",
        verification_url="https://verify.stripe.test/mandate",
    )
    data = (await as_owner.get("/payment-method", headers=_header(token))).json()
    assert data["status"] == "requires_action" and data["verification_url"].startswith("https://")
    assert data["client_secret"] is None
    gateway.pad_intents[intent] = replace(
        gateway.pad_intents[intent], status="processing", verification_url=None
    )
    data = (
        await as_owner.post(
            "/payment-method/start",
            headers=_header(token),
            json={"email": "pad@example.test"},
        )
    ).json()
    assert data["status"] == "processing" and data["client_secret"] is None


async def test_link_requires_enabled_pad_capability(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    gateway.pad_enabled = False
    response = await as_owner.post(f"/v1/payments/pad-links/{cid}")
    assert response.status_code == 409
    assert not gateway.pad_intents


async def test_started_link_survives_microdeposit_delay(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    link, token = await _link(as_owner, db)
    initial_expiry = link.expires_at
    await _start(as_owner, token)
    assert link.expires_at > initial_expiry + timedelta(days=8)
    assert link.expires_at < clock.now() + timedelta(days=11)
    assert (await as_owner.get("/payment-method", headers=_header(token))).status_code == 200


async def test_failed_bank_setup_records_the_setup_status(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    gateway.pad_intents[intent] = replace(
        gateway.pad_intents[intent], status="requires_payment_method"
    )
    await _event(as_owner, "setup_intent.setup_failed", {"id": intent}, event="evt_failed")
    assert await column(db, "payment_setup_links", link.id, "setup_status") == (
        "requires_payment_method"
    )


async def test_bank_links_and_card_setup_wait_for_card_payments_to_be_on(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_charges_enabled = False
    await db.commit()
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 409
    setup = await as_owner.post(f"/v1/payments/setup-intent/{cid}")
    assert setup.status_code == 409, setup.text


async def _active_bank(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> tuple[PaymentMethod, str]:
    link, token = await _link(api, db)
    intent = await _start(api, token)
    pm = _authorized(gateway, intent)
    await _event(api, "payment_method.attached", pm)
    await _event(api, "setup_intent.succeeded", {"id": intent}, event="evt_verified")
    method = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one()
    assert method.mandate_status == "active"
    return method, await sent_invoice(db, client=link.client_id, total=5000)


async def _charge(api: httpx.AsyncClient, invoice_id: str, method_id: str) -> httpx.Response:
    body = {"method": "card", "amount_cents": 4000, "payment_method_id": method_id}
    return await api.post(f"/v1/invoices/{invoice_id}/payments", json=body, headers=retry_key())


async def test_a_saved_bank_account_is_charged_under_its_mandate(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    """Stripe refuses an off-session PAD debit without the mandate (sandbox check 6)."""
    method, invoice_id = await _active_bank(as_owner, db, gateway)
    response = await _charge(as_owner, invoice_id, method.id)
    assert response.status_code == 201, response.text
    assert gateway.mandated_charges == [("pm_authorized", "mandate_test")]


async def test_a_bank_account_whose_mandate_stripe_no_longer_holds_is_not_charged(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    method, invoice_id = await _active_bank(as_owner, db, gateway)
    gateway.mandates["mandate_test"] = replace(gateway.mandates["mandate_test"], status="inactive")
    response = await _charge(as_owner, invoice_id, method.id)
    assert response.status_code == 409
    assert gateway.mandated_charges == [] and gateway.charges == {}


async def test_a_link_is_not_replaced_while_the_client_verifies_the_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    link_id, cid = link.id, link.client_id
    intent = await _start(as_owner, token)
    gateway.pad_intents[intent] = replace(
        gateway.pad_intents[intent],
        status="requires_action",
        verification_url="https://verify.stripe.test/mandate",
    )
    await as_owner.get("/payment-method", headers=_header(token))
    status = (await as_owner.get(f"/v1/payments/pad-links/{cid}")).json()
    assert status == {"id": link_id, "verifying": True, "expires_at": status["expires_at"]}
    refused = await as_owner.post(f"/v1/payments/pad-links/{cid}")
    assert (refused.status_code, refused.json()["error"]) == (409, "bank_setup_in_progress")
    assert await column(db, "payment_setup_links", link_id, "revoked_at") is None
    await as_owner.delete(f"/v1/payments/pad-links/{link_id}")
    assert (await as_owner.get(f"/v1/payments/pad-links/{cid}")).json() is None
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 200


async def test_an_open_link_shows_as_waiting_until_it_is_used_or_expires(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    link, _ = await _link(as_owner, db)
    open_link = (await as_owner.get(f"/v1/payments/pad-links/{link.client_id}")).json()
    assert open_link["id"] == link.id and open_link["verifying"] is False
    link.expires_at = clock.now() - timedelta(minutes=1)
    await db.flush()
    assert (await as_owner.get(f"/v1/payments/pad-links/{link.client_id}")).json() is None


async def test_a_link_can_be_texted_to_the_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    res = await as_owner.post(f"/v1/payments/pad-links/{cid}", json={"text": True})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["texted"] is True
    [sent] = sms.sent
    assert body["url"] in sent.body and "pre-authorized debit" in sent.body


async def test_a_link_cannot_be_texted_to_a_client_without_a_mobile(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    cid = await client_id(db, phone=None)
    await db.execute(update(Client).where(Client.id == cid).values(phone=None))
    res = await as_owner.post(f"/v1/payments/pad-links/{cid}", json={"text": True})
    assert (res.status_code, res.json()["error"]) == (422, "no_mobile_number")
    assert sms.sent == []
    open_links = await db.scalar(
        select(func.count())
        .select_from(PaymentSetupLink)
        .where(PaymentSetupLink.client_id == cid, PaymentSetupLink.revoked_at.is_(None))
    )
    assert open_links == 0


async def test_link_status_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    other = await factory.business()
    stranger = await factory.client(business=other)
    assert (await as_owner.get(f"/v1/payments/pad-links/{stranger.id}")).status_code == 404


async def test_staff_cannot_read_link_status(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (await as_staff.get(f"/v1/payments/pad-links/{await client_id(db)}")).status_code == 403


async def test_a_bank_finished_on_a_revoked_link_is_dropped_and_detached(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    pm = _authorized(gateway, intent)
    await _event(as_owner, "payment_method.attached", pm)
    saved = select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized")
    pending = (await db.execute(saved)).scalar_one()
    assert pending.mandate_status == "pending" and pending.preferred is False
    await as_owner.delete(f"/v1/payments/pad-links/{link.id}")
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_late_setup")
    assert (await db.execute(saved)).scalar_one_or_none() is None
    assert gateway.detached == ["pm_authorized"]
    assert await column(db, "payment_setup_links", link.id, "setup_status") == "revoked"
    await _event(as_owner, "payment_method.attached", pm, event="evt_late_attach")
    assert (await db.execute(saved)).scalar_one_or_none() is None


async def test_a_verified_bank_becomes_the_default_only_once_it_can_be_charged(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, factory: Factory
) -> None:
    await enable_payments(db)
    business = await db.get(Business, BIZ)
    assert business is not None
    fresh = await factory.client(business=business, name="Bank Only")
    fresh.phone = "+16045550199"
    await db.flush()
    res = await as_owner.post(f"/v1/payments/pad-links/{fresh.id}")
    token = parse_qs(urlsplit(res.json()["url"]).fragment)["token"][0]
    intent = await _start(as_owner, token)
    pm = _authorized(gateway, intent, status="pending")
    await _event(as_owner, "payment_method.attached", pm)
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_pending_setup")
    saved = select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized")
    method = (await db.execute(saved)).scalar_one()
    assert method.mandate_status == "pending" and method.preferred is False
    gateway.mandates["mandate_test"] = replace(gateway.mandates["mandate_test"], status="active")
    await _event(as_owner, "mandate.updated", {"id": "mandate_test"}, event="evt_active")
    assert await column(db, "payment_methods", method.id, "preferred") is True


async def test_a_link_is_not_texted_to_a_client_who_replied_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    await replied_stop(db, cid)
    res = await as_owner.post(f"/v1/payments/pad-links/{cid}", json={"text": True})
    assert (res.status_code, res.json()["error"]) == (409, "texts_stopped")
    assert sms.sent == []


async def _authorized_bank(
    as_owner: httpx.AsyncClient, gateway: FakePaymentGateway, token: str
) -> tuple[str, dict[str, object]]:
    intent = await _start(as_owner, token)
    pm = _authorized(gateway, intent)
    await _event(as_owner, "payment_method.attached", pm)
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_authorized")
    return intent, pm


async def test_a_new_link_keeps_the_bank_an_earlier_link_authorized(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent, _ = await _authorized_bank(as_owner, gateway, token)
    saved = select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized")
    assert (await db.execute(saved)).scalar_one().mandate_status == "active"
    again = await as_owner.post(f"/v1/payments/pad-links/{link.client_id}")
    assert again.status_code == 200, again.text
    assert await column(db, "payment_setup_links", link.id, "revoked_at") is None
    refused = await as_owner.delete(f"/v1/payments/pad-links/{link.id}")
    assert (refused.status_code, refused.json()["error"]) == (409, "pad_link_used")
    await _event(as_owner, "mandate.updated", {"id": "mandate_test"}, event="evt_later")
    await _event(as_owner, "setup_intent.succeeded", {"id": intent}, event="evt_dup")
    assert (await db.execute(saved)).scalar_one().mandate_status == "active"
    assert gateway.detached == []


async def test_a_verification_past_its_link_no_longer_blocks_a_new_link(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    link, token = await _link(as_owner, db)
    intent = await _start(as_owner, token)
    gateway.pad_intents[intent] = replace(gateway.pad_intents[intent], status="requires_action")
    await as_owner.get("/payment-method", headers=_header(token))
    assert await column(db, "payment_setup_links", link.id, "setup_status") == "requires_action"
    link.expires_at = clock.now() - timedelta(minutes=1)
    await db.flush()
    assert (await as_owner.get(f"/v1/payments/pad-links/{link.client_id}")).json() is None
    replaced = await as_owner.post(f"/v1/payments/pad-links/{link.client_id}")
    assert replaced.status_code == 200, replaced.text


async def test_a_link_is_not_texted_to_a_number_that_cannot_take_texts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(phone="12"))
    res = await as_owner.post(f"/v1/payments/pad-links/{cid}", json={"text": True})
    assert (res.status_code, res.json()["error"]) == (422, "no_mobile_number")
    assert sms.sent == []


async def test_a_default_whose_mandate_ends_hands_its_memberships_to_the_next_default(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, factory: Factory
) -> None:
    await enable_payments(db)
    business = await db.get(Business, BIZ)
    assert business is not None
    fresh = await factory.client(business=business, name="Bank Member")
    fresh.phone = "+16045550198"
    await db.flush()
    res = await as_owner.post(f"/v1/payments/pad-links/{fresh.id}")
    token = parse_qs(urlsplit(res.json()["url"]).fragment)["token"][0]
    await _authorized_bank(as_owner, gateway, token)
    bank = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_authorized"))
    ).scalar_one()
    assert bank.preferred is True
    card = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=fresh.id,
        method="card",
        provider_ref="pm_backup_card",
    )
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="subscription",
        name="Monthly Plan",
        price_cents=5000,
        currency="CAD",
        interval=1,
        frequency="month",
    )
    db.add_all([card, item])
    await db.flush()
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=fresh.id,
        item_id=item.id,
        status="active",
        provider_ref="sub_on_bank",
        payment_method_id=bank.id,
    )
    db.add(sub)
    await db.flush()
    sub_id, card_id, bank_id = sub.id, card.id, bank.id
    gateway.mandates["mandate_test"] = replace(gateway.mandates["mandate_test"], status="inactive")
    await _event(as_owner, "mandate.updated", {"id": "mandate_test"}, event="evt_ended")
    assert await column(db, "payment_methods", bank_id, "mandate_status") == "revoked"
    assert await column(db, "payment_methods", bank_id, "preferred") is False
    assert await column(db, "payment_methods", card_id, "preferred") is True
    assert await column(db, "subscriptions", sub_id, "payment_method_id") == card_id
    assert gateway.subscription_methods == {"sub_on_bank": "pm_backup_card"}
