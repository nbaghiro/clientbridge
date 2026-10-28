from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from sqlalchemy import ColumnElement, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Staff
from clientbridge.models.catalog import BOOKABLE_KINDS, ENTITLEMENT_KINDS, Item, Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.earnings import AdjustmentIn, EarningOut, EarningsOut
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.lines import allocate, crew_ids, worker_shares

Move = Literal["approve", "pay", "unapprove", "unpay"]
Stage = Literal["approval", "staff_payment"]
_FROM: dict[Move, tuple[str, ...]] = {
    "approve": ("pending",),
    "pay": ("pending", "approved"),
    "unapprove": ("approved",),
    "unpay": ("paid",),
}


@dataclass(frozen=True)
class Earning:
    id: str
    business_id: str
    staff_id: str
    subject_type: str | None
    subject_id: str | None
    amount_cents: int
    status: str
    kind: str = "earning"  # earning (work, commission, adjustment, clawback) or tip
    basis: str | None = None

    @property
    def subject(self) -> tuple[str, str] | None:
        if self.subject_type is None or self.subject_id is None:
            return None
        return (self.subject_type, self.subject_id)

    def out(self) -> EarningOut:
        return EarningOut(
            id=self.id,
            staff_id=self.staff_id,
            subject_type=self.subject_type,
            subject_id=self.subject_id,
            basis=self.basis,
            amount_cents=self.amount_cents,
            status=self.status,
            kind=self.kind,
        )


