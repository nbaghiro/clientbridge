from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, func, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import ChargeFees
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services.lines import fetch_lines, tax_for_amount, tax_for_lines
from clientbridge.services.tax_service import TaxResult

type AccountKey = tuple[str, str, str, str]

PLATFORM = "clientbridge"
_CASH = {"stripe": "stripe", "interac": "bank", "manual": "cash"}
# the credit-side kinds a refund unwinds pro rata (never the receivable: a refund is a credit note)
_UNWOUND = ("revenue", "tax", "deposit", "deferred", "gift_card")


class UnbalancedJournal(ValueError):
    pass


@dataclass(frozen=True)
class Leg:
    owner_type: str
    owner_id: str
    kind: str
    amount_cents: int
    code: str = ""
    subject: tuple[str, str] | None = None

    @property
    def key(self) -> AccountKey:
        return (self.owner_type, self.owner_id, self.kind, self.code)


async def post(
    db: AsyncSession,
    business_id: str,
    *,
    type: str,
    ref: str,
    legs: Sequence[Leg],
    currency: str = "CAD",
    source: tuple[str, str] | None = None,
    subject: tuple[str, str] | None = None,
    meta: dict[str, object] | None = None,
    occurred_at: datetime | None = None,
    available_at: datetime | None = None,
) -> str | None:
    """Write one balanced journal and return its id; a repeated `ref` returns the original."""
    existing = await journal_for(db, business_id, ref)
    if existing is not None:
        return existing
    legs = [leg for leg in legs if leg.amount_cents != 0]
    if not legs:
        return None
    if sum(leg.amount_cents for leg in legs) != 0:
        raise UnbalancedJournal(ref)
    accounts = await _lock_accounts(db, business_id, currency, {leg.key for leg in legs})
    journal_id = new_id("journal")
    at = occurred_at or datetime.now(UTC)
    for index, leg in enumerate(legs):
        account = accounts[leg.key]
        account.balance_cents += leg.amount_cents
        on = leg.subject or subject
        db.add(
            Entry(
                id=new_id("entry"),
                business_id=business_id,
                journal_id=journal_id,
                account_id=account.id,
                owner_type=account.owner_type,
                owner_id=account.owner_id,
                amount_cents=leg.amount_cents,
                currency=currency,
                type=type,
                source_type=source[0] if source else None,
                source_id=source[1] if source else None,
                subject_type=on[0] if on else None,
                subject_id=on[1] if on else None,
                ref=ref,
                leg=index,
                meta=meta or {},
                occurred_at=at,
                available_at=available_at,
            )
        )
    await db.flush()
    return journal_id


async def reverse(
    db: AsyncSession,
    business_id: str,
    journal_id: str,
    *,
    ref: str,
    type: str = "reversal",
    meta: dict[str, object] | None = None,
) -> str | None:
    """Post the exact negation of a journal (the only way to correct the ledger)."""
    rows = await _rows(db, business_id, Entry.journal_id == journal_id)
    if not rows:
        return None
    first = rows[0][0]
    legs = [
        Leg(
            account.owner_type,
            account.owner_id,
            account.kind,
            -entry.amount_cents,
            account.code,
            (entry.subject_type, entry.subject_id)
            if entry.subject_type and entry.subject_id
            else None,
        )
        for entry, account in rows
    ]
    return await post(
        db,
        business_id,
        type=type,
        ref=ref,
        legs=legs,
        currency=first.currency,
        source=("journal", journal_id),
        meta=meta,
    )


async def balance(
    db: AsyncSession,
    business_id: str,
    *,
    owner_type: str,
    owner_id: str,
    kind: str,
    code: str = "",
    currency: str = "CAD",
) -> int:
    value = (
        await db.execute(
            scoped(Account, business_id)
            .with_only_columns(Account.balance_cents)
            .where(
                Account.owner_type == owner_type,
                Account.owner_id == owner_id,
                Account.kind == kind,
                Account.code == code,
                Account.currency == currency,
            )
        )
    ).scalar_one_or_none()
    return value or 0


async def account_total(db: AsyncSession, business_id: str, where: ColumnElement[bool]) -> int:
    total = await db.execute(
        scoped(Account, business_id)
        .with_only_columns(func.coalesce(func.sum(Account.balance_cents), 0))
        .where(where)
    )
    return int(total.scalar_one())


