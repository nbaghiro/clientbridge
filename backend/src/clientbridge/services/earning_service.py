from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.identity import Staff
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.scheduling import Booking, Session
from clientbridge.schemas.earnings import EarningOut
from clientbridge.services import ledger_service as ledger
from clientbridge.services.ledger_service import Leg


@dataclass(frozen=True)
class Earning:
    id: str
    business_id: str
    staff_id: str
    booking_id: str | None
    amount_cents: int
    status: str

    def out(self) -> EarningOut:
        return EarningOut(
            id=self.id,
            staff_id=self.staff_id,
            booking_id=self.booking_id,
            amount_cents=self.amount_cents,
            status=self.status,
        )


class EarningService:
    """Staff earnings on the ledger: accrued when an invoice is paid, then approved, then paid."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def approve(self, earning_id: str, idempotency_key: str | None = None) -> EarningOut:
        return await self._advance(
            earning_id, "pending", "approved", "earning.approve", idempotency_key
        )

    async def pay(self, earning_id: str, idempotency_key: str | None = None) -> EarningOut:
        return await self._advance(earning_id, "approved", "paid", "earning.pay", idempotency_key)

    async def _advance(
        self,
        earning_id: str,
        current: str,
        target: str,
        action: str,
        idempotency_key: str | None,
    ) -> EarningOut:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage earnings"
        )
        earning = await load_earning(self.db, self.biz, earning_id)
        if earning is None:
            raise NotFound("earning not found")

        async def run(cmd: Command) -> EarningOut:
            await _lock_booking(self.db, earning.booking_id)
            fresh = await load_earning(self.db, self.biz, earning.id)
            if fresh is None or fresh.status != current:
                raise Conflict(f"only a {current} earning can be marked {target}")
            await advance_earning(self.db, earning, target)
            cmd.record(action, entity_type="earning", entity_id=earning.id)
            done = await load_earning(self.db, self.biz, earning.id)
            assert done is not None
            return done.out()

        return await run_command(
            self.db,
            self.principal,
            action=action,
            run=run,
            response_model=EarningOut,
            idempotency_key=idempotency_key,
        )


async def _lock_booking(db: AsyncSession, booking_id: str | None) -> None:
    """Serializes approve/pay against an automatic reversal of the same booking's earnings."""
    if booking_id is not None:
        await db.execute(select(Booking.id).where(Booking.id == booking_id).with_for_update())


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
        type=entry_type,
        ref=f"{entry_type}:{earning.id}",
        legs=[Leg("staff", earning.staff_id, "payable", earning.amount_cents, current), to],
        source=("journal", earning.id),
        subject=("booking", earning.booking_id) if earning.booking_id else None,
    )


async def load_earning(db: AsyncSession, business_id: str, journal_id: str) -> Earning | None:
    rows = await db.execute(
        scoped(Entry, business_id)
        .add_columns(Account)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.journal_id == journal_id, Entry.type == "earning", Account.kind == "payable")
    )
    row = rows.tuples().first()
    if row is None:
        return None
    entry, account = row
    return Earning(
        id=journal_id,
        business_id=business_id,
        staff_id=account.owner_id,
        booking_id=entry.subject_id,
        amount_cents=-entry.amount_cents,
        status=await _status(db, business_id, journal_id),
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
            Entry.type == "earning",
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
    """The (basis, cents) a payee earns on a booking line. `default_rate` is percentage points for
    `percent` and dollars otherwise: `fixed` per booking, `hourly` times the session's hours."""
    rate = staff.default_rate
    if rate is None:
        return None
    if staff.rate_type == "percent":
        return "percent", round(line_cents * rate / 100)
    if staff.rate_type == "fixed":
        return "fixed", round(rate * 100)
    if staff.rate_type == "hourly":
        session = await db.get(Session, booking.session_id)
        if session is None:
            return None
        hours = (session.ends_at - session.starts_at).total_seconds() / 3600
        return "rate", round(rate * hours * 100)
    return None


async def _booking_lines(db: AsyncSession, invoice: Invoice) -> list[Line]:
    rows = await db.execute(
        scoped(Line, invoice.business_id).where(
            Line.parent_type == "invoice",
            Line.parent_id == invoice.id,
            Line.booking_id.isnot(None),
        )
    )
    return list(rows.scalars().all())


async def ensure_earnings(db: AsyncSession, invoice: Invoice) -> None:
    """Accrue a pending earning for each payee staff on a fully-paid invoice's booking lines, once
    per booking (a booking whose earning was reversed by a refund can accrue again)."""
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
        if staff is None or not staff.is_payee:
            continue
        split = await _split(db, staff, line.amount_cents, booking)
        if split is None or split[1] <= 0:
            continue
        basis, amount = split
        await ledger.post(
            db,
            biz,
            type="earning",
            ref=f"earning:{booking.id}:{len(journals)}",
            legs=[
                Leg("business", biz, "staff_cost", amount),
                Leg("staff", staff.id, "payable", -amount, "pending"),
            ],
            source=("line", line.id),
            subject=("booking", booking.id),
            meta={"basis": basis, "rate": staff.default_rate},
        )


async def reverse_earnings(db: AsyncSession, invoice: Invoice) -> None:
    """Unwind still-pending earnings when an invoice drops below fully paid; approved or paid
    earnings stand (a clawback is a deliberate adjustment, not an automatic one)."""
    biz = invoice.business_id
    for line in await _booking_lines(db, invoice):
        assert line.booking_id is not None
        await _lock_booking(db, line.booking_id)
        journals = await _booking_earnings(db, biz, line.booking_id)
        if journals and await _status(db, biz, journals[-1]) == "pending":
            await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")