class EarningService:
    """Staff earnings on the ledger: accrued when a document is paid, then approved, then paid."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def approve_many(
        self, earning_ids: list[str], idempotency_key: str | None = None
    ) -> EarningsOut:
        return await self._move_many(earning_ids, "approve", idempotency_key)

    async def pay_many(
        self,
        earning_ids: list[str],
        through: date | None = None,
        idempotency_key: str | None = None,
    ) -> EarningsOut:
        return await self._move_many(earning_ids, "pay", idempotency_key, through)

    async def unapprove_many(
        self, earning_ids: list[str], idempotency_key: str | None = None
    ) -> EarningsOut:
        return await self._move_many(earning_ids, "unapprove", idempotency_key)

    async def unpay_many(
        self, earning_ids: list[str], idempotency_key: str | None = None
    ) -> EarningsOut:
        return await self._move_many(earning_ids, "unpay", idempotency_key)

    def _assert_manager(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage earnings"
        )

    def _assert_not_own(self, staff_ids: set[str]) -> None:
        if self.principal.role != "owner" and self.principal.staff_id in staff_ids:
            raise Forbidden("only the owner can manage an admin's own pay", code="own_pay")

    async def adjust(self, data: AdjustmentIn, idempotency_key: str) -> EarningOut:
        """A bonus or deduction for one member, approved and paid like any earning."""
        self._assert_manager()
        self._assert_not_own({data.staff_id})

        async def run(cmd: Command) -> EarningOut:
            staff = (
                await self.db.execute(
                    scoped(Staff, self.biz).where(Staff.id == data.staff_id).with_for_update()
                )
            ).scalar_one_or_none()
            if staff is None:
                raise NotFound("team member not found")
            journal = await post_adjustment(self.db, staff, data.amount_cents, data.reason)
            cmd.record(
                "earning.adjust",
                entity_type="earning",
                entity_id=journal,
                changes={"staff_id": staff.id, "amount_cents": data.amount_cents},
            )
            earning = await load_earning(self.db, self.biz, journal)
            assert earning is not None
            return earning.out()

        return await run_command(
            self.db,
            self.principal,
            action="earning.adjust",
            run=run,
            response_model=EarningOut,
            idempotency_key=idempotency_key,
            request=data.model_dump(),
        )

    async def _move_many(
        self,
        earning_ids: list[str],
        move: Move,
        idempotency_key: str | None,
        through: date | None = None,
    ) -> EarningsOut:
        """Move several earnings one stage at once: all of them, or none if any can't."""
        self._assert_manager()
        action = f"earning.{move}_many"
        ids = list(dict.fromkeys(earning_ids))
        staff_ids: set[str] = set()
        for earning_id in ids:
            earning = await load_earning(self.db, self.biz, earning_id)
            if earning is None:
                raise NotFound("earning not found")
            staff_ids.add(earning.staff_id)
        self._assert_not_own(staff_ids)

        async def run(cmd: Command) -> EarningsOut:
            await _lock_staff(self.db, self.biz, staff_ids)
            todo = ids
            if move == "pay":
                todo = ids + [
                    c
                    for c in await _clawbacks_due(self.db, self.biz, staff_ids, ids)
                    if c not in ids
                ]
            # a pay settles the clawbacks that travel with it and approves what it pays on the way
            subjects: set[tuple[str, str]] = set()
            for earning_id in todo:
                earning = await load_earning(self.db, self.biz, earning_id)
                assert earning is not None
                if earning.subject is not None:
                    subjects.add(earning.subject)
            # sorted, so two runs whose members share a visit never deadlock
            for subject in sorted(subjects):
                await _lock_subject(self.db, self.biz, subject)
            ready: list[Earning] = []
            for earning_id in todo:
                fresh = await load_earning(self.db, self.biz, earning_id)
                if fresh is None or fresh.status not in _FROM[move]:
                    raise Conflict(f"this earning can't be moved by {move}", code="earning_moved")
                ready.append(fresh)
            meta: dict[str, object] | None = None
            if move == "pay":
                totals: dict[str, int] = defaultdict(int)
                for earning in ready:
                    totals[earning.staff_id] += earning.amount_cents
                # a run that nets to nothing settles refunded work against what took it back
                if any(total < 0 for total in totals.values()):
                    raise Conflict(
                        "a pay run can't pay a member less than nothing", code="pay_negative"
                    )
                meta = {"run": new_id("pay_run")}
                if through is not None:
                    meta["through"] = through.isoformat()
            done: list[EarningOut] = []
            for earning in ready:
                if move == "pay" and earning.status == "pending":
                    await move_earning(self.db, earning, "approve")
                await move_earning(self.db, earning, move, meta=meta)
                cmd.record(action, entity_type="earning", entity_id=earning.id)
                moved = await load_earning(self.db, self.biz, earning.id)
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
            request={"earning_ids": earning_ids, "through": through and through.isoformat()},
        )


async def post_adjustment(db: AsyncSession, staff: Staff, cents: int, reason: str) -> str:
    journal = await ledger.post(
        db,
        staff.business_id,
        event="earning",
        ref=f"earning:adjustment:{new_id('entry')}",
        legs=[
            Leg("business", staff.business_id, "staff_cost", cents),
            Leg("staff", staff.id, "payable", -cents, "pending"),
        ],
        subject=("staff", staff.id),
        meta={"basis": "adjustment", "reason": reason},
    )
    assert journal is not None
    return journal


async def _lock_staff(db: AsyncSession, business_id: str, staff_ids: set[str]) -> None:
    """Serializes every move on a member's pay, in one order so two runs never deadlock."""
    await db.execute(
        scoped(Staff, business_id)
        .with_only_columns(Staff.id)
        .where(Staff.id.in_(sorted(staff_ids)))
        .order_by(Staff.id)
        .with_for_update()
    )


async def _lock_booking(db: AsyncSession, business_id: str, booking_id: str) -> None:
    """Serializes approve/pay against an automatic reversal of the same booking's earnings."""
    await db.execute(
        scoped(Booking, business_id)
        .with_only_columns(Booking.id)
        .where(Booking.id == booking_id)
        .with_for_update()
    )


