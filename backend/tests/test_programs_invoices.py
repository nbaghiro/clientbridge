from datetime import datetime, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger
from clientbridge.services.bookings import run_reap_unpaid_bookings
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)
from tests.helpers import enable_payments, key, ok, payment_by_ref, settle
from tests.test_programs import FIRST, bookings, enrol, ids, program, program_item, schedule

CAMP = "Spring Agility Camp"


async def _online(api: httpx.AsyncClient, db: AsyncSession, item_id: str) -> dict[str, object]:
    """Enrol a new client through Connect, with approval of new clients turned off."""
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"lead_hours": 0})
    )
    await db.flush()
    body = {
        "item_id": item_id,
        "staff_id": "any",
        "starts_at": FIRST,
        "client": {"name": "Rosa Diaz", "email": "rosa@clients.test"},
        "subject_name": "Biscuit",
    }
    res = await api.post("/book/birchbark", json=body, headers=key())
    assert res.status_code == 200, res.text
    out: dict[str, object] = res.json()
    return out


async def _invoice(db: AsyncSession, booking_ids: list[str]) -> Invoice:
    first = (await bookings(db, booking_ids))[0]
    assert first.invoice_id is not None
    invoice = await db.get(Invoice, first.invoice_id, populate_existing=True)
    assert invoice is not None
    return invoice


async def _status(db: AsyncSession, invoice: Invoice) -> str:
    return (await ledger.invoice_state(db, invoice))[0]


async def _cancel(api: httpx.AsyncClient, program_id: str, client: str) -> httpx.Response:
    return await api.post(
        f"/v1/programs/{program_id}/enrolments/cancel", json={"client_id": client}
    )


async def test_an_enrolment_issues_the_first_days_invoice_due_that_day(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    invoice = await _invoice(db, booked)
    assert invoice.status == "sent" and invoice.number is not None
    assert invoice.pay_token is not None
    assert invoice.due_at == datetime.fromisoformat(FIRST)
    assert invoice.subtotal_cents == 30000 and invoice.client_id == "cl_amelie"
    [line] = await db.scalars(select(Line).where(Line.invoice_id == invoice.id))
    assert line.description == f"{CAMP} · 3 days" and line.booking_id == booked[0]
    assert [b.invoice_id for b in await bookings(db, booked)][1:] == [None, None]
    again = await as_owner.post(f"/v1/invoices/from-booking/{booked[0]}", headers=key())
    assert again.status_code == 409


async def test_a_replayed_enrolment_issues_one_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    url = f"/v1/programs/{program_id}/enrolments"
    headers = key()
    before = await db.scalar(select(func.count()).select_from(Invoice))
    first = ok(await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers), 201)
    again = ok(await as_owner.post(url, json={"client_id": "cl_amelie"}, headers=headers), 201)
    assert first.json() == again.json()
    assert await db.scalar(select(func.count()).select_from(Invoice)) == (before or 0) + 1


async def test_an_online_enrolment_s_paid_deposit_applies_to_its_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    await enable_payments(db)
    item_id = str((await schedule(as_owner, await program_item(db, deposit=True)))["item_id"])
    out = await _online(unauth, db, item_id)
    days = out["days"]
    assert isinstance(days, list) and len(days) == 3
    assert [d["booking_id"] for d in days] == ids(out, "booking_ids")
    assert days[0]["starts_at"].startswith("2027-03-02T18:00")
    invoice = await _invoice(db, ids(out, "booking_ids"))
    [line] = await db.scalars(select(Line).where(Line.invoice_id == invoice.id))
    assert line.description == f"{CAMP} · 3 days"
    secret = out["deposit_client_secret"]
    assert isinstance(secret, str)
    deposit = await payment_by_ref(db, secret.removesuffix("_secret"))
    await settle(unauth, db, deposit.id)
    first = (await bookings(db, ids(out, "booking_ids")))[0]
    assert first.deposit_status == "applied"
    assert await _status(db, invoice) == "sent"
    assert await ledger.invoice_balance(db, invoice) == invoice.total_cents - 5000


async def test_canceling_an_enrolment_voids_its_invoice_and_refunds_the_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    await enable_payments(db)
    item_id = str((await schedule(as_owner, await program_item(db, deposit=True)))["item_id"])
    out = await _online(unauth, db, item_id)
    secret = out["deposit_client_secret"]
    assert isinstance(secret, str)
    await settle(unauth, db, (await payment_by_ref(db, secret.removesuffix("_secret"))).id)
    first = (await bookings(db, ids(out, "booking_ids")))[0]
    assert first.manage_token is not None
    res = await unauth.post(f"/manage/{first.manage_token}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert res.json()["refund_cents"] == 5000
    invoice = await _invoice(db, ids(out, "booking_ids"))
    assert invoice.status == "void" and invoice.voided_at is not None
    assert {b.status for b in await bookings(db, ids(out, "booking_ids"))} == {"canceled"}


async def test_a_staff_cancel_voids_the_enrolment_s_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    ok(await _cancel(as_owner, program_id, "cl_amelie"))
    assert (await _invoice(db, booked)).status == "void"


async def test_declining_a_requested_enrolment_voids_its_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    rows = await bookings(db, ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids"))
    for row in rows:
        row.status = "pending"
    await db.flush()
    ok(await as_owner.patch(f"/v1/bookings/{rows[1].id}", json={"status": "canceled"}))
    assert (await _invoice(db, [r.id for r in rows])).status == "void"


async def test_an_unpaid_online_enrolment_s_invoice_is_voided_with_it(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    await enable_payments(db)
    item_id = str((await schedule(as_owner, await program_item(db, deposit=True)))["item_id"])
    booked = ids(await _online(unauth, db, item_id), "booking_ids")
    await db.execute(
        update(Booking)
        .where(Booking.id.in_(booked))
        .values(created_at=clock.now() - timedelta(hours=1))
    )
    notifier = Notifier(FakeEmailSender(), FakeSmsSender(), FakePushSender())
    assert await run_reap_unpaid_bookings(db, FakePaymentGateway(), notifier, clock.now()) >= 1
    assert (await _invoice(db, booked)).status == "void"


async def test_a_paid_enrolment_is_not_canceled_until_it_is_refunded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    program_id = await program(as_owner, db)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    invoice = await _invoice(db, booked)
    ok(
        await as_owner.post(
            f"/v1/invoices/{invoice.id}/payments",
            json={"method": "cash", "amount_cents": 10000},
            headers=key(),
        ),
        201,
    )
    res = await _cancel(as_owner, program_id, "cl_amelie")
    assert res.status_code == 409 and res.json()["error"] == "enrolment_paid"
    assert {b.status for b in await bookings(db, booked)} == {"confirmed"}
    assert (await _invoice(db, booked)).status == "sent"


async def test_a_member_voids_their_enrolment_s_invoice_only_by_canceling_it(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    made = await schedule(as_staff, await program_item(db), staff_id="st_diego")
    program_id = str(made["id"])
    booked = ids(await enrol(as_staff, program_id, "cl_amelie"), "booking_ids")
    invoice = await _invoice(db, booked)
    assert invoice.business_id == BIZ
    assert (await as_staff.post(f"/v1/invoices/{invoice.id}/void")).status_code == 403
    ok(await _cancel(as_staff, program_id, "cl_amelie"))
    assert (await _invoice(db, booked)).status == "void"