async def subject_balance(
    db: AsyncSession, business_id: str, *, kind: str, subject_type: str, subject_id: str
) -> int:
    """Net of every `kind` leg booked against one entity (e.g. an invoice's receivable)."""
    value = (
        await db.execute(
            scoped(Entry, business_id)
            .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(
                Entry.subject_type == subject_type,
                Entry.subject_id == subject_id,
                Account.kind == kind,
            )
        )
    ).scalar_one()
    return int(value)


async def _lock_accounts(
    db: AsyncSession, business_id: str, currency: str, keys: set[AccountKey]
) -> dict[AccountKey, Account]:
    ordered = sorted(keys)
    await db.execute(
        insert(Account)
        .values(
            [
                {
                    "id": new_id("account"),
                    "business_id": business_id,
                    "owner_type": owner_type,
                    "owner_id": owner_id,
                    "kind": kind,
                    "code": code,
                    "currency": currency,
                    "balance_cents": 0,
                }
                for owner_type, owner_id, kind, code in ordered
            ]
        )
        .on_conflict_do_nothing(
            index_elements=["business_id", "owner_type", "owner_id", "kind", "code", "currency"]
        )
    )
    rows = (
        (
            await db.execute(
                scoped(Account, business_id)
                .where(
                    Account.currency == currency,
                    tuple_(Account.owner_type, Account.owner_id, Account.kind, Account.code).in_(
                        ordered
                    ),
                )
                .order_by(Account.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    return {(a.owner_type, a.owner_id, a.kind, a.code): a for a in rows}


async def journal_for(db: AsyncSession, business_id: str, ref: str) -> str | None:
    return (
        (
            await db.execute(
                scoped(Entry, business_id)
                .with_only_columns(Entry.journal_id)
                .where(Entry.ref == ref)
            )
        )
        .scalars()
        .first()
    )


async def _rows(
    db: AsyncSession, business_id: str, where: ColumnElement[bool]
) -> list[tuple[Entry, Account]]:
    rows = await db.execute(
        scoped(Entry, business_id)
        .add_columns(Account)
        .join(Account, Account.id == Entry.account_id)
        .where(where)
        .order_by(Entry.leg)
    )
    return [(entry, account) for entry, account in rows.tuples().all()]


def _payer(business_id: str, client_id: str | None) -> tuple[str, str]:
    return ("client", client_id) if client_id else ("business", business_id)


def _tax_legs(business_id: str, tax: TaxResult) -> list[Leg]:
    return [
        Leg("business", business_id, "tax", -cents, code)
        for code, cents in sorted(tax.by_jurisdiction.items())
    ]


def _sale_legs(business_id: str, amount: int, tax: TaxResult) -> list[Leg]:
    return [
        Leg("business", business_id, "revenue", -(amount - tax.tax_total_cents)),
        *_tax_legs(business_id, tax),
    ]


async def post_invoice(db: AsyncSession, invoice: Invoice, tax: TaxResult) -> None:
    biz = invoice.business_id
    await post(
        db,
        biz,
        type="invoice",
        ref=f"invoice:{invoice.id}",
        legs=[
            Leg(*_payer(biz, invoice.client_id), "receivable", tax.total_cents),
            *_sale_legs(biz, tax.total_cents, tax),
        ],
        currency=invoice.currency,
        subject=("invoice", invoice.id),
        occurred_at=invoice.issued_at,
    )


async def void_invoice(db: AsyncSession, invoice: Invoice) -> None:
    journal = await journal_for(db, invoice.business_id, f"invoice:{invoice.id}")
    if journal is not None:
        await reverse(db, invoice.business_id, journal, ref=f"invoice:{invoice.id}:void")


async def invoice_balance(db: AsyncSession, invoice: Invoice) -> int:
    if invoice.status == "draft":
        return invoice.total_cents
    return await subject_balance(
        db, invoice.business_id, kind="receivable", subject_type="invoice", subject_id=invoice.id
    )


async def collected(
    db: AsyncSession, business_id: str, subject_type: str, subject_id: str
) -> tuple[int, bool]:
    """(net cash collected, whether any of it was refunded) for one invoice/order."""
    rows = await _rows(
        db,
        business_id,
        (Entry.subject_type == subject_type)
        & (Entry.subject_id == subject_id)
        & Entry.type.in_(("payment", "refund")),
    )
    cash = [(e, a) for e, a in rows if a.kind in _CASH.values()]
    return sum(e.amount_cents for e, _ in cash), any(e.type == "refund" for e, _ in cash)


async def post_payment(
    db: AsyncSession, payment: Payment, *, available_at: datetime | None = None
) -> None:
    biz = payment.business_id
    subject, credits = await _settlement(db, payment)
    await post(
        db,
        biz,
        type="payment",
        ref=f"payment:{payment.id}",
        legs=[Leg("business", biz, _CASH[payment.provider], payment.amount_cents), *credits],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
        occurred_at=payment.paid_at,
        available_at=available_at,
    )


async def _settlement(db: AsyncSession, payment: Payment) -> tuple[tuple[str, str], list[Leg]]:
    """What a settled payment pays for — the credit side of its journal."""
    biz, amount = payment.business_id, payment.amount_cents
    if payment.invoice_id is not None:
        payer = _payer(biz, payment.client_id)
        return ("invoice", payment.invoice_id), [Leg(*payer, "receivable", -amount)]
    if payment.order_id is not None:
        tax = await tax_for_lines(db, biz, await fetch_lines(db, biz, "order", payment.order_id))
        return ("order", payment.order_id), _sale_legs(biz, amount, tax)
    if payment.booking_id is not None:
        return ("booking", payment.booking_id), [Leg("business", biz, "deposit", -amount)]
    package = (
        await db.execute(scoped(Package, biz).where(Package.payment_id == payment.id))
    ).scalar_one_or_none()
    if package is not None:
        item = await db.get(Item, package.item_id)
        tax = await tax_for_amount(db, biz, item.price_cents if item is not None else amount)
        return ("package", package.id), [
            Leg("package", package.id, "deferred", -(amount - tax.tax_total_cents)),
            *_tax_legs(biz, tax),
        ]
    card = (
        await db.execute(scoped(GiftCard, biz).where(GiftCard.payment_id == payment.id))
    ).scalar_one_or_none()
    if card is not None:
        return ("gift_card", card.id), [Leg("gift_card", card.id, "gift_card", -amount)]
    return ("payment", payment.id), [Leg("business", biz, "revenue", -amount)]


async def post_fees(db: AsyncSession, payment: Payment, fees: ChargeFees) -> None:
    biz, app = payment.business_id, fees.application_fee_cents
    await post(
        db,
        biz,
        type="fee",
        ref=f"fee:{payment.id}",
        legs=[
            Leg("business", biz, "processing_fee", fees.processing_fee_cents),
            Leg("business", biz, "platform_fee", app),
            Leg("business", biz, "stripe", -(fees.processing_fee_cents + app)),
            Leg("platform", PLATFORM, "stripe", app),
            Leg("platform", PLATFORM, "fee_revenue", -app),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
        occurred_at=payment.paid_at,
        available_at=fees.available_at,
    )


async def post_refund(
    db: AsyncSession,
    refund: Payment,
    original: Payment,
    *,
    amount: int | None = None,
    ref: str | None = None,
) -> None:
    """Return the money and unwind what it paid for, pro rata (an invoice's revenue + tax, or the
    deposit/package/gift-card liability), so the refund reads as a credit note."""
    biz = original.business_id
    returned = refund.amount_cents if amount is None else amount
    basis = f"invoice:{original.invoice_id}" if original.invoice_id else f"payment:{original.id}"
    credits = [
        (entry, account)
        for entry, account in await _rows(db, biz, Entry.ref == basis)
        if account.kind in _UNWOUND
    ]
    base = -sum(entry.amount_cents for entry, _ in credits)
    if base <= 0:
        credits, base = [], returned
    legs = [
        Leg(a.owner_type, a.owner_id, a.kind, -e.amount_cents * returned // base, a.code)
        for e, a in credits
    ] or [Leg("business", biz, "revenue", returned)]
    largest = max(range(len(legs)), key=lambda i: legs[i].amount_cents)
    short = returned - sum(leg.amount_cents for leg in legs)
    legs[largest] = Leg(
        legs[largest].owner_type,
        legs[largest].owner_id,
        legs[largest].kind,
        legs[largest].amount_cents + short,
        legs[largest].code,
    )
    subject, _ = await _settlement(db, original)
    await post(
        db,
        biz,
        type="refund",
        ref=ref or f"refund:{refund.id}",
        legs=[Leg("business", biz, _CASH[original.provider], -returned), *legs],
        currency=refund.currency,
        source=("payment", refund.id),
        subject=subject,
        occurred_at=refund.paid_at,
    )


async def post_dispute(
    db: AsyncSession, payment: Payment, *, dispute_id: str, amount: int, fee: int
) -> None:
    """Stripe pulls the disputed funds (+ its fee); the payer owes them back until it's won."""
    biz = payment.business_id
    subject, _ = await _settlement(db, payment)
    await post(
        db,
        biz,
        type="dispute",
        ref=f"dispute:{dispute_id}",
        legs=[
            Leg("business", biz, "stripe", -amount),
            Leg(*_payer(biz, payment.client_id), "receivable", amount),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
    )
    await post(
        db,
        biz,
        type="fee",
        ref=f"dispute_fee:{dispute_id}",
        legs=[
            Leg("business", biz, "processing_fee", fee),
            Leg("business", biz, "stripe", -fee),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
    )


async def close_dispute(db: AsyncSession, business_id: str, dispute_id: str) -> None:
    journal = await journal_for(db, business_id, f"dispute:{dispute_id}")
    if journal is not None:
        await reverse(db, business_id, journal, ref=f"dispute:{dispute_id}:won")


async def post_payout(
    db: AsyncSession,
    business_id: str,
    *,
    payout_id: str,
    amount: int,
    currency: str,
    arrival_at: datetime | None,
) -> None:
    await post(
        db,
        business_id,
        type="payout",
        ref=f"payout:{payout_id}",
        legs=[
            Leg("business", business_id, "bank", amount),
            Leg("business", business_id, "stripe", -amount),
        ],
        currency=currency,
        source=("stripe_payout", payout_id),
        occurred_at=arrival_at,
        available_at=arrival_at,
    )


async def fail_payout(db: AsyncSession, business_id: str, payout_id: str) -> None:
    journal = await journal_for(db, business_id, f"payout:{payout_id}")
    if journal is not None:
        await reverse(db, business_id, journal, ref=f"payout:{payout_id}:failed")


async def gift_card_balance(db: AsyncSession, card: GiftCard) -> int:
    return -await balance(
        db, card.business_id, owner_type="gift_card", owner_id=card.id, kind="gift_card"
    )


async def post_redemption(db: AsyncSession, card: GiftCard, amount: int) -> None:
    remaining = await gift_card_balance(db, card)
    await post(
        db,
        card.business_id,
        type="redemption",
        ref=f"redemption:{card.id}:{remaining}",
        legs=[
            Leg("gift_card", card.id, "gift_card", amount),
            Leg("business", card.business_id, "revenue", -amount),
        ],
        subject=("gift_card", card.id),
    )


async def post_consumption(db: AsyncSession, package: Package) -> None:
    """Recognize one used session's share of prepaid package revenue (the last takes the rest)."""
    biz = package.business_id
    remaining = -await balance(db, biz, owner_type="package", owner_id=package.id, kind="deferred")
    if package.sessions_used >= package.sessions_total:
        share = remaining
    else:
        paid = -sum(
            entry.amount_cents
            for entry, account in await _rows(
                db, biz, (Entry.subject_type == "package") & (Entry.subject_id == package.id)
            )
            if account.kind == "deferred" and entry.type == "payment"
        )
        share = min(remaining, paid // package.sessions_total)
    await post(
        db,
        biz,
        type="consumption",
        ref=f"consumption:{package.id}:{package.sessions_used}",
        legs=[
            Leg("package", package.id, "deferred", share),
            Leg("business", biz, "revenue", -share),
        ],
        subject=("package", package.id),
    )


async def deposit_held(db: AsyncSession, booking: Booking) -> int:
    return -await subject_balance(
        db, booking.business_id, kind="deposit", subject_type="booking", subject_id=booking.id
    )


async def deposit_state(db: AsyncSession, booking: Booking) -> str:
    if not booking.deposit_required or booking.deposit_amount_cents <= 0:
        return "none"
    if await journal_for(db, booking.business_id, f"forfeit:{booking.id}") is not None:
        return "forfeited"
    if await deposit_held(db, booking) > 0:
        return "collected"
    refunds = await _rows(
        db,
        booking.business_id,
        (Entry.subject_type == "booking")
        & (Entry.subject_id == booking.id)
        & (Entry.type == "refund"),
    )
    if refunds:
        return "refunded"
    return "none" if booking.status in ("completed", "canceled") else "pending"


async def post_forfeit(db: AsyncSession, booking: Booking) -> None:
    held = await deposit_held(db, booking)
    await post(
        db,
        booking.business_id,
        type="forfeit",
        ref=f"forfeit:{booking.id}",
        legs=[
            Leg("business", booking.business_id, "deposit", held),
            Leg("business", booking.business_id, "revenue", -held),
        ],
        subject=("booking", booking.id),
    )


async def reverse_forfeit(db: AsyncSession, booking: Booking) -> None:
    journal = await journal_for(db, booking.business_id, f"forfeit:{booking.id}")
    if journal is not None:
        await reverse(db, booking.business_id, journal, ref=f"forfeit:{booking.id}:refund")