async def _lock_subject(
    db: AsyncSession, business_id: str, subject: tuple[str, str] | None
) -> None:
    if subject is None:
        return
    kind, subject_id = subject
    if kind == "booking":
        await _lock_booking(db, business_id, subject_id)
    elif kind == "order":
        await db.execute(
            scoped(Order, business_id)
            .with_only_columns(Order.id)
            .where(Order.id == subject_id)
            .with_for_update()
        )
    elif kind == "invoice":
        await db.execute(
            scoped(Invoice, business_id)
            .with_only_columns(Invoice.id)
            .where(Invoice.id == subject_id)
            .with_for_update()
        )
    elif kind == "staff":
        await _lock_staff(db, business_id, {subject_id})


async def move_earning(
    db: AsyncSession,
    earning: Earning,
    move: Move,
    *,
    occurred_at: datetime | None = None,
    meta: dict[str, object] | None = None,
) -> None:
    """Approve (pending payable → approved), pay (approved → bank) or undo either one."""
    biz = earning.business_id
    stage: Stage = "approval" if move in ("approve", "unapprove") else "staff_payment"
    refs = await _stage_refs(db, biz, earning.id)
    if move in ("unapprove", "unpay"):
        undone = {ref.removesuffix(":undo") for _, ref in refs if ref.endswith(":undo")}
        [ref] = [r for e, r in refs if e == stage and not r.endswith(":undo") and r not in undone]
        journal = await ledger.journal_for(db, biz, ref)
        assert journal is not None
        run = (
            await db.execute(
                scoped(Entry, biz)
                .with_only_columns(Entry.meta["run"].astext)
                .where(Entry.journal_id == journal)
                .limit(1)
            )
        ).scalar_one_or_none()
        # dated when it's undone, so a closed period's statements and T4A stay as filed
        await ledger.reverse(
            db,
            biz,
            journal,
            ref=f"{ref}:undo",
            event=stage,
            source=("journal", earning.id),
            meta=None if run is None else {"run": run},
            occurred_at=occurred_at,
        )
        return
    count = sum(1 for e, r in refs if e == stage and not r.endswith(":undo"))
    current, to = (
        ("pending", Leg("staff", earning.staff_id, "payable", -earning.amount_cents, "approved"))
        if move == "approve"
        else ("approved", Leg("business", biz, "bank", -earning.amount_cents))
    )
    await ledger.post(
        db,
        biz,
        event=stage,
        ref=f"{stage}:{earning.id}:{count}",
        legs=[Leg("staff", earning.staff_id, "payable", earning.amount_cents, current), to],
        source=("journal", earning.id),
        subject=earning.subject,
        occurred_at=occurred_at,
        meta=meta,
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
    basis = entry.meta.get("basis")
    return Earning(
        id=journal_id,
        business_id=business_id,
        staff_id=account.owner_id,
        subject_type=entry.subject_type,
        subject_id=entry.subject_id,
        amount_cents=-entry.amount_cents,
        status=await _status(db, business_id, journal_id),
        kind=entry.event,
        basis=basis if isinstance(basis, str) else None,
    )


async def _status(db: AsyncSession, business_id: str, journal_id: str) -> str:
    return _stage_of(journal_id, await _stage_refs(db, business_id, journal_id))


def _stage_of(journal_id: str, refs: list[tuple[str, str]]) -> str:
    """An earning's status from its stage journals: each undo cancels the step it names."""
    if ("reversal", f"earning:{journal_id}:reversal") in refs:
        return "reversed"

    def net(stage: Stage) -> int:
        return sum(-1 if ref.endswith(":undo") else 1 for event, ref in refs if event == stage)

    if net("staff_payment") > 0:
        return "paid"
    return "approved" if net("approval") > 0 else "pending"


async def _statuses(db: AsyncSession, business_id: str, journal_ids: set[str]) -> dict[str, str]:
    """Many earnings' statuses in one read, as a pay run checks every open correction."""
    refs: dict[str, list[tuple[str, str]]] = {journal: [] for journal in journal_ids}
    if journal_ids:
        rows = await db.execute(
            scoped(Entry, business_id)
            .with_only_columns(Entry.source_id, Entry.event, Entry.ref)
            .where(
                Entry.source_type == "journal",
                Entry.source_id.in_(sorted(journal_ids)),
                Entry.event.in_(("approval", "staff_payment", "reversal")),
            )
            .distinct()
        )
        for source_id, stage, ref in rows.tuples().all():
            if source_id is not None:
                refs[source_id].append((str(stage), ref))
    return {journal: _stage_of(journal, found) for journal, found in refs.items()}


async def _stage_refs(db: AsyncSession, business_id: str, journal_id: str) -> list[tuple[str, str]]:
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.event, Entry.ref)
        .where(
            Entry.source_type == "journal",
            Entry.source_id == journal_id,
            Entry.event.in_(("approval", "staff_payment", "reversal")),
        )
        .distinct()
    )
    return [(str(event), ref) for event, ref in rows.tuples().all()]


