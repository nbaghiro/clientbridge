from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_delete
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.identity import Staff
from clientbridge.models.payments import PayoutAllocation
from clientbridge.models.scheduling import Booking, Session
from clientbridge.schemas.payouts import PayoutAllocationOut


class PayoutService:
    """Manual payout-allocation lifecycle: pending → approved → paid (no Stripe transfer)."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def approve_allocation(
        self, allocation_id: str, idempotency_key: str | None = None
    ) -> PayoutAllocationOut:
        self._assert_admin()
        alloc = await self._allocation(allocation_id)

        async def run(cmd: Command) -> PayoutAllocationOut:
            if alloc.status != "pending":
                raise Conflict("only a pending allocation can be approved")
            alloc.status = "approved"
            await self.db.flush()
            cmd.record("payout.approve", entity_type="payout_allocation", entity_id=alloc.id)
            return _out(alloc)

        return await run_command(
            self.db,
            self.principal,
            action="payout.approve",
            run=run,
            response_model=PayoutAllocationOut,
            idempotency_key=idempotency_key,
        )

    async def pay_allocation(
        self, allocation_id: str, idempotency_key: str | None = None
    ) -> PayoutAllocationOut:
        self._assert_admin()
        alloc = await self._allocation(allocation_id)

        async def run(cmd: Command) -> PayoutAllocationOut:
            if alloc.status != "approved":
                raise Conflict("only an approved allocation can be paid")
            alloc.status = "paid"
            await self.db.flush()
            cmd.record("payout.pay", entity_type="payout_allocation", entity_id=alloc.id)
            return _out(alloc)

        return await run_command(
            self.db,
            self.principal,
            action="payout.pay",
            run=run,
            response_model=PayoutAllocationOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage payouts"
        )

    async def _allocation(self, allocation_id: str) -> PayoutAllocation:
        row = (
            await self.db.execute(
                scoped(PayoutAllocation, self.biz).where(PayoutAllocation.id == allocation_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("payout allocation not found")
        return row


def _out(alloc: PayoutAllocation) -> PayoutAllocationOut:
    return PayoutAllocationOut(
        id=alloc.id, staff_id=alloc.staff_id, amount_cents=alloc.amount_cents, status=alloc.status
    )


async def _allocation_split(
    db: AsyncSession, staff: Staff, line_cents: int, booking: Booking
) -> tuple[str, int] | None:
    """The (basis, cents) a payee earns on a booking line, by rate type. `default_rate` is
    percentage-points for `percent` (a share of the line) and dollars otherwise: `fixed` = a flat
    amount per booking, `hourly` = rate * the session's hours."""
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


async def ensure_allocations(db: AsyncSession, invoice: Invoice) -> None:
    """On a fully-paid invoice, record a pending payout split for each payee staff on its booking
    lines (percent of the line). Idempotent — skips bookings already allocated."""
    lines = (
        (
            await db.execute(
                select(Line).where(
                    Line.parent_type == "invoice",
                    Line.parent_id == invoice.id,
                    Line.booking_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for line in lines:
        booking_id = line.booking_id
        if booking_id is None:
            continue
        seen = (
            (
                await db.execute(
                    select(PayoutAllocation.id)
                    .where(
                        PayoutAllocation.source_type == "booking",
                        PayoutAllocation.source_id == booking_id,
                    )
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if seen is not None:
            continue
        booking = await db.get(Booking, booking_id)
        if booking is None or booking.staff_id is None:
            continue
        staff = await db.get(Staff, booking.staff_id)
        if staff is None or not staff.is_payee or staff.default_rate is None:
            continue
        split = await _allocation_split(db, staff, line.amount_cents, booking)
        if split is None or split[1] <= 0:
            continue
        basis, amount = split
        db.add(
            PayoutAllocation(
                id=new_id("payout_allocation"),
                business_id=invoice.business_id,
                staff_id=staff.id,
                source_type="booking",
                source_id=booking_id,
                basis=basis,
                rate=staff.default_rate,
                amount_cents=amount,
                status="pending",
            )
        )
    await db.flush()


async def reverse_allocations(db: AsyncSession, invoice: Invoice) -> None:
    """When a refund drops an invoice below fully-paid, remove the pending (not-yet-paid-out) payout
    splits made for its bookings so staff aren't credited (nor T4A inflated) for refunded work.
    Allocations already on a payout are left alone (a paid-out clawback is out of scope)."""
    booking_ids = [
        b
        for b in (
            await db.execute(
                select(Line.booking_id).where(
                    Line.parent_type == "invoice",
                    Line.parent_id == invoice.id,
                    Line.booking_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
        if b is not None
    ]
    if not booking_ids:
        return
    await db.execute(
        scoped_delete(PayoutAllocation, invoice.business_id).where(
            PayoutAllocation.source_type == "booking",
            PayoutAllocation.source_id.in_(booking_ids),
            PayoutAllocation.status == "pending",
            PayoutAllocation.payout_id.is_(None),
        )
    )
    await db.flush()
