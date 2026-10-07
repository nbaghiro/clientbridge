from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Staff
from clientbridge.models.catalog import Item
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.earnings import EarningOut, EarningsOut
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg


@dataclass(frozen=True)
class Earning:
    id: str
    business_id: str
    staff_id: str
    subject_type: str | None  # booking (service work) or order (retail commission)
    subject_id: str | None
    amount_cents: int
    status: str
    kind: str = "earning"  # earning (work, commission) or tip

    @property
    def booking_id(self) -> str | None:
        return self.subject_id if self.subject_type == "booking" else None

    @property
    def subject(self) -> tuple[str, str] | None:
        if self.subject_type is None or self.subject_id is None:
            return None
        return (self.subject_type, self.subject_id)

    def out(self) -> EarningOut:
        return EarningOut(
            id=self.id,
            staff_id=self.staff_id,
            booking_id=self.booking_id,
            order_id=self.subject_id if self.subject_type == "order" else None,
            amount_cents=self.amount_cents,
            status=self.status,
            kind=self.kind,
        )


class EarningService:
    """Staff earnings on the ledger: accrued when an invoice is paid, then approved, then paid."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def approve_many(
        self, earning_ids: list[str], idempotency_key: str | None = None
    ) -> EarningsOut:
        return await self._advance_many(
            earning_ids, "pending", "approved", "earning.approve_many", idempotency_key
        )

    async def pay_many(
        self, earning_ids: list[str], idempotency_key: str | None = None
    ) -> EarningsOut:
        return await self._advance_many(
            earning_ids, "approved", "paid", "earning.pay_many", idempotency_key
        )

    async def _advance_many(
        self,
        earning_ids: list[str],
        current: str,
        target: str,
        action: str,
        idempotency_key: str | None,
    ) -> EarningsOut:
        """Advance several earnings in one command: all of them, or none if any is not ready."""
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage earnings"
        )
        ids = list(dict.fromkeys(earning_ids))
        for earning_id in ids:
            if await load_earning(self.db, self.biz, earning_id) is None:
                raise NotFound("earning not found")

        async def run(cmd: Command) -> EarningsOut:
            done: list[EarningOut] = []
            for earning_id in ids:
                earning = await load_earning(self.db, self.biz, earning_id)
                assert earning is not None
                await _lock_subject(self.db, earning.subject)
                fresh = await load_earning(self.db, self.biz, earning_id)
                if fresh is None or fresh.status != current:
                    raise Conflict(f"only a {current} earning can be marked {target}")
                await advance_earning(self.db, fresh, target)
                cmd.record(action, entity_type="earning", entity_id=earning_id)
                moved = await load_earning(self.db, self.biz, earning_id)
                assert moved is not None
                done.append(moved.out())
            return EarningsOut(earnings=done)

        return await run_command(
            self.db,
            self.principal,
            action=action,
            run=run,
            response_model=EarningsOut,
            idempotency_key=idempotency_key,
        )


async def _lock_booking(db: AsyncSession, booking_id: str | None) -> None:
    """Serializes approve/pay against an automatic reversal of the same booking's earnings."""
    if booking_id is not None:
        await db.execute(select(Booking.id).where(Booking.id == booking_id).with_for_update())


async def _lock_subject(db: AsyncSession, subject: tuple[str, str] | None) -> None:
    if subject is None:
        return
    kind, subject_id = subject
    if kind == "booking":
        await _lock_booking(db, subject_id)
    elif kind == "order":
        await db.execute(select(Order.id).where(Order.id == subject_id).with_for_update())


async def advance_earning(db: AsyncSession, earning: Earning, target: str) -> None:
    """Approve (pending → approved payable) or pay (approved payable → bank) one earning."""
    current = "pending" if target == "approved" else "approved"
    entry_type = "approval" if target == "approved" else "staff_payment"
    to = (
        Leg("staff", earning.staff_id, "payable", -earning.amount_cents, "approved")
        if target == "approved"
        else Leg("business", earning.business_id, "bank", -earning.amount_cents)
    )
    await ledger.post(
        db,
        earning.business_id,
        event=entry_type,
        ref=f"{entry_type}:{earning.id}",
        legs=[Leg("staff", earning.staff_id, "payable", earning.amount_cents, current), to],
        source=("journal", earning.id),
        subject=earning.subject,
    )


async def load_earning(db: AsyncSession, business_id: str, journal_id: str) -> Earning | None:
    rows = await db.execute(
        scoped(Entry, business_id)
        .add_columns(Account)
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.journal_id == journal_id,
            Entry.event.in_(("earning", "tip")),
            Account.category == "payable",
        )
    )
    row = rows.tuples().first()
    if row is None:
        return None
    entry, account = row
    return Earning(
        id=journal_id,
        business_id=business_id,
        staff_id=account.owner_id,
        subject_type=entry.subject_type,
        subject_id=entry.subject_id,
        amount_cents=-entry.amount_cents,
        status=await _status(db, business_id, journal_id),
        kind=entry.event,
    )