async def _clawbacks_due(
    db: AsyncSession, business_id: str, staff_ids: set[str], paying: list[str]
) -> list[str]:
    """Open refund corrections a pay settles: negative tips, and clawbacks of settled earnings."""
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.journal_id, Entry.meta["of"].astext)
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.owner_type == "staff",
            Entry.owner_id.in_(staff_ids),
            Account.category == "payable",
            or_(
                Entry.meta["basis"].astext == "clawback",
                and_(Entry.event == "tip", Entry.amount_cents > 0),
            ),
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    found = rows.tuples().all()
    statuses = await _statuses(
        db, business_id, {j for j, _ in found} | {of for _, of in found if of is not None}
    )
    return [
        journal
        for journal, of in found
        if statuses[journal] in ("pending", "approved")
        and (of is None or of in paying or statuses.get(of) in ("paid", "reversed"))
    ]


async def _member_earnings(
    db: AsyncSession, business_id: str, booking_id: str, staff_id: str
) -> list[str]:
    """One member's earning journals on a booking, oldest first, whatever their ref says."""
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.subject_type == "booking",
            Entry.subject_id == booking_id,
            Entry.owner_type == "staff",
            Entry.owner_id == staff_id,
            _accrual(),
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


def _is_work(line: Line, item: Item | None) -> bool:
    """A booked service or custom line, which earns as visit work; products and passes don't."""
    kind = item.kind if item is not None else "service"
    return line.booking_id is not None and kind != "product" and kind not in ENTITLEMENT_KINDS


async def _lines(db: AsyncSession, document: Invoice | Order) -> list[tuple[Line, Item | None]]:
    owner = Line.invoice_id if isinstance(document, Invoice) else Line.order_id
    rows = await db.execute(
        scoped(Line, document.business_id)
        .add_columns(Item)
        .outerjoin(Item, Item.id == Line.item_id)
        .where(owner == document.id)
        .order_by(Line.position, Line.id)
    )
    return [(line, item) for line, item in rows.tuples().all()]


async def _work_lines(db: AsyncSession, document: Invoice | Order) -> list[Line]:
    return [line for line, item in await _lines(db, document) if _is_work(line, item)]


async def _payees(
    db: AsyncSession, document: Invoice | Order
) -> dict[tuple[str, str], tuple[int, Line]]:
    """A paid document's visit work by (booking, member): its cents and its first line."""
    groups: dict[tuple[str, str], tuple[int, Line]] = {}
    for line in await _work_lines(db, document):
        assert line.booking_id is not None
        for staff_id, cents in await worker_shares(db, line):
            total, first = groups.get((line.booking_id, staff_id), (0, line))
            groups[(line.booking_id, staff_id)] = (total + cents, first)
    return groups


def _rate(staff: Staff) -> int | None:
    return staff.rate_bps if staff.rate_type == "percent" else staff.rate_cents


