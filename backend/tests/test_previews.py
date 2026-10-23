from datetime import timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, Signature
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import new_client, sent_invoice


async def _texting_client(db: AsyncSession) -> str:
    cid = await new_client(db, name="Rosa Park")
    await db.execute(update(Client).where(Client.id == cid).values(phone="+16045550123"))
    await db.flush()
    return cid


async def _draft_invoice(as_owner: httpx.AsyncClient, cid: str) -> str:
    line = {"description": "Consultation", "quantity": 1, "unit_amount_cents": 10000}
    res = await as_owner.post("/v1/invoices", json={"client_id": cid, "lines": [line]})
    return str(res.json()["id"])


async def _upcoming_visit(db: AsyncSession, cid: str) -> Booking:
    booking = await db.scalar(
        select(Booking)
        .join(Slot, Slot.id == Booking.slot_id)
        .where(
            Booking.business_id == BIZ,
            Booking.status == "confirmed",
            Booking.staff_id.is_not(None),
            Slot.starts_at > clock.now(),
            Slot.capacity == 1,
        )
        .limit(1)
    )
    assert booking is not None
    booking.client_id = cid
    await db.flush()
    return booking


async def test_draft_invoice_preview_shows_the_message_and_sends_nothing(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    cid = await _texting_client(db)
    inv = await _draft_invoice(as_owner, cid)
    res = await as_owner.get(f"/v1/previews/invoices/{inv}/send")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recipient"] == "Rosa Park"
    assert body["email"]["to"] == "client@example.ca"
    assert "Invoice #" in body["email"]["subject"]
    assert body["text"]["to"] == "+16045550123"
    assert email.sent == [] and sms.sent == []
    after = await db.get(Invoice, inv, populate_existing=True)
    assert after is not None and after.status == "draft" and after.number is None
    assert after.pay_token is None


async def test_remind_preview_uses_reminder_then_overdue_wording(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db)
    inv = await sent_invoice(
        db, client=cid, number=9001, pay_token="tok", due_at=clock.now() + timedelta(days=3)
    )
    soon = (await as_owner.get(f"/v1/previews/invoices/{inv}/remind")).json()
    assert soon["email"]["subject"].startswith("Reminder")
    assert soon["text"] is None
    await db.execute(
        update(Invoice).where(Invoice.id == inv).values(due_at=clock.now() - timedelta(days=2))
    )
    late = (await as_owner.get(f"/v1/previews/invoices/{inv}/remind")).json()
    assert "overdue" in late["email"]["subject"]


async def test_remind_preview_refuses_a_draft(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv = await _draft_invoice(as_owner, await new_client(db))
    assert (await as_owner.get(f"/v1/previews/invoices/{inv}/remind")).status_code == 409


async def test_draft_estimate_preview(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await new_client(db)
    line = {"description": "Fence repair", "quantity": 1, "unit_amount_cents": 40000}
    est = (await as_owner.post("/v1/estimates", json={"client_id": cid, "lines": [line]})).json()
    res = await as_owner.get(f"/v1/previews/estimates/{est['id']}/send")
    assert res.status_code == 200, res.text
    assert "Estimate #" in res.json()["email"]["subject"]
    after = await db.get(Estimate, est["id"], populate_existing=True)
    assert after is not None and after.status == "draft" and after.view_token is None


async def test_reschedule_preview_names_the_new_time_without_moving(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _upcoming_visit(db, await new_client(db))
    slot = await db.get(Slot, booking.slot_id)
    assert slot is not None
    starts, ends = slot.starts_at, slot.ends_at
    params = {
        "starts_at": (starts + timedelta(days=1)).isoformat(),
        "ends_at": (ends + timedelta(days=1)).isoformat(),
    }
    res = await as_owner.get(f"/v1/previews/bookings/{booking.id}/rescheduled", params=params)
    assert res.status_code == 200, res.text
    assert res.json()["email"] is not None
    moved = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert moved is not None and moved.starts_at == starts


async def test_departure_preview_is_a_text(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    booking = await _upcoming_visit(db, await _texting_client(db))
    body = (await as_owner.get(f"/v1/previews/bookings/{booking.id}/departed")).json()
    assert body["email"] is None
    assert body["text"]["to"] == "+16045550123"


async def test_move_without_notice_tells_nobody(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
) -> None:
    booking = await _upcoming_visit(db, await _texting_client(db))
    slot = await db.get(Slot, booking.slot_id)
    assert slot is not None
    res = await as_owner.patch(
        f"/v1/bookings/{booking.id}",
        json={
            "starts_at": (slot.starts_at + timedelta(days=63)).isoformat(),
            "ends_at": (slot.ends_at + timedelta(days=63)).isoformat(),
            "notify": False,
        },
    )
    assert res.status_code == 200, res.text
    assert email.sent == [] and sms.sent == []


async def test_form_contract_and_review_previews(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db)
    form = await db.scalar(select(Form).where(Form.business_id == BIZ).limit(1))
    contract = await db.scalar(select(Contract).where(Contract.business_id == BIZ).limit(1))
    assert form is not None and contract is not None
    sent_form = await as_owner.get(f"/v1/previews/forms/{form.id}/send", params={"client_id": cid})
    assert form.name in sent_form.json()["email"]["body"]
    signed = await as_owner.get(
        f"/v1/previews/contracts/{contract.id}/send", params={"client_id": cid}
    )
    assert contract.name in signed.json()["email"]["body"]
    review = await as_owner.get("/v1/previews/reviews/request", params={"client_id": cid})
    assert review.status_code == 200, review.text
    assert review.json()["recipient"] == "Test Client"


async def test_staff_cannot_preview_billing_sends(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/previews/invoices/inv_x/send")).status_code == 403
    assert (await as_staff.get("/v1/previews/reviews/request?client_id=cl_x")).status_code == 403


async def test_foreign_records_are_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=other.id,
        client_id=foreign.id,
        status="draft",
        currency="CAD",
    )
    db.add(inv)
    await db.flush()
    assert (await as_owner.get(f"/v1/previews/invoices/{inv.id}/send")).status_code == 404
    form = await db.scalar(select(Form).where(Form.business_id == BIZ).limit(1))
    assert form is not None
    res = await as_owner.get(f"/v1/previews/forms/{form.id}/send", params={"client_id": foreign.id})
    assert res.status_code == 404


async def test_order_and_signature_previews(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    order = await db.scalar(
        select(Order).where(Order.business_id == BIZ, Order.client_id.is_not(None)).limit(1)
    )
    signature = await db.scalar(select(Signature).where(Signature.business_id == BIZ).limit(1))
    assert order is not None and signature is not None
    ready = await as_owner.get(f"/v1/previews/orders/{order.id}/ready")
    assert ready.status_code == 200, ready.text
    receipt = await as_owner.get(
        f"/v1/previews/orders/{order.id}/receipt", params={"channel": "email", "to": "a@b.ca"}
    )
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["email"]["to"] == "a@b.ca"
    resend = await as_owner.get(f"/v1/previews/signatures/{signature.id}/resend")
    assert resend.status_code == 200, resend.text