async def _status(db: AsyncSession, business_id: str, journal_id: str) -> str:
    for ref, status in (
        (f"earning:{journal_id}:reversal", "reversed"),
        (f"staff_payment:{journal_id}", "paid"),
        (f"approval:{journal_id}", "approved"),
    ):
        if await ledger.journal_for(db, business_id, ref) is not None:
            return status
    return "pending"


async def _booking_earnings(db: AsyncSession, business_id: str, booking_id: str) -> list[str]:
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.subject_type == "booking",
            Entry.subject_id == booking_id,
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


async def _split(
    db: AsyncSession, staff: Staff, line_cents: int, booking: Booking
) -> tuple[str, int] | None:
    """The (basis, cents) a payee earns on a booking line under their rate type."""
    if staff.rate_type == "percent" and staff.rate_bps is not None:
        return "percent", round(line_cents * staff.rate_bps / 10000)
    rate = staff.rate_cents
    if rate is None:
        return None
    if staff.rate_type == "fixed":
        return "fixed", rate
    if staff.rate_type == "hourly":
        slot = await db.get(Slot, booking.slot_id)
        if slot is None:
            return None
        hours = (slot.ends_at - slot.starts_at).total_seconds() / 3600
        return "rate", round(rate * hours)
    return None


async def _booking_lines(db: AsyncSession, invoice: Invoice) -> list[Line]:
    rows = await db.execute(
        scoped(Line, invoice.business_id).where(
            Line.invoice_id == invoice.id,
            Line.booking_id.isnot(None),
        )
    )
    return list(rows.scalars().all())


async def ensure_earnings(db: AsyncSession, invoice: Invoice) -> None:
    """Accrue a pending earning per payee on a fully paid invoice's bookings, once each."""
    biz = invoice.business_id
    for line in await _booking_lines(db, invoice):
        assert line.booking_id is not None
        journals = await _booking_earnings(db, biz, line.booking_id)
        if journals and await _status(db, biz, journals[-1]) != "reversed":
            continue
        booking = await db.get(Booking, line.booking_id)
        if booking is None or booking.staff_id is None:
            continue
        staff = await db.get(Staff, booking.staff_id)
        if staff is None or not staff.payee:
            continue
        split = await _split(db, staff, line.amount_cents, booking)
        if split is None or split[1] <= 0:
            continue
        basis, amount = split
        await ledger.post(
            db,
            biz,
            event="earning",
            ref=f"earning:{booking.id}:{len(journals)}",
            legs=[
                Leg("business", biz, "staff_cost", amount),
                Leg("staff", staff.id, "payable", -amount, "pending"),
            ],
            source=("line", line.id),
            subject=("booking", booking.id),
            meta={"basis": basis, "rate": staff.rate_bps or staff.rate_cents},
        )


async def reverse_earnings(db: AsyncSession, invoice: Invoice) -> None:
    """Unwind pending earnings when an invoice drops below fully paid; approved ones stand."""
    biz = invoice.business_id
    for line in await _booking_lines(db, invoice):
        assert line.booking_id is not None
        await _lock_booking(db, line.booking_id)
        journals = await _booking_earnings(db, biz, line.booking_id)
        if journals and await _status(db, biz, journals[-1]) == "pending":
            await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")


async def ensure_order_earning(db: AsyncSession, order: Order) -> None:
    """Accrue the seller's retail commission on a paid sale's product lines, once per sale."""
    staff = await db.get(Staff, order.staff_id)
    if staff is None or not staff.payee or not staff.retail_rate_bps:
        return
    biz = order.business_id
    await _lock_subject(db, ("order", order.id))
    journals = await _order_earnings(db, biz, order.id)
    if journals and await _status(db, biz, journals[-1]) != "reversed":
        return
    products = await db.execute(
        scoped(Line, biz)
        .with_only_columns(Line.amount_cents)
        .join(Item, Item.id == Line.item_id)
        .where(Line.order_id == order.id, Item.kind == "product")
    )
    base = sum(products.scalars().all())
    amount = base * staff.retail_rate_bps // 10000
    if amount <= 0:
        return
    await ledger.post(
        db,
        biz,
        event="earning",
        ref=f"earning:order:{order.id}:{len(journals)}",
        legs=[
            Leg("business", biz, "staff_cost", amount),
            Leg("staff", staff.id, "payable", -amount, "pending"),
        ],
        source=("order", order.id),
        subject=("order", order.id),
        meta={"basis": "retail", "rate_bps": staff.retail_rate_bps},
    )


async def reverse_order_earning(db: AsyncSession, order: Order) -> None:
    """Unwind a still-pending retail commission when its sale is refunded."""
    biz = order.business_id
    await _lock_subject(db, ("order", order.id))
    journals = await _order_earnings(db, biz, order.id)
    if journals and await _status(db, biz, journals[-1]) == "pending":
        await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")


async def _order_earnings(db: AsyncSession, business_id: str, order_id: str) -> list[str]:
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning", Entry.subject_type == "order", Entry.subject_id == order_id
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())