def _visit_meta(
    basis: str, staff: Staff, base: int, label: str | None, booking: Booking
) -> dict[str, object]:
    """What a member's own replica needs to show a visit earning, since it holds no documents."""
    return {
        "basis": basis,
        "rate": _rate(staff),
        "base": base,
        "label": label,
        "client_id": booking.client_id,
        "worked_at": booking.starts_at.isoformat(),
    }


async def ensure_earnings(
    db: AsyncSession, document: Invoice | Order, *, occurred_at: datetime | None = None
) -> None:
    """Accrue a pending earning per booking and member on a paid invoice or sale, once each."""
    biz = document.business_id
    for (booking_id, staff_id), (cents, line) in (await _payees(db, document)).items():
        await _lock_booking(db, biz, booking_id)
        journals = await _member_earnings(db, biz, booking_id, staff_id)
        if journals and await _status(db, biz, journals[-1]) != "reversed":
            continue
        booking = await db.get(Booking, booking_id)
        staff = await db.get(Staff, staff_id)
        if booking is None or staff is None or not staff.payee:
            continue
        split = await _split(db, staff, cents, booking)
        if split is None or split[1] <= 0:
            continue
        basis, amount = split
        await _accrue(
            db,
            staff,
            amount,
            ref=f"earning:{booking.id}:{staff.id}:{len(journals)}",
            source=("line", line.id),
            subject=("booking", booking.id),
            meta=_visit_meta(basis, staff, cents, line.description, booking),
            occurred_at=occurred_at,
        )
    await _ensure_line_earnings(db, document, occurred_at)


async def _accrue(
    db: AsyncSession,
    staff: Staff,
    amount: int,
    *,
    ref: str,
    source: tuple[str, str],
    subject: tuple[str, str],
    meta: dict[str, object],
    occurred_at: datetime | None = None,
) -> None:
    await ledger.post(
        db,
        staff.business_id,
        event="earning",
        ref=ref,
        legs=[
            Leg("business", staff.business_id, "staff_cost", amount),
            Leg("staff", staff.id, "payable", -amount, "pending"),
        ],
        source=source,
        subject=subject,
        occurred_at=occurred_at,
        meta=meta,
    )


async def accrue_covered_visit(
    db: AsyncSession, booking: Booking, share: int, package_id: str
) -> None:
    """Accrue each member's earning on a visit a package covered, on the session's share."""
    biz = booking.business_id
    lead = booking.staff_id
    if lead is None:
        return
    crew = [lead, *(h for h in await crew_ids(db, biz, booking.id) if h != lead)]
    await _lock_booking(db, biz, booking.id)
    service = (
        await db.execute(
            scoped(Item, biz)
            .with_only_columns(Item.name)
            .join(Slot, Slot.item_id == Item.id)
            .where(Slot.id == booking.slot_id)
        )
    ).scalar_one_or_none()
    for staff_id, cents in zip(crew, allocate(share, [1] * len(crew)), strict=True):
        journals = await _member_earnings(db, biz, booking.id, staff_id)
        if journals and await _status(db, biz, journals[-1]) != "reversed":
            continue
        staff = await db.get(Staff, staff_id)
        if staff is None or not staff.payee:
            continue
        split = await _split(db, staff, cents, booking)
        if split is None or split[1] <= 0:
            continue
        basis, amount = split
        await _accrue(
            db,
            staff,
            amount,
            ref=f"earning:{booking.id}:{staff.id}:{len(journals)}",
            source=("package", package_id),
            subject=("booking", booking.id),
            meta=_visit_meta(basis, staff, cents, service, booking),
        )


