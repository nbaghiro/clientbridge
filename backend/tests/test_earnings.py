"""Staff earnings on the ledger (accrue on a paid invoice → approve → pay), Stripe payouts, and
the remittance figure — against the seeded DB."""

import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import AuditLog
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services import ledger_service as ledger
from clientbridge.services.earning_service import ensure_earnings, load_earning
from clientbridge.services.ledger_service import Leg
from tests.conftest import Factory, book_invoice

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _seed_id(db: AsyncSession, model: type[Client] | type[Item]) -> str:
    row = (
        (await db.execute(select(model.id).where(model.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert row
    return row


async def _paid_booking(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    *,
    rate_type: str = "percent",
    rate: float = 60.0,
    payee: bool = True,
    end_hour: int = 16,
    end_min: int = 0,
) -> tuple[str, str, str]:
    """Pay + settle a $100 booking line for Diego; return (booking_id, invoice_id, payment_id)."""
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_earn", stripe_charges_enabled=True)
    )
    await db.execute(
        update(Staff)
        .where(Staff.id == "st_diego")
        .values(is_payee=payee, rate_type=rate_type, default_rate=rate)
    )
    await db.flush()
    cid = await _seed_id(db, Client)
    sess = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=await _seed_id(db, Item),
        staff_id="st_diego",
        starts_at=datetime(2030, 1, 1, 15, tzinfo=UTC),
        ends_at=datetime(2030, 1, 1, end_hour, end_min, tzinfo=UTC),
        capacity=1,
        booked_count=1,
        status="scheduled",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=sess.id,
        staff_id="st_diego",
        client_id=cid,
        status="confirmed",
        source="manual",
        price_cents=10000,
    )
    db.add(booking)
    await db.flush()
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9301,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=0,
        total_cents=10000,
    )
    db.add(inv)
    await db.flush()
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            parent_type="invoice",
            parent_id=inv.id,
            description="Service",
            booking_id=booking.id,
            quantity=1,
            unit_amount_cents=10000,
            amount_cents=10000,
            position=0,
        )
    )
    await db.flush()
    await book_invoice(db, inv)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv.id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    event = json.dumps(
        {
            "id": f"evt_{booking.id}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi}},
        }
    )
    await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)
    return booking.id, inv.id, pay["payment_id"]


async def _journals(db: AsyncSession, booking_id: str) -> list[str]:
    rows = await db.execute(
        select(Entry.journal_id)
        .where(Entry.type == "earning", Entry.subject_id == booking_id)
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


async def _earning(db: AsyncSession, *, business_id: str = BIZ, staff_id: str = "st_diego") -> str:
    journal = await ledger.post(
        db,
        business_id,
        type="earning",
        ref=f"earning:{new_id('booking')}:0",
        legs=[
            Leg("business", business_id, "staff_cost", 6000),
            Leg("staff", staff_id, "payable", -6000, "pending"),
        ],
        subject=("booking", new_id("booking")),
    )
    assert journal is not None
    return journal


async def _payable(db: AsyncSession, staff_id: str, stage: str) -> int:
    return await ledger.balance(
        db, BIZ, owner_type="staff", owner_id=staff_id, kind="payable", code=stage
    )


async def test_percent_payee_accrues_on_paid_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, _ = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None
    assert earning.staff_id == "st_diego" and earning.booking_id == booking_id
    assert earning.amount_cents == 6000  # 60% of the $100 line
    assert earning.status == "pending"
    meta = (
        await db.execute(select(Entry.meta).where(Entry.journal_id == journal).limit(1))
    ).scalar_one()
    assert meta["basis"] == "percent"


async def test_hourly_payee_accrues(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    booking_id, _, _ = await _paid_booking(
        as_owner, db, rate_type="hourly", rate=22.0, end_hour=16, end_min=30
    )
    earning = await load_earning(db, BIZ, (await _journals(db, booking_id))[0])
    assert earning is not None and earning.amount_cents == 3300  # $22/hr x 1.5h


async def test_fixed_payee_accrues(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    booking_id, _, _ = await _paid_booking(as_owner, db, rate_type="fixed", rate=15.0)
    earning = await load_earning(db, BIZ, (await _journals(db, booking_id))[0])
    assert earning is not None and earning.amount_cents == 1500  # flat $15 per booking


async def test_non_payee_accrues_nothing(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    booking_id, _, _ = await _paid_booking(as_owner, db, payee=False)
    assert await _journals(db, booking_id) == []


async def test_approve_then_pay_moves_payable_to_bank(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    staff = await factory.staff(business=biz, role="staff")
    journal = await _earning(db, staff_id=staff.id)
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, kind="bank")

    approved = await as_owner.post(f"/v1/earnings/{journal}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json() == {
        "id": journal,
        "staff_id": staff.id,
        "booking_id": approved.json()["booking_id"],
        "amount_cents": 6000,
        "status": "approved",
    }
    assert await _payable(db, staff.id, "pending") == 0
    assert await _payable(db, staff.id, "approved") == -6000

    paid = await as_owner.post(f"/v1/earnings/{journal}/pay")
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "paid"
    assert await _payable(db, staff.id, "approved") == 0
    assert (
        await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, kind="bank")
        == bank - 6000
    )


async def test_approve_unknown_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/earnings/jrn_nope/approve")).status_code == 404


async def test_approve_non_pending_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_owner.post(f"/v1/earnings/{journal}/approve")).status_code == 200
    assert (await as_owner.post(f"/v1/earnings/{journal}/approve")).status_code == 409


async def test_pay_before_approve_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_owner.post(f"/v1/earnings/{journal}/pay")).status_code == 409


async def test_staff_cannot_approve_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_staff.post(f"/v1/earnings/{journal}/approve")).status_code == 403


