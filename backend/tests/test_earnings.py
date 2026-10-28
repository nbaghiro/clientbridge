"""Staff earnings on the ledger: accrue on a paid invoice, approve, pay; Stripe payouts."""

import itertools
import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item, Package
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.services import ledger
from clientbridge.services.earnings import (
    claw_back_package,
    ensure_earnings,
    load_earning,
    reverse_earnings,
)
from clientbridge.services.ledger import Leg
from clientbridge.services.lines import crew_note
from clientbridge.services.payments import sync_invoice, sync_order
from tests.conftest import Factory, book_invoice
from tests.helpers import card_pay, settle
from tests.helpers import key as retry_key

BIZ = "bz_birchbark"
_NUMBERS = itertools.count(9400)
GOOD = {"Stripe-Signature": "good"}


async def _seed_id(db: AsyncSession, model: type[Client] | type[Item]) -> str:
    row = (
        (await db.execute(select(model.id).where(model.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert row
    return row


async def _diego_pay(
    db: AsyncSession, *, rate_type: str = "percent", rate: float = 60.0, payee: bool = True
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_earn", stripe_charges_enabled=True)
    )
    await db.execute(
        update(Staff)
        .where(Staff.id == "st_diego")
        .values(
            payee=payee,
            rate_type=rate_type,
            rate_bps=round(rate * 100) if rate_type == "percent" else None,
            rate_cents=None if rate_type == "percent" else round(rate * 100),
        )
    )
    await db.flush()


async def _diego_visit(
    db: AsyncSession,
    *,
    rate_type: str = "percent",
    rate: float = 60.0,
    payee: bool = True,
    end_hour: int = 16,
    end_min: int = 0,
) -> Booking:
    await _diego_pay(db, rate_type=rate_type, rate=rate, payee=payee)
    cid = await _seed_id(db, Client)
    sess = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=await _seed_id(db, Item),
        staff_id="st_diego",
        starts_at=datetime(2030, 1, 1, 15, tzinfo=UTC),
        ends_at=datetime(2030, 1, 1, end_hour, end_min, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=sess.id,
        starts_at=sess.starts_at,
        staff_id="st_diego",
        client_id=cid,
        status="confirmed",
        source="manual",
        price_cents=10000,
    )
    db.add(booking)
    await db.flush()
    return booking


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
    booking = await _diego_visit(
        db, rate_type=rate_type, rate=rate, payee=payee, end_hour=end_hour, end_min=end_min
    )
    cid = booking.client_id
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
            invoice_id=inv.id,
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
    payment_id = await card_pay(as_owner, db, inv.id)
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    event = json.dumps(
        {
            "id": f"evt_{booking.id}",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi}},
        }
    )
    await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)
    return booking.id, inv.id, payment_id


async def _journals(db: AsyncSession, booking_id: str) -> list[str]:
    rows = await db.execute(
        select(Entry.journal_id)
        .where(Entry.event == "earning", Entry.subject_id == booking_id)
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


async def _earning(db: AsyncSession, *, business_id: str = BIZ, staff_id: str = "st_diego") -> str:
    journal = await ledger.post(
        db,
        business_id,
        event="earning",
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
        db, BIZ, owner_type="staff", owner_id=staff_id, category="payable", code=stage
    )


async def test_percent_payee_accrues_on_paid_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, _ = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None
    assert earning.staff_id == "st_diego" and earning.subject == ("booking", booking_id)
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


async def _visit_sale(api: httpx.AsyncClient, db: AsyncSession, booking: Booking) -> str:
    line = {"description": "Visit", "unit_amount_cents": 10000, "booking_id": booking.id}
    created = await api.post("/v1/orders", json={"client_id": booking.client_id, "lines": [line]})
    assert created.status_code == 201, created.text
    sale: str = created.json()["id"]
    return sale


async def test_visit_paid_at_the_register_accrues_service_commission(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _diego_visit(db)
    sale = await _visit_sale(as_owner, db, booking)
    paid = await as_owner.post(
        f"/v1/orders/{sale}/cash", json={"tendered_cents": 20000}, headers=retry_key()
    )
    assert paid.status_code == 200, paid.text
    [journal] = await _journals(db, booking.id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None
    assert (earning.staff_id, earning.amount_cents, earning.status) == ("st_diego", 6000, "pending")


async def test_refunded_register_sale_reverses_the_service_commission(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _diego_visit(db, rate_type="fixed", rate=15.0)
    before = await _payable(db, "st_diego", "pending")
    sale = await _visit_sale(as_owner, db, booking)
    pay = await as_owner.post(f"/v1/orders/{sale}/pay", json={})
    assert pay.status_code == 200, pay.text
    await settle(as_owner, db, pay.json()["payment_id"])
    assert len(await _journals(db, booking.id)) == 1
    refunded = await as_owner.post(
        f"/v1/payments/{pay.json()['payment_id']}/refund", json={}, headers=retry_key()
    )
    assert refunded.status_code == 200, refunded.text
    assert await _payable(db, "st_diego", "pending") == before


async def _kind_item(db: AsyncSession, kind: str) -> str:
    item = (
        await db.execute(select(Item.id).where(Item.business_id == BIZ, Item.kind == kind).limit(1))
    ).scalar_one()
    return item


async def _paid_loose_invoice(
    as_owner: httpx.AsyncClient, db: AsyncSession, lines: list[dict[str, object]]
) -> tuple[str, str]:
    """Pay + settle an invoice of lines without a booking; return (invoice_id, payment_id)."""
    total = sum(int(str(line["amount_cents"])) for line in lines)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _seed_id(db, Client),
        number=next(_NUMBERS),
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
    )
    db.add(inv)
    await db.flush()
    for position, line in enumerate(lines):
        db.add(
            Line(
                id=new_id("line"),
                business_id=BIZ,
                invoice_id=inv.id,
                quantity=1,
                unit_amount_cents=line["amount_cents"],
                position=position,
                **line,
            )
        )
    await db.flush()
    await book_invoice(db, inv)
    payment_id = await card_pay(as_owner, db, inv.id)
    await settle(as_owner, db, payment_id)
    return inv.id, payment_id


async def _line_journals(db: AsyncSession, subject_id: str) -> list[tuple[str, int, str]]:
    """(staff, amount, basis) of each accrual on a document, oldest first."""
    rows = await db.execute(
        select(Entry.owner_id, Entry.amount_cents, Entry.meta)
        .where(
            Entry.event == "earning",
            Entry.subject_id == subject_id,
            Entry.owner_type == "staff",
            Entry.ref.startswith("earning:line:"),
        )
        .order_by(Entry.journal_id)
    )
    return [
        (str(staff), -int(cents), str((meta or {}).get("basis")))
        for staff, cents, meta in rows.tuples().all()
    ]


async def test_invoice_lines_without_a_booking_earn_by_kind(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _diego_pay(db)
    await db.execute(update(Staff).where(Staff.id == "st_diego").values(retail_rate_bps=1000))
    inv_id, _ = await _paid_loose_invoice(
        as_owner,
        db,
        [
            {"description": "Nail trim", "amount_cents": 2000, "staff_id": "st_diego"},
            {
                "description": "Shampoo",
                "amount_cents": 3000,
                "staff_id": "st_diego",
                "item_id": await _kind_item(db, "product"),
            },
            {
                "description": "Gift card",
                "amount_cents": 5000,
                "staff_id": "st_diego",
                "item_id": await _kind_item(db, "gift"),
            },
            {"description": "Unassigned", "amount_cents": 4000},
        ],
    )
    assert await _line_journals(db, inv_id) == [
        ("st_diego", 1200, "percent"),
        ("st_diego", 300, "retail"),
    ]
    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None
    await ensure_earnings(db, invoice)
    assert len(await _line_journals(db, inv_id)) == 2


async def test_a_fixed_rate_earns_per_catalog_service_and_hourly_earns_nothing_without_a_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    line: dict[str, object] = {
        "description": "Nail trim",
        "amount_cents": 2000,
        "staff_id": "st_diego",
    }
    service = {**line, "item_id": await _kind_item(db, "service")}
    fee = {**line, "description": "Travel fee", "amount_cents": 300}
    await _diego_pay(db, rate_type="fixed", rate=15.0)
    fixed_id, _ = await _paid_loose_invoice(as_owner, db, [service, dict(service), fee])
    assert [cents for _, cents, _ in await _line_journals(db, fixed_id)] == [1500, 1500]
    await _diego_pay(db, rate_type="hourly", rate=30.0)
    hourly_id, _ = await _paid_loose_invoice(as_owner, db, [dict(line)])
    assert await _line_journals(db, hourly_id) == []


async def test_a_refund_reverses_and_claws_back_line_earnings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _diego_pay(db)
    pending = await _payable(db, "st_diego", "pending")
    inv_id, payment_id = await _paid_loose_invoice(
        as_owner, db, [{"description": "Nail trim", "amount_cents": 2000, "staff_id": "st_diego"}]
    )
    assert await _payable(db, "st_diego", "pending") == pending - 1200
    await _refund(as_owner, payment_id, 1000)
    assert await _payable(db, "st_diego", "pending") == pending - 600
    await _refund(as_owner, payment_id)
    assert await _payable(db, "st_diego", "pending") == pending
    journals = await db.execute(
        select(Entry.journal_id)
        .where(Entry.subject_id == inv_id, Entry.ref.startswith("earning:line:"))
        .distinct()
    )
    [journal] = journals.scalars().all()
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "reversed"


async def test_a_walk_in_service_at_the_register_earns_its_seller(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _diego_pay(db)
    created = await as_owner.post(
        "/v1/orders", json={"lines": [{"description": "Nail trim", "unit_amount_cents": 2000}]}
    )
    assert created.status_code == 201, created.text
    sale = created.json()["id"]
    await db.execute(update(Order).where(Order.id == sale).values(staff_id="st_diego"))
    paid = await as_owner.post(
        f"/v1/orders/{sale}/cash", json={"tendered_cents": 5000}, headers=retry_key()
    )
    assert paid.status_code == 200, paid.text
    assert await _line_journals(db, sale) == [("st_diego", 1200, "percent")]


async def test_a_non_payee_earns_nothing_on_a_loose_line(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _diego_pay(db, payee=False)
    inv_id, _ = await _paid_loose_invoice(
        as_owner, db, [{"description": "Nail trim", "amount_cents": 2000, "staff_id": "st_diego"}]
    )
    assert await _line_journals(db, inv_id) == []


async def _covered_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession, *, paid: int, crew: bool = False
) -> str:
    """A started visit of Diego's covered by a five-session package bought for `paid`."""
    booking = await _diego_visit(db)
    start = datetime(2026, 10, 13, 15, tzinfo=UTC)
    await db.execute(
        update(Slot)
        .where(Slot.id == booking.slot_id)
        .values(starts_at=start, ends_at=start.replace(hour=16))
    )
    await db.execute(update(Booking).where(Booking.id == booking.id).values(starts_at=start))
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert slot is not None
    await db.execute(update(Item).where(Item.id == "it_pkg5").values(covers_item_id=slot.item_id))
    plan = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=booking.client_id,
        item_id="it_pkg5",
        sessions_total=5,
        status="active",
    )
    db.add(plan)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        event="payment",
        ref=f"payment:{plan.id}",
        legs=[Leg("business", BIZ, "stripe", paid), Leg("package", plan.id, "deferred", -paid)],
        subject=("package", plan.id),
    )
    if crew:
        await db.execute(
            update(Staff)
            .where(Staff.id == "st_priya")
            .values(payee=True, rate_type="fixed", rate_bps=None, rate_cents=700)
        )
        db.add(
            Hours(
                id=new_id("hours"),
                business_id=BIZ,
                staff_id="st_priya",
                basis="exception",
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
                available=False,
                note=crew_note(booking.id),
            )
        )
        await db.flush()
    res = await as_owner.post(
        f"/v1/packages/{plan.id}/cover", json={"booking_id": booking.id}, headers=retry_key()
    )
    assert res.status_code == 200, res.text
    return booking.id


async def test_a_package_covered_visit_earns_on_the_session_share(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _covered_visit(as_owner, db, paid=20000)
    [journal] = await _journals(db, booking_id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None
    assert (earning.staff_id, earning.amount_cents, earning.status) == ("st_diego", 2400, "pending")


async def test_a_package_covered_visit_splits_between_its_crew(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _covered_visit(as_owner, db, paid=20000, crew=True)
    amounts: dict[str, int] = {}
    for journal in await _journals(db, booking_id):
        earning = await load_earning(db, BIZ, journal)
        assert earning is not None
        amounts[earning.staff_id] = earning.amount_cents
    assert amounts == {"st_diego": 1200, "st_priya": 700}


async def test_approve_then_pay_moves_payable_to_bank(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    biz = await db.get(Business, BIZ)
    assert biz is not None
    staff = await factory.staff(business=biz, role="staff")
    journal = await _earning(db, staff_id=staff.id)
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")

    approved = await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})
    assert approved.status_code == 200, approved.text
    [earning] = approved.json()["earnings"]
    assert earning == {
        "id": journal,
        "staff_id": staff.id,
        "subject_type": earning["subject_type"],
        "subject_id": earning["subject_id"],
        "basis": earning["basis"],
        "amount_cents": 6000,
        "status": "approved",
        "kind": "earning",
    }
    assert await _payable(db, staff.id, "pending") == 0
    assert await _payable(db, staff.id, "approved") == -6000

    paid = await as_owner.post("/v1/earnings/pay", json={"ids": [journal]})
    assert paid.status_code == 200, paid.text
    assert paid.json()["earnings"][0]["status"] == "paid"
    assert await _payable(db, staff.id, "approved") == 0
    assert (
        await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")
        == bank - 6000
    )


async def test_refund_reverses_pending_earning(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pending = await _payable(db, "st_diego", "pending")
    booking_id, inv_id, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    assert await _payable(db, "st_diego", "pending") == pending - 6000
    assert (
        await as_owner.post(f"/v1/payments/{payment_id}/refund", json={}, headers=retry_key())
    ).status_code == 200
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "reversed"
    assert await _payable(db, "st_diego", "pending") == pending

    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None
    assert (await ledger.invoice_state(db, invoice))[0] == "refunded"
    await ensure_earnings(db, invoice)  # a reversed earning can accrue again, on a fresh journal
    journals = await _journals(db, booking_id)
    assert len(journals) == 2 and journals[0] == journal
    again = await load_earning(db, BIZ, journals[1])
    assert again is not None and again.status == "pending" and again.amount_cents == 6000


async def _held(db: AsyncSession, journal: str) -> int:
    """What clawbacks hold back from one earning, after any were reversed."""
    rows = await db.execute(
        select(Entry.journal_id, Entry.amount_cents)
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.ref.startswith(f"earning:{journal}:clawback:"),
            Account.category == "payable",
        )
    )
    total = 0
    for clawback, cents in rows.tuples().all():
        earning = await load_earning(db, BIZ, clawback)
        assert earning is not None
        total += 0 if earning.status == "reversed" else cents
    return total


async def _refund(as_owner: httpx.AsyncClient, payment_id: str, cents: int | None = None) -> str:
    body = {} if cents is None else {"amount_cents": cents}
    res = await as_owner.post(f"/v1/payments/{payment_id}/refund", json=body, headers=retry_key())
    assert res.status_code == 200, res.text
    return str(res.json()["refund_id"])


async def test_refund_claws_back_an_approved_earning(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 200
    pending = await _payable(db, "st_diego", "pending")
    await _refund(as_owner, payment_id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "approved"
    assert await _held(db, journal) == 6000
    assert await _payable(db, "st_diego", "pending") == pending + 6000


async def test_partial_refund_claws_back_its_share_then_the_rest(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pending = await _payable(db, "st_diego", "pending")
    booking_id, inv_id, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    await _refund(as_owner, payment_id, 2500)
    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None and (await ledger.invoice_state(db, invoice))[0] == "paid"
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "pending"
    assert await _held(db, journal) == 1500
    assert await _payable(db, "st_diego", "pending") == pending - 4500

    await _refund(as_owner, payment_id)
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "reversed"
    assert await _held(db, journal) == 0
    assert await _payable(db, "st_diego", "pending") == pending


async def test_resyncing_a_refunded_invoice_claws_back_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, inv_id, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    await _refund(as_owner, payment_id, 5000)
    await sync_invoice(db, inv_id)
    await sync_invoice(db, inv_id)
    clawbacks = await db.execute(
        select(Entry.journal_id)
        .where(Entry.ref.startswith(f"earning:{journal}:clawback:"))
        .distinct()
    )
    assert len(clawbacks.scalars().all()) == 1
    assert await _held(db, journal) == 3000


async def test_a_failed_refund_returns_what_it_clawed_back(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": [journal]})).status_code == 200
    refund_id = await _refund(as_owner, payment_id, 5000)
    assert await _held(db, journal) == 3000
    refund = await db.get(Payment, refund_id)
    original = await db.get(Payment, payment_id)
    assert refund is not None and original is not None
    event = {
        "id": f"evt_{refund_id}_failed",
        "type": "refund.updated",
        "account": "acct_earn",
        "data": {
            "object": {
                "id": refund.provider_ref,
                "payment_intent": original.provider_ref,
                "amount": 5000,
                "status": "failed",
            }
        },
    }
    res = await as_owner.post("/webhooks/stripe", content=json.dumps(event), headers=GOOD)
    assert res.status_code == 200, res.text
    assert await _held(db, journal) == 0
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
    bank = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="bank")
    stripe = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
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
            select(Account.category, Entry.amount_cents, Entry.business_id)
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.ref.in_(("payout:po_1", "payout:po_1:paid")))
        )
    ).all()
    assert sorted((kind, cents, biz) for kind, cents, biz in legs) == [
        ("bank", 50000, BIZ),
        ("stripe", -50000, BIZ),
        ("transit", -50000, BIZ),
        ("transit", 50000, BIZ),
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


async def test_a_payout_canceled_before_it_was_recorded_nets_to_nothing(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_po"))
    await db.flush()
    bank, stripe = await _balances(db)
    canceled = await api.post(
        "/webhooks/stripe",
        content=_payout_event("evt_po_cancel", "payout.canceled", "po_2", 20000),
        headers=GOOD,
    )
    assert canceled.status_code == 200
    assert await _balances(db) == (bank, stripe)
    assert await ledger.journal_for(db, BIZ, "payout:po_2") is not None
    assert await ledger.journal_for(db, BIZ, "payout:po_2:failed") is not None


async def _two_member_invoice(db: AsyncSession) -> tuple[Booking, Invoice]:
    """Diego's visit billed as his $100 line and a $40 line Priya did on the same visit."""
    booking = await _diego_visit(db)
    await db.execute(
        update(Staff)
        .where(Staff.id == "st_priya")
        .values(payee=True, rate_type="percent", rate_bps=5000, rate_cents=None)
    )
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=booking.client_id,
        number=next(_NUMBERS),
        status="sent",
        currency="CAD",
        subtotal_cents=14000,
        tax_total_cents=0,
        total_cents=14000,
    )
    db.add(inv)
    await db.flush()
    for position, (cents, staff_id) in enumerate(((10000, None), (4000, "st_priya"))):
        db.add(
            Line(
                id=new_id("line"),
                business_id=BIZ,
                invoice_id=inv.id,
                description="Service",
                booking_id=booking.id,
                staff_id=staff_id,
                quantity=1,
                unit_amount_cents=cents,
                amount_cents=cents,
                position=position,
            )
        )
    await db.flush()
    return booking, inv


async def _earned(db: AsyncSession, booking_id: str) -> dict[str, tuple[int, str]]:
    out: dict[str, tuple[int, str]] = {}
    for journal in await _journals(db, booking_id):
        earning = await load_earning(db, BIZ, journal)
        assert earning is not None
        out[earning.staff_id] = (earning.amount_cents, earning.status)
    return out


async def test_each_member_on_a_visit_earns_from_their_own_lines(db: AsyncSession) -> None:
    booking, inv = await _two_member_invoice(db)
    await ensure_earnings(db, inv)
    await ensure_earnings(db, inv)
    assert await _earned(db, booking.id) == {
        "st_diego": (6000, "pending"),
        "st_priya": (2000, "pending"),
    }
    refs = await db.execute(
        select(Entry.ref).where(Entry.subject_id == booking.id, Entry.owner_type == "staff")
    )
    assert sorted(refs.scalars()) == [
        f"earning:{booking.id}:st_diego:0",
        f"earning:{booking.id}:st_priya:0",
    ]
    await reverse_earnings(db, inv)
    assert await _earned(db, booking.id) == {
        "st_diego": (6000, "reversed"),
        "st_priya": (2000, "reversed"),
    }
    await ensure_earnings(db, inv)
    assert len(await _journals(db, booking.id)) == 4


async def test_an_earning_posted_under_the_old_ref_still_counts(db: AsyncSession) -> None:
    booking, inv = await _two_member_invoice(db)
    await ledger.post(
        db,
        BIZ,
        event="earning",
        ref=f"earning:{booking.id}:0",
        legs=[
            Leg("business", BIZ, "staff_cost", 6000),
            Leg("staff", "st_diego", "payable", -6000, "pending"),
        ],
        subject=("booking", booking.id),
    )
    await ensure_earnings(db, inv)
    assert await _earned(db, booking.id) == {
        "st_diego": (6000, "pending"),
        "st_priya": (2000, "pending"),
    }
    assert len(await _journals(db, booking.id)) == 2


async def _sale_rows(db: AsyncSession, sale: str) -> list[tuple[str, int, str]]:
    """(ref, cents, status) of each earning on a sale, oldest first."""
    rows = await db.execute(
        select(Entry.journal_id, Entry.ref, Entry.amount_cents)
        .where(Entry.subject_id == sale, Entry.owner_type == "staff", Entry.event == "earning")
        .order_by(Entry.journal_id)
    )
    found: list[tuple[str, int, str]] = []
    for journal, ref, cents in rows.tuples().all():
        earning = await load_earning(db, BIZ, journal)
        assert earning is not None
        found.append((ref.split(":")[1], -cents, earning.status))
    return found


async def test_a_mixed_sale_pays_its_retail_commission_once_after_a_failed_refund(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _diego_pay(db)
    await db.execute(update(Staff).where(Staff.id == "st_diego").values(retail_rate_bps=1000))
    product = await _kind_item(db, "product")
    created = await as_owner.post(
        "/v1/orders",
        json={
            "lines": [
                {"description": "Shampoo", "unit_amount_cents": 3000, "item_id": product},
                {"description": "Nail trim", "unit_amount_cents": 2000},
            ]
        },
    )
    assert created.status_code == 201, created.text
    sale = created.json()["id"]
    await db.execute(update(Order).where(Order.id == sale).values(staff_id="st_diego"))
    paid = await as_owner.post(
        f"/v1/orders/{sale}/cash", json={"tendered_cents": 9000}, headers=retry_key()
    )
    assert paid.status_code == 200, paid.text
    assert sorted((k, c) for k, c, _ in await _sale_rows(db, sale)) == [
        ("line", 1200),
        ("order", 300),
    ]
    pay_id = (
        await db.execute(
            select(Payment.id).where(Payment.order_id == sale, Payment.kind != "refund")
        )
    ).scalar_one()
    refund_id = await _refund(as_owner, pay_id)
    assert {status for _, _, status in await _sale_rows(db, sale)} == {"reversed"}

    refund = await db.get(Payment, refund_id)
    original = await db.get(Payment, pay_id)
    assert refund is not None and original is not None
    await ledger.reverse_refund(db, refund, original)
    refund.status = "failed"
    await db.flush()
    await sync_order(db, sale)
    await sync_order(db, sale)
    live = [(k, c) for k, c, status in await _sale_rows(db, sale) if status != "reversed"]
    assert sorted(live) == [("line", 1200), ("order", 300)]


async def test_settled_clawbacks_stop_posting_once_the_earning_is_reversed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, inv_id, payment_id = await _paid_booking(as_owner, db)
    [journal] = await _journals(db, booking_id)
    await _refund(as_owner, payment_id, 2500)
    clawbacks = [j for j in await _journals(db, booking_id) if j != journal]
    assert (await as_owner.post("/v1/earnings/approve", json={"ids": clawbacks})).status_code == 200
    await _refund(as_owner, payment_id)

    async def refs() -> list[str]:
        rows = await db.execute(
            select(Entry.ref).where(Entry.ref.startswith(f"earning:{journal}:clawback:")).distinct()
        )
        return sorted(rows.scalars().all())

    settled = await refs()
    for _ in range(3):
        await sync_invoice(db, inv_id)
    assert await refs() == settled
    assert await _held(db, journal) == 0  # the earning is reversed, so nothing is held back


async def test_a_refunded_package_claws_back_its_covered_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _covered_visit(as_owner, db, paid=20000)
    [journal] = await _journals(db, booking_id)
    booking = await db.get(Booking, booking_id, populate_existing=True)
    assert booking is not None and booking.package_id is not None
    plan = await db.get(Package, booking.package_id)
    assert plan is not None
    await ledger.post(
        db,
        BIZ,
        event="refund",
        ref=f"refund:{plan.id}",
        legs=[Leg("package", plan.id, "deferred", 10000), Leg("business", BIZ, "stripe", -10000)],
        subject=("package", plan.id),
    )
    await claw_back_package(db, plan)
    await claw_back_package(db, plan)
    assert await _held(db, journal) == 1200
    earning = await load_earning(db, BIZ, journal)
    assert earning is not None and earning.status == "pending"


async def test_an_expired_package_claws_back_only_what_was_refunded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id = await _covered_visit(as_owner, db, paid=20000)
    [journal] = await _journals(db, booking_id)
    booking = await db.get(Booking, booking_id, populate_existing=True)
    assert booking is not None and booking.package_id is not None
    plan = await db.get(Package, booking.package_id)
    assert plan is not None
    await ledger.post_breakage(db, BIZ, owner_type="package", owner_id=plan.id, category="deferred")
    await ledger.post(
        db,
        BIZ,
        event="refund",
        ref=f"refund:{plan.id}",
        legs=[Leg("package", plan.id, "deferred", 10000), Leg("business", BIZ, "stripe", -10000)],
        subject=("package", plan.id),
    )
    await claw_back_package(db, plan)
    assert await _held(db, journal) == 1200


async def test_a_booked_add_on_product_earns_retail_not_the_service_rate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, inv_id, _ = await _paid_booking(as_owner, db)
    await db.execute(update(Staff).where(Staff.id == "st_diego").values(retail_rate_bps=1000))
    product = await _kind_item(db, "product")
    invoice = await db.get(Invoice, inv_id)
    assert invoice is not None
    db.add(
        Line(
            id=new_id("line"),
            business_id=BIZ,
            invoice_id=inv_id,
            description="Shampoo",
            item_id=product,
            booking_id=booking_id,
            quantity=1,
            unit_amount_cents=2000,
            amount_cents=2000,
            position=1,
        )
    )
    await db.flush()
    await reverse_earnings(db, invoice)
    await ensure_earnings(db, invoice)
    amounts: list[int] = []
    for journal in await _journals(db, booking_id):
        earning = await load_earning(db, BIZ, journal)
        if earning is not None and earning.status != "reversed":
            amounts.append(earning.amount_cents)
    assert amounts == [6000]  # 60% of the $100 service only
    assert await _line_journals(db, inv_id) == [("st_diego", 200, "retail")]


async def test_an_accrual_carries_what_a_member_needs_to_read_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking_id, _, _ = await _paid_booking(as_owner, db)
    booking = await db.get(Booking, booking_id)
    assert booking is not None
    meta = (
        await db.execute(
            select(Entry.meta).where(
                Entry.subject_id == booking_id,
                Entry.event == "earning",
                Entry.owner_type == "staff",
            )
        )
    ).scalar_one()
    assert meta == {
        "basis": "percent",
        "rate": 6000,
        "base": 10000,
        "label": "Service",
        "client_id": booking.client_id,
        "worked_at": booking.starts_at.isoformat(),
    }