async def reverse_earnings(db: AsyncSession, document: Invoice | Order) -> None:
    """Unwind pending earnings when an invoice or sale stops being paid; approved ones stand."""
    biz = document.business_id
    work = await _work_lines(db, document)
    for booking_id in sorted({line.booking_id for line in work if line.booking_id is not None}):
        await _lock_booking(db, biz, booking_id)
        # read the payees from the ledger, since a visit's crew may have changed since it was paid
        for staff_id in await _earners(db, biz, booking_id):
            journals = await _member_earnings(db, biz, booking_id, staff_id)
            if journals and await _status(db, biz, journals[-1]) == "pending":
                await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")
    others = await _other_lines(db, document)
    if others:
        await _lock_subject(db, biz, _document_subject(document))
    for line, _ in others:
        journals = await _line_earnings(db, document, line.id)
        if journals and await _status(db, biz, journals[-1]) == "pending":
            await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")


def _document_subject(document: Invoice | Order) -> tuple[str, str]:
    return ("invoice" if isinstance(document, Invoice) else "order", document.id)


async def _other_lines(
    db: AsyncSession, document: Invoice | Order
) -> list[tuple[Line, Item | None]]:
    """A document's lines that don't earn as visit work, with their catalog item if any."""
    return [(line, item) for line, item in await _lines(db, document) if not _is_work(line, item)]


def _line_split(
    staff: Staff, line: Line, item: Item | None, sale: bool
) -> tuple[str, int, int] | None:
    """The (basis, cents, rate) a member earns on a line that isn't visit work; hourly needs one."""
    kind = item.kind if item is not None else "service"
    if kind in ENTITLEMENT_KINDS:
        return None
    if kind == "product":
        # a sale's products already earn its seller's retail commission (ensure_order_earning)
        if sale or not staff.retail_rate_bps:
            return None
        bps = staff.retail_rate_bps
        return "retail", line.amount_cents * bps // 10000, bps
    if staff.rate_type == "percent" and staff.rate_bps is not None:
        return "percent", round(line.amount_cents * staff.rate_bps / 10000), staff.rate_bps
    # a fixed rate is per visit, so only a catalog service or class sold without a booking earns it
    if (
        staff.rate_type == "fixed"
        and staff.rate_cents is not None
        and item is not None
        and item.kind in BOOKABLE_KINDS
    ):
        return "fixed", staff.rate_cents, staff.rate_cents
    return None


async def _line_earner(db: AsyncSession, document: Invoice | Order, line: Line) -> str | None:
    """The line's member, else its visit's lead, else the sale's seller."""
    if line.staff_id is not None:
        return line.staff_id
    if line.booking_id is not None:
        booking = await db.get(Booking, line.booking_id)
        if booking is not None and booking.staff_id is not None:
            return booking.staff_id
    return document.staff_id if isinstance(document, Order) else None


async def _ensure_line_earnings(
    db: AsyncSession, document: Invoice | Order, occurred_at: datetime | None
) -> None:
    biz = document.business_id
    sale = isinstance(document, Order)
    subject = _document_subject(document)
    for line, item in await _other_lines(db, document):
        staff_id = await _line_earner(db, document, line)
        if staff_id is None or line.amount_cents <= 0:
            continue
        staff = await db.get(Staff, staff_id)
        if staff is None or not staff.payee:
            continue
        split = _line_split(staff, line, item, sale)
        if split is None or split[1] <= 0:
            continue
        await _lock_subject(db, biz, subject)
        journals = await _line_earnings(db, document, line.id)
        if journals and await _status(db, biz, journals[-1]) != "reversed":
            continue
        basis, amount, rate = split
        await _accrue(
            db,
            staff,
            amount,
            ref=f"earning:line:{line.id}:{len(journals)}",
            source=("line", line.id),
            subject=subject,
            meta={
                "basis": basis,
                "rate": rate,
                "base": line.amount_cents,
                "label": line.description,
                "client_id": document.client_id,
            },
            occurred_at=occurred_at,
        )