async def test_other_business_earning_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    journal = await _earning(db, business_id=other.id, staff_id=staff.id)
    assert (await as_owner.post(f"/v1/earnings/{journal}/approve")).status_code == 404


async def test_idempotent_approve_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    headers = {"Idempotency-Key": "earn-approve-1"}
    first = await as_owner.post(f"/v1/earnings/{journal}/approve", headers=headers)
    second = await as_owner.post(f"/v1/earnings/{journal}/approve", headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert second.json()["status"] == "approved"


async def test_idempotent_pay_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    journal = await _earning(db)
    assert (await as_owner.post(f"/v1/earnings/{journal}/approve")).status_code == 200
    headers = {"Idempotency-Key": "earn-pay-1"}
    first = await as_owner.post(f"/v1/earnings/{journal}/pay", headers=headers)
    second = await as_owner.post(f"/v1/earnings/{journal}/pay", headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    paid_audits = (
        await db.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.entity_id == journal, AuditLog.action == "earning.pay")
        )
    ).scalar_one()
    assert paid_audits == 1
    payments = (
        await db.execute(
            select(func.count(func.distinct(Entry.journal_id))).where(
                Entry.type == "staff_payment", Entry.source_id == journal
            )
        )
    ).scalar_one()
    assert payments == 1


async def test_refund_reverses_pending_earning(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pending = await _payable(db, "st_diego", "pending")
    booking_id, inv_id, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    assert await _payable(db, "st_diego", "pending") == pending - 6000
    assert (await as_owner.post(f"/v1/payments/{payment_id}/refund")).status_code == 200
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "reversed"
    assert await _payable(db, "st_diego", "pending") == pending

    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None and invoice.status == "refunded"
    await ensure_earnings(db, invoice)  # a reversed earning can accrue again, on a fresh journal
    journals = await _journals(db, booking_id)
    assert len(journals) == 2 and journals[0] == journal
    again = await load_earning(db, BIZ, journals[1])
    assert again is not None and again.status == "pending" and again.amount_cents == 6000


async def test_refund_leaves_approved_earning(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    assert (await as_owner.post(f"/v1/earnings/{journal}/approve")).status_code == 200
    assert (await as_owner.post(f"/v1/payments/{payment_id}/refund")).status_code == 200
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "approved"


def _payout_event(event_id: str, kind: str, payout_id: str, amount: int) -> str:
    return json.dumps(
        {
            "id": event_id,
            "type": kind,
            "account": "acct_po",
            "data": {
                "object": {
                    "id": payout_id,
                    "amount": amount,
                    "currency": "cad",
                    "arrival_date": 1700000000,
                }
            },
        }
    )


async def _balances(db: AsyncSession) -> tuple[int, int]:
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, kind="bank")
    stripe = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, kind="stripe")
    return bank, stripe


async def test_payout_paid_posts_then_failed_reverses(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_po"))
    await db.flush()
    bank, stripe = await _balances(db)

    paid = await api.post(
        "/webhooks/stripe",
        content=_payout_event("evt_po_paid", "payout.paid", "po_1", 50000),
        headers=GOOD,
    )
    assert paid.status_code == 200
    legs = (
        await db.execute(
            select(Account.kind, Entry.amount_cents, Entry.business_id)
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.ref == "payout:po_1")
        )
    ).all()
    assert sorted((kind, cents, biz) for kind, cents, biz in legs) == [
        ("bank", 50000, BIZ),
        ("stripe", -50000, BIZ),
    ]
    assert await _balances(db) == (bank + 50000, stripe - 50000)

    replay = await api.post(
        "/webhooks/stripe",
        content=_payout_event("evt_po_paid_again", "payout.paid", "po_1", 50000),
        headers=GOOD,
    )
    assert replay.status_code == 200
    assert await _balances(db) == (bank + 50000, stripe - 50000)  # one journal per payout

    failed = await api.post(
        "/webhooks/stripe",
        content=_payout_event("evt_po_failed", "payout.failed", "po_1", 50000),
        headers=GOOD,
    )
    assert failed.status_code == 200
    assert await _balances(db) == (bank, stripe)
    assert await ledger.journal_for(db, BIZ, "payout:po_1:failed") is not None


async def test_payout_for_unknown_account_is_ignored(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await api.post(
        "/webhooks/stripe",
        content=_payout_event("evt_po_none", "payout.paid", "po_none", 100),
        headers=GOOD,
    )
    assert res.status_code == 200
    assert await ledger.journal_for(db, BIZ, "payout:po_none") is None


async def test_remittance_is_tax_payable_on_the_ledger(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    before = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _seed_id(db, Client),
        number=9200,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=1200,
        total_cents=11200,
    )
    db.add(inv)
    await db.flush()
    await book_invoice(db, inv)
    after = (await as_owner.get("/v1/payments/remittance")).json()["tax_collected_cents"]
    assert after - before == 1200


async def test_staff_cannot_view_remittance(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/payments/remittance")).status_code == 403
