import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.integrations.resend import Email
from clientbridge.models.messaging import Delivery
from clientbridge.services.deliveries import run_deliveries
from tests.conftest import FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import client_id, key, ok

BRUSH = {"description": "Brush", "unit_amount_cents": 2900, "tax_class": "standard"}
LINE = {"description": "Consultation", "quantity": 1.0, "unit_amount_cents": 10000}


def _mailed(email: FakeEmailSender, address: str, marker: str = "") -> int:
    return len([m for m in email.sent if m.to == address and marker in m.body])


def _offline(email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch) -> None:
    async def unreachable(_: Email) -> str | None:
        raise httpx.ConnectError("email provider unreachable")

    monkeypatch.setattr(email, "send", unreachable)


async def _retry_later(
    db: AsyncSession,
    scope: str,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> list[str]:
    rows = list(await db.scalars(select(Delivery).where(Delivery.key.startswith(scope))))
    states = [row.state for row in rows]
    for row in rows:
        row.next_at = clock.now()
    await db.commit()
    await run_deliveries(db, email, sms, push)
    return states


async def _sale(api: httpx.AsyncClient, db: AsyncSession, address: str) -> str:
    cid = await client_id(db, email=address)
    sale = await api.post("/v1/orders", json={"client_id": cid, "lines": [BRUSH]})
    return str(ok(sale, 201).json()["id"])


async def test_a_replayed_cash_sale_sends_one_receipt(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    sale = await _sale(as_owner, db, "cash-replay@example.ca")
    headers = key()
    body = {"tendered_cents": 4000}
    first = ok(await as_owner.post(f"/v1/orders/{sale}/cash", json=body, headers=headers))
    again = ok(await as_owner.post(f"/v1/orders/{sale}/cash", json=body, headers=headers))
    assert again.json() == first.json()
    assert _mailed(email, "cash-replay@example.ca") == 1


async def test_a_cash_receipt_the_provider_missed_goes_on_the_next_run(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sale = await _sale(as_owner, db, "cash-offline@example.ca")
    send = email.send
    _offline(email, monkeypatch)
    paid = ok(
        await as_owner.post(f"/v1/orders/{sale}/cash", json={"tendered_cents": 4000}, headers=key())
    ).json()
    monkeypatch.setattr(email, "send", send)
    assert "queued" in await _retry_later(db, f"payment:{paid['payment_id']}:", email, sms, push)
    assert _mailed(email, "cash-offline@example.ca") == 1


async def test_a_replayed_create_and_send_mails_the_invoice_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await client_id(db, email="invoice-replay@example.ca")
    headers = key()
    body = {"client_id": cid, "lines": [LINE], "send": True}
    first = ok(await as_owner.post("/v1/invoices", json=body, headers=headers), 201).json()
    again = ok(await as_owner.post("/v1/invoices", json=body, headers=headers), 201).json()
    assert again["id"] == first["id"]
    assert _mailed(email, "invoice-replay@example.ca", f"/i/{first['pay_token']}") == 1


async def test_a_replayed_send_or_reminder_mails_once_and_a_new_send_mails_again(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await client_id(db, email="invoice-resend@example.ca")
    draft = ok(
        await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [LINE]}), 201
    ).json()
    path = f"/v1/invoices/{draft['id']}"
    send = key()
    first = ok(await as_owner.post(f"{path}/send", headers=send)).json()
    ok(await as_owner.post(f"{path}/send", headers=send))
    link = f"/i/{first['pay_token']}"
    assert _mailed(email, "invoice-resend@example.ca", link) == 1
    ok(await as_owner.post(f"{path}/send", headers=key()))
    assert _mailed(email, "invoice-resend@example.ca", link) == 2
    remind = key()
    ok(await as_owner.post(f"{path}/remind", headers=remind))
    ok(await as_owner.post(f"{path}/remind", headers=remind))
    assert _mailed(email, "invoice-resend@example.ca", link) == 3


async def test_an_invoice_the_provider_missed_goes_on_the_next_run(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = await client_id(db, email="invoice-offline@example.ca")
    draft = ok(
        await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [LINE]}), 201
    ).json()
    send = email.send
    _offline(email, monkeypatch)
    sent = ok(await as_owner.post(f"/v1/invoices/{draft['id']}/send", headers=key())).json()
    assert sent["status"] == "sent"
    monkeypatch.setattr(email, "send", send)
    scope = f"invoice-sent:{draft['id']}:"
    assert "queued" in await _retry_later(db, scope, email, sms, push)
    assert _mailed(email, "invoice-offline@example.ca", f"/i/{sent['pay_token']}") == 1