async def _line_earnings(db: AsyncSession, document: Invoice | Order, line_id: str) -> list[str]:
    kind, document_id = _document_subject(document)
    rows = await db.execute(
        scoped(Entry, document.business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.source_type == "line",
            Entry.source_id == line_id,
            Entry.subject_type == kind,
            Entry.subject_id == document_id,
            _accrual(),
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


async def _earners(db: AsyncSession, business_id: str, booking_id: str) -> list[str]:
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.owner_id)
        .where(
            Entry.event == "earning",
            Entry.subject_type == "booking",
            Entry.subject_id == booking_id,
            Entry.owner_type == "staff",
        )
        .distinct()
        .order_by(Entry.owner_id)
    )
    return list(rows.scalars().all())


async def ensure_order_earning(db: AsyncSession, order: Order) -> None:
    """Accrue the seller's retail commission on a paid sale's product lines, once per sale."""
    staff = await db.get(Staff, order.staff_id)
    if staff is None or not staff.payee or not staff.retail_rate_bps:
        return
    biz = order.business_id
    await _lock_subject(db, biz, ("order", order.id))
    journals = await _commissions(db, biz, order.id)
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
        meta={
            "basis": "retail",
            "rate": staff.retail_rate_bps,
            "base": base,
            "number": order.number,
            "client_id": order.client_id,
        },
    )


async def reverse_order_earning(db: AsyncSession, order: Order) -> None:
    """Unwind a still-pending retail commission when its sale is refunded."""
    biz = order.business_id
    await _lock_subject(db, biz, ("order", order.id))
    journals = await _commissions(db, biz, order.id)
    if journals and await _status(db, biz, journals[-1]) == "pending":
        await ledger.reverse(db, biz, journals[-1], ref=f"earning:{journals[-1]}:reversal")


async def _commissions(db: AsyncSession, business_id: str, order_id: str) -> list[str]:
    """A sale's retail commission journals; its line earnings share the subject, not the source."""
    rows = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.source_type == "order",
            Entry.source_id == order_id,
            Entry.subject_type == "order",
            Entry.subject_id == order_id,
            _accrual(),
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())


def _accrual() -> ColumnElement[bool]:
    return ~Entry.ref.contains(":clawback:")


async def _any_clawback(db: AsyncSession, business_id: str, earnings: ColumnElement[bool]) -> bool:
    """Whether any of these earnings was clawed back; with nothing refunded, none needs a look."""
    found = await db.execute(
        scoped(Entry, business_id).with_only_columns(Entry.id).where(earnings, ~_accrual()).limit(1)
    )
    return found.first() is not None


async def claw_back(db: AsyncSession, document: Invoice | Order) -> None:
    """Hold back the refunded share of each earning on a document as a negative pending earning."""
    biz = document.business_id
    kind, document_id = _document_subject(document)
    kept, booked = await ledger.amount_kept(db, biz, (kind, document_id), "revenue")
    line_ids = [line.id for line, _ in await _lines(db, document)]
    on_document = and_(
        Entry.event == "earning",
        Entry.owner_type == "staff",
        or_(
            and_(
                Entry.subject_type == "booking",
                Entry.source_type == "line",
                Entry.source_id.in_(line_ids),
            ),
            and_(Entry.subject_type == kind, Entry.subject_id == document_id),
        ),
    )
    if kept >= booked and not await _any_clawback(db, biz, on_document):
        return
    rows = await db.execute(
        scoped(Entry, biz)
        .with_only_columns(Entry.journal_id)
        .where(on_document, _accrual())
        .distinct()
        .order_by(Entry.journal_id)
    )
    await _claw_back_each(db, biz, list(rows.scalars().all()), kept, booked)


async def claw_back_purchase(db: AsyncSession, payment: Payment) -> None:
    package = (
        await db.execute(
            scoped(Package, payment.business_id).where(Package.payment_id == payment.id)
        )
    ).scalar_one_or_none()
    if package is not None:
        await claw_back_package(db, package)


