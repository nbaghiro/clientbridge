"""Interac requests from an invoice: amount, channel, expiry, and a new code replacing the old."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.payments import Payment
from tests.conftest import Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import client_id, key, ok, payment, sent_invoice

GOOD = {"X-Interac-Secret": "testsecret"}


async def _invoice(db: AsyncSession, token: str) -> str:
    cid = await client_id(db, email="etransfer@example.ca")
    return await sent_invoice(db, client=cid, total=10661, number=9145, pay_token=token)


async def test_request_by_text_with_expiry(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    inv = await _invoice(db, "tok_req_text")
    email.sent.clear()
    body = {"amount_cents": 5661, "channel": "sms", "expires_in_days": 7}
    out = ok(
        await as_owner.post(f"/v1/invoices/{inv}/interac-request", json=body, headers=key())
    ).json()
    assert out["amount_cents"] == 5661
    assert out["channel"] == "sms"
    row = await payment(db, out["payment_id"])
    assert row.channel == "sms" and row.status == "pending"
    assert row.expires_at is not None
    assert timedelta(days=6) < row.expires_at - datetime.now(UTC) <= timedelta(days=7)
    assert not any("e-Transfer" in m.subject for m in email.sent)


async def test_new_request_replaces_the_waiting_code(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await _invoice(db, "tok_req_replace")
    first = ok(await as_owner.post(f"/v1/invoices/{inv}/interac-request", json={})).json()
    second = ok(
        await as_owner.post(f"/v1/invoices/{inv}/interac-request", json={"channel": "email"})
    ).json()
    assert second["reference_code"] != first["reference_code"]
    assert (await payment(db, first["payment_id"])).status == "canceled"

    stale = await as_owner.post(
        "/webhooks/interac",
        json={"reference_code": first["reference_code"], "amount_cents": 10661},
        headers=GOOD,
    )
    assert stale.status_code == 200
    assert (await payment(db, first["payment_id"])).status == "canceled"


async def test_pay_page_shows_the_waiting_request_until_it_lapses(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await _invoice(db, "tok_req_page")
    out = ok(await as_owner.post(f"/v1/invoices/{inv}/interac-request", json={})).json()
    page = ok(await as_owner.get("/pay/tok_req_page")).json()
    assert page["interac"]["reference_code"] == out["reference_code"]
    assert page["interac"]["amount_cents"] == 10661

    await db.execute(
        update(Payment)
        .where(Payment.id == out["payment_id"])
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    assert ok(await as_owner.get("/pay/tok_req_page")).json()["interac"] is None
    fresh = ok(await as_owner.post("/pay/tok_req_page/interac")).json()
    assert fresh["reference_code"] != out["reference_code"]
    assert (await payment(db, out["payment_id"])).status == "canceled"


async def test_more_than_the_balance_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await _invoice(db, "tok_req_over")
    res = await as_owner.post(f"/v1/invoices/{inv}/interac-request", json={"amount_cents": 99999})
    assert res.status_code == 409


async def test_bad_channel_and_expiry_are_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await _invoice(db, "tok_req_bad")
    url = f"/v1/invoices/{inv}/interac-request"
    assert (await as_owner.post(url, json={"channel": "fax"})).status_code == 422
    assert (await as_owner.post(url, json={"expires_in_days": 0})).status_code == 422


async def test_staff_cannot_request(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await _invoice(db, "tok_req_staff")
    assert (await as_staff.post(f"/v1/invoices/{inv}/interac-request", json={})).status_code == 403


async def test_unauthenticated_cannot_request(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await _invoice(db, "tok_req_unauth")
    assert (await unauth.post(f"/v1/invoices/{inv}/interac-request", json={})).status_code == 401


async def test_foreign_invoice_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    inv = await sent_invoice(db, client=client.id, total=3000, business_id=other.id)
    res = await as_owner.post(f"/v1/invoices/{inv}/interac-request", json={})
    assert res.status_code == 404


async def test_same_key_sends_one_request(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    inv = await _invoice(db, "tok_req_key")
    headers = key()
    url = f"/v1/invoices/{inv}/interac-request"
    first = ok(await as_owner.post(url, json={"channel": "sms"}, headers=headers)).json()
    again = ok(await as_owner.post(url, json={"channel": "sms"}, headers=headers)).json()
    assert first == again
    rows = (await db.execute(select(Payment.id).where(Payment.invoice_id == inv))).scalars()
    assert len(list(rows)) == 1
