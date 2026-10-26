import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.integrations.resend import Email
from clientbridge.models.catalog import Item
from clientbridge.models.messaging import Delivery
from clientbridge.services.deliveries import run_deliveries
from tests.conftest import BIZ, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import client_id, key, new_client, ok
from tests.test_programs import program

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


async def _visit(api: httpx.AsyncClient, db: AsyncSession, address: str) -> str:
    cid = await new_client(db, email=address)
    item_id = (
        await db.execute(
            select(Item.id)
            .where(Item.business_id == BIZ, Item.duration_min.isnot(None), Item.active.is_(True))
            .order_by(Item.id)
            .limit(1)
        )
    ).scalar_one()
    body = {
        "client_id": cid,
        "item_id": item_id,
        "staff_id": "st_owner",
        "starts_at": "2027-05-04T17:00:00Z",
    }
    return str(ok(await api.post("/v1/bookings", json=body, headers=key()), 201).json()["id"])


async def test_a_reschedule_notice_the_provider_missed_goes_on_the_next_run(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    booking = await _visit(as_owner, db, "moved-offline@example.ca")
    send = email.send
    _offline(email, monkeypatch)
    moved = {"starts_at": "2027-05-05T17:00:00Z"}
    ok(await as_owner.patch(f"/v1/bookings/{booking}", json=moved))
    monkeypatch.setattr(email, "send", send)
    assert "queued" in await _retry_later(db, f"booking:{booking}:", email, sms, push)
    assert _mailed(email, "moved-offline@example.ca", "Wednesday, May 5") == 1


async def test_a_repeated_cancel_or_reschedule_sends_each_notice_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    booking = await _visit(as_owner, db, "moved-twice@example.ca")
    path = f"/v1/bookings/{booking}"
    moved = {"starts_at": "2027-05-05T17:00:00Z"}
    ok(await as_owner.patch(path, json=moved))
    ok(await as_owner.patch(path, json=moved))
    assert _mailed(email, "moved-twice@example.ca", "Wednesday, May 5") == 1
    ok(await as_owner.patch(path, json={"starts_at": "2027-05-04T17:00:00Z"}))
    ok(await as_owner.patch(path, json=moved))
    assert _mailed(email, "moved-twice@example.ca", "Wednesday, May 5") == 2
    ok(await as_owner.patch(path, json={"status": "canceled"}))
    ok(await as_owner.patch(path, json={"status": "canceled"}))
    canceled = [
        m for m in email.sent if m.to == "moved-twice@example.ca" and "cancel" in m.body.lower()
    ]
    assert len(canceled) == 1


async def _estimate(api: httpx.AsyncClient, db: AsyncSession, address: str) -> str:
    cid = await new_client(db, email=address)
    draft = await api.post("/v1/estimates", json={"client_id": cid, "lines": [LINE]})
    return str(ok(draft, 201).json()["id"])


async def test_a_replayed_estimate_send_mails_once_and_a_new_send_mails_again(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    estimate = await _estimate(as_owner, db, "estimate-replay@example.ca")
    path = f"/v1/estimates/{estimate}/send"
    headers = key()
    first = ok(await as_owner.post(path, headers=headers)).json()
    again = ok(await as_owner.post(path, headers=headers)).json()
    assert again == first
    link = f"/e/{first['view_token']}"
    assert _mailed(email, "estimate-replay@example.ca", link) == 1
    ok(await as_owner.post(path, headers=key()))
    assert _mailed(email, "estimate-replay@example.ca", link) == 2


async def test_an_estimate_the_provider_missed_goes_on_the_next_run(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    estimate = await _estimate(as_owner, db, "estimate-offline@example.ca")
    send = email.send
    _offline(email, monkeypatch)
    sent = ok(await as_owner.post(f"/v1/estimates/{estimate}/send", headers=key())).json()
    monkeypatch.setattr(email, "send", send)
    assert "queued" in await _retry_later(db, f"estimate:{estimate}:", email, sms, push)
    assert _mailed(email, "estimate-offline@example.ca", f"/e/{sent['view_token']}") == 1


async def test_a_replayed_enrolment_sends_its_message_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    program_id = await program(as_owner, db)
    cid = await new_client(db, email="enrol-replay@example.ca")
    url = f"/v1/programs/{program_id}/enrolments"
    headers = key()
    ok(await as_owner.post(url, json={"client_id": cid}, headers=headers), 201)
    ok(await as_owner.post(url, json={"client_id": cid}, headers=headers), 201)
    assert _mailed(email, "enrol-replay@example.ca") == 1