async def claw_back_package(db: AsyncSession, package: Package) -> None:
    """The same for the visits a refunded package covered; their earnings are never reversed."""
    biz = package.business_id
    kept, booked = await ledger.amount_kept(db, biz, ("package", package.id), "deferred")
    on_package = and_(
        Entry.event == "earning",
        Entry.owner_type == "staff",
        Entry.source_type == "package",
        Entry.source_id == package.id,
    )
    if kept >= booked and not await _any_clawback(db, biz, on_package):
        return
    rows = await db.execute(
        scoped(Entry, biz)
        .with_only_columns(Entry.journal_id)
        .where(on_package, _accrual())
        .distinct()
        .order_by(Entry.journal_id)
    )
    await _claw_back_each(db, biz, list(rows.scalars().all()), kept, booked)


async def _claw_back_each(
    db: AsyncSession, business_id: str, journals: list[str], kept: int, booked: int
) -> None:
    for journal in journals:
        first = await load_earning(db, business_id, journal)
        if first is None:
            continue
        await _lock_subject(db, business_id, first.subject)
        earning = await load_earning(db, business_id, journal)
        assert earning is not None
        await _settle_clawback(db, earning, kept, booked)


async def _settle_clawback(db: AsyncSession, earning: Earning, kept: int, booked: int) -> None:
    """Keep the open clawbacks equal to the refunded share, posting only when it changes."""
    biz = earning.business_id
    clawbacks = await _clawbacks(db, earning)
    settled = 0
    pending: list[tuple[str, int]] = []
    for journal in clawbacks:
        clawback = await load_earning(db, biz, journal)
        if clawback is None or clawback.status == "reversed":
            continue
        if clawback.status == "pending":
            pending.append((journal, clawback.amount_cents))
        else:
            settled += clawback.amount_cents
    share = max(0, min(kept, booked))
    due = (
        0
        if earning.status == "reversed" or booked <= 0
        else earning.amount_cents - earning.amount_cents * share // booked
    )
    need = -due - settled
    if sum(cents for _, cents in pending) == need:
        return
    for journal, _ in pending:
        await ledger.reverse(db, biz, journal, ref=f"earning:{journal}:reversal")
    if need == 0:
        return
    source = (
        await db.execute(
            scoped(Entry, biz)
            .with_only_columns(Entry.source_type, Entry.source_id)
            .where(Entry.journal_id == earning.id)
            .limit(1)
        )
    ).one()
    await ledger.post(
        db,
        biz,
        event="earning",
        ref=f"earning:{earning.id}:clawback:{len(clawbacks)}",
        legs=[
            Leg("business", biz, "staff_cost", need),
            Leg("staff", earning.staff_id, "payable", -need, "pending"),
        ],
        source=(source.source_type, source.source_id)
        if source.source_type and source.source_id
        else None,
        subject=earning.subject,
        meta={"basis": "clawback", "of": earning.id},
    )


async def cancel_returned_tips(db: AsyncSession, refund: Payment, original: Payment) -> None:
    """A failed refund's returned tips that no pay has settled are cancelled, not offset."""
    biz = original.business_id
    for staff_id, _ in ledger.tip_shares(original):
        journal = await ledger.journal_for(db, biz, f"tip:{refund.id}:{staff_id}")
        if journal is None:
            continue
        await _lock_staff(db, biz, {staff_id})
        tip = await load_earning(db, biz, journal)
        if tip is None or tip.status not in ("pending", "approved"):
            continue
        if tip.status == "approved":
            await move_earning(db, tip, "unapprove")
        await ledger.reverse(db, biz, journal, ref=f"earning:{journal}:reversal")


async def _clawbacks(db: AsyncSession, earning: Earning) -> list[str]:
    rows = await db.execute(
        scoped(Entry, earning.business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.event == "earning",
            Entry.ref.startswith(f"earning:{earning.id}:clawback:"),
        )
        .distinct()
        .order_by(Entry.journal_id)
    )
    return list(rows.scalars().all())
