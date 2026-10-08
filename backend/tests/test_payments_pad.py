import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict
from clientbridge.integrations.stripe import MandateState
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod, PaymentSetupLink
from clientbridge.services.payments import default_method_ref, resolve_saved_method_ref
from tests.conftest import BIZ, Factory, FakePaymentGateway
from tests.helpers import client_id, enable_payments


async def _link(api: httpx.AsyncClient, db: AsyncSession) -> tuple[PaymentSetupLink, str]:
    await enable_payments(db)
    cid = "cl_amelie"
    client = await db.get(Client, cid)
    assert client is not None
    client.email = "pad@example.test"
    await db.flush()
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


async def _start(api: httpx.AsyncClient, token: str) -> str:
    response = await api.post("/payment-method/start", headers=_header(token))
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
    link.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()
    assert (await as_owner.post("/payment-method/start", headers=_header(token))).status_code == 404
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
        await as_owner.post("/payment-method/start", headers=_header(token3))
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


async def test_link_requires_email_and_connected_account(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    client = await db.get(Client, cid)
    assert client is not None
    client.email = None
    await db.commit()
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 409
    client.email = "pad@example.test"
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_account_id = None
    await db.commit()
    assert (await as_owner.post(f"/v1/payments/pad-links/{cid}")).status_code == 409


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
    assert method.mandate_status == "active"
    assert await resolve_saved_method_ref(db, BIZ, method.id, link.client_id) == "pm_authorized"
    context = (await as_owner.get("/payment-method", headers=_header(token))).json()
    assert context["status"] == "succeeded" and context["client_secret"] is None
    await _event(as_owner, "payment_method.attached", pm, event="evt_late_attached")
    assert method.mandate_status == "active"
    gateway.mandates["mandate_test"] = replace(gateway.mandates["mandate_test"], status="inactive")
    await _event(
        as_owner,
        "mandate.updated",
        {"id": "mandate_test", "status": "active"},
        event="evt_old_active_payload",
    )
    assert method.mandate_status == "revoked"
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
    assert method.mandate_status == "revoked"
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
    assert (await as_owner.post("/payment-method/start", headers=_header(token))).status_code == 409


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
    data = (await as_owner.post("/payment-method/start", headers=_header(token))).json()
    assert data["status"] == "processing" and data["client_secret"] is None


async def test_link_requires_enabled_pad_capability(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db, email="pad@example.test")
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
    assert link.expires_at < datetime.now(UTC) + timedelta(days=11)
    assert (await as_owner.get("/payment-method", headers=_header(token))).status_code == 200
