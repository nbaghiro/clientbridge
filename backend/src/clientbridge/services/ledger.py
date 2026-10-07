from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, and_, case, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import ChargeFees, PaymentGateway
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking
from clientbridge.services.lines import fetch_lines
from clientbridge.services.tax import TaxResult, tax_for_amount, tax_for_lines

type AccountKey = tuple[str, str, str, str]
type _Id = InstrumentedAttribute[str] | str

PLATFORM = "clientbridge"
_CASH = {"stripe": "stripe", "interac": "bank", "manual": "cash"}
# recorded by hand: cash sits in the till, a cheque or an e-Transfer already reached the bank
_BANKED_BY_HAND = ("cheque", "interac", "bank_eft")
# the credit-side kinds a refund unwinds pro rata (never the receivable: a refund is a credit note)
_UNWOUND = ("revenue", "tax", "deposit", "deferred", "gift_card")


class UnbalancedJournal(ValueError):
    pass


@dataclass(frozen=True)
class Leg:
    owner_type: str
    owner_id: str
    category: str
    amount_cents: int
    code: str = ""
    subject: tuple[str, str] | None = None

    @property
    def key(self) -> AccountKey:
        return (self.owner_type, self.owner_id, self.category, self.code)


async def post(
    db: AsyncSession,
    business_id: str,
    *,
    event: str,
    ref: str,
    legs: Sequence[Leg],
    currency: str = "CAD",
    source: tuple[str, str] | None = None,
    subject: tuple[str, str] | None = None,
    meta: dict[str, object] | None = None,
    occurred_at: datetime | None = None,
    available_at: datetime | None = None,
    keep_zero: bool = False,
) -> str | None:
    """Write one balanced journal; a repeated `ref` returns the original id."""
    existing = await journal_for(db, business_id, ref)
    if existing is not None:
        return existing
    legs = [leg for leg in legs if keep_zero or leg.amount_cents != 0]
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
                event=event,
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
    event: str = "reversal",
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
            account.category,
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
        event=event,
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
    category: str,
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
                Account.category == category,
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
    db: AsyncSession, business_id: str, *, category: str, subject_type: str, subject_id: str
) -> int:
    """Net of every `category` leg booked against one entity (e.g. an invoice's receivable)."""
    value = (
        await db.execute(
            scoped(Entry, business_id)
            .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(
                Entry.subject_type == subject_type,
                Entry.subject_id == subject_id,
                Account.category == category,
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
                    "category": category,
                    "code": code,
                    "currency": currency,
                    "balance_cents": 0,
                }
                for owner_type, owner_id, category, code in ordered
            ]
        )
        .on_conflict_do_nothing(
            index_elements=["business_id", "owner_type", "owner_id", "category", "code", "currency"]
        )
    )
    rows = (
        (
            await db.execute(
                scoped(Account, business_id)
                .where(
                    Account.currency == currency,
                    tuple_(
                        Account.owner_type, Account.owner_id, Account.category, Account.code
                    ).in_(ordered),
                )
                .order_by(Account.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    return {(a.owner_type, a.owner_id, a.category, a.code): a for a in rows}


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
        event="invoice",
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
        db,
        invoice.business_id,
        category="receivable",
        subject_type="invoice",
        subject_id=invoice.id,
    )


def _subject_legs(subject_type: str, subject_id: _Id) -> ColumnElement[bool]:
    return and_(Entry.subject_type == subject_type, Entry.subject_id == subject_id)


def _collected_expr(subject_type: str, subject_id: _Id) -> ColumnElement[int]:
    return (
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs(subject_type, subject_id),
            Account.category.in_(_CASH.values()),
            Entry.event.in_(("payment", "refund")),
        )
        .scalar_subquery()
    )


def _refunded_expr(subject_type: str, subject_id: _Id) -> ColumnElement[bool]:
    return (
        select(Entry.id)
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs(subject_type, subject_id),
            Account.category.in_(_CASH.values()),
            Entry.event == "refund",
        )
        .exists()
    )


def _receivable_expr() -> ColumnElement[int]:
    return (
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(_subject_legs("invoice", Invoice.id), Account.category == "receivable")
        .scalar_subquery()
    )


def invoice_status_expr() -> ColumnElement[str]:
    """An invoice stores only draft/sent/void; how far a sent one is paid comes from the ledger."""
    paid = _collected_expr("invoice", Invoice.id)
    owed = _receivable_expr()
    return case(
        (Invoice.status.in_(("draft", "void")), Invoice.status),
        (and_(paid <= 0, _refunded_expr("invoice", Invoice.id), owed <= 0), "refunded"),
        (owed <= 0, "paid"),
        (paid > 0, "partial"),
        (Invoice.overdue_notified_at.is_not(None), "overdue"),
        else_="sent",
    )


def invoice_paid_at_expr() -> ColumnElement[datetime | None]:
    settled = (
        select(func.max(Entry.occurred_at))
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs("invoice", Invoice.id),
            Account.category == "receivable",
            Entry.amount_cents < 0,
        )
        .scalar_subquery()
    )
    return case((invoice_status_expr() == "paid", settled), else_=None)


def order_status_expr() -> ColumnElement[str]:
    """An order stores only open/void; whether it is paid or refunded comes from the ledger."""
    paid = _collected_expr("order", Order.id)
    refunded = _refunded_expr("order", Order.id)
    return case(
        (Order.status == "void", "void"),
        (and_(paid <= 0, refunded), "refunded"),
        (and_(paid > 0, or_(paid >= Order.total_cents, refunded)), "paid"),
        else_="open",
    )


def order_paid_at_expr() -> ColumnElement[datetime | None]:
    settled = (
        select(func.max(Entry.occurred_at))
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs("order", Order.id),
            Account.category.in_(_CASH.values()),
            Entry.event == "payment",
        )
        .scalar_subquery()
    )
    return case((order_status_expr().in_(("paid", "refunded")), settled), else_=None)


async def invoice_state(db: AsyncSession, invoice: Invoice) -> tuple[str, datetime | None]:
    row = (
        await db.execute(
            select(invoice_status_expr(), invoice_paid_at_expr()).where(Invoice.id == invoice.id)
        )
    ).one()
    return str(row[0]), row[1]


async def order_state(db: AsyncSession, order: Order) -> tuple[str, datetime | None]:
    row = (
        await db.execute(
            select(order_status_expr(), order_paid_at_expr()).where(Order.id == order.id)
        )
    ).one()
    return str(row[0]), row[1]


async def collected(
    db: AsyncSession, business_id: str, subject_type: str, subject_id: str
) -> tuple[int, bool]:
    """(net cash collected, whether any of it was refunded) for one invoice/order."""
    rows = await _rows(
        db,
        business_id,
        (Entry.subject_type == subject_type)
        & (Entry.subject_id == subject_id)
        & Entry.event.in_(("payment", "refund")),
    )
    cash = [(e, a) for e, a in rows if a.category in _CASH.values()]
    return sum(e.amount_cents for e, _ in cash), any(e.event == "refund" for e, _ in cash)


def cash_category(payment: Payment) -> str:
    """The cash account a payment lands in."""
    if payment.provider == "manual" and payment.method in _BANKED_BY_HAND:
        return "bank"
    return _CASH[payment.provider]


async def post_payment(
    db: AsyncSession, payment: Payment, *, available_at: datetime | None = None
) -> None:
    biz = payment.business_id
    subject, credits = await _settlement(db, payment)
    await post(
        db,
        biz,
        event="payment",
        ref=f"payment:{payment.id}",
        legs=[Leg("business", biz, cash_category(payment), payment.amount_cents), *credits],
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
        event="fee",
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


async def _unwind(
    db: AsyncSession,
    original: Payment,
    refund: Payment,
    credits: list[tuple[Entry, Account]],
    base: int,
    returned: int,
) -> list[Leg]:
    """Each credit leg's share still to unwind, so the final refund clears every leg exactly."""
    refunds = scoped(Payment, original.business_id).where(
        Payment.kind == "refund",
        Payment.id != refund.id,
        Payment.invoice_id == original.invoice_id
        if original.invoice_id
        else Payment.parent_payment_id == original.id,
    )
    owed: dict[str, tuple[Account, int]] = {}
    for entry, account in credits:
        owed[account.id] = (account, owed.get(account.id, (account, 0))[1] - entry.amount_cents)
    prior_rows = await _rows(
        db,
        original.business_id,
        (Entry.event == "refund")
        & Entry.account_id.in_(owed)
        & Entry.source_id.in_(refunds.with_only_columns(Payment.id).scalar_subquery()),
    )
    prior: dict[str, int] = {}
    for entry, _ in prior_rows:
        prior[entry.account_id] = prior.get(entry.account_id, 0) + entry.amount_cents
    done = sum(prior.values()) + returned
    shares = [
        (a, credit * done // base - prior.get(a.id, 0), credit) for a, credit in owed.values()
    ]
    largest = max(range(len(shares)), key=lambda i: shares[i][2])
    short = returned - sum(cents for _, cents, _ in shares)
    legs = [
        Leg(a.owner_type, a.owner_id, a.category, cents + (short if i == largest else 0), a.code)
        for i, (a, cents, _) in enumerate(shares)
    ]
    return legs


async def post_refund(
    db: AsyncSession,
    refund: Payment,
    original: Payment,
    *,
    amount: int | None = None,
    ref: str | None = None,
) -> None:
    """Return the money and unwind what it paid for, pro rata."""
    biz = original.business_id
    returned = refund.amount_cents if amount is None else amount
    basis = f"invoice:{original.invoice_id}" if original.invoice_id else f"payment:{original.id}"
    credits = [
        (entry, account)
        for entry, account in await _rows(db, biz, Entry.ref == basis)
        if account.category in _UNWOUND
    ]
    base = -sum(entry.amount_cents for entry, _ in credits)
    if base <= 0:
        legs = [Leg("business", biz, "revenue", returned)]
    else:
        legs = await _unwind(db, original, refund, credits, base, returned)
    subject, _ = await _settlement(db, original)
    await post(
        db,
        biz,
        event="refund",
        ref=ref or f"refund:{refund.id}",
        legs=[Leg("business", biz, cash_category(original), -returned), *legs],
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
        event="dispute",
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
        event="fee",
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
        event="payout",
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
        db, card.business_id, owner_type="gift_card", owner_id=card.id, category="gift_card"
    )


def gift_card_status(card: GiftCard, balance_cents: int) -> str:
    """A spent card stays `active` in storage and reads as `redeemed`."""
    return "redeemed" if card.status == "active" and balance_cents == 0 else card.status


async def post_redemption(db: AsyncSession, card: GiftCard, amount: int) -> None:
    remaining = await gift_card_balance(db, card)
    await post(
        db,
        card.business_id,
        event="redemption",
        ref=f"redemption:{card.id}:{remaining}",
        legs=[
            Leg("gift_card", card.id, "gift_card", amount),
            Leg("business", card.business_id, "revenue", -amount),
        ],
        subject=("gift_card", card.id),
    )


async def _owned(
    db: AsyncSession, business_id: str, owner_type: str, owner_id: str, category: str
) -> tuple[int, str]:
    """What an entity's own liability account still holds, in the currency it was bought in."""
    account = (
        await db.execute(
            scoped(Account, business_id).where(
                Account.owner_type == owner_type,
                Account.owner_id == owner_id,
                Account.category == category,
            )
        )
    ).scalar_one_or_none()
    return (0, "CAD") if account is None else (-account.balance_cents, account.currency)


async def post_breakage(
    db: AsyncSession, business_id: str, *, owner_type: str, owner_id: str, category: str
) -> None:
    """Recognize the unspent balance of an expired gift card or package as revenue."""
    unused, currency = await _owned(db, business_id, owner_type, owner_id, category)
    await post(
        db,
        business_id,
        event="breakage",
        ref=f"breakage:{owner_id}",
        legs=[
            Leg(owner_type, owner_id, category, unused),
            Leg("business", business_id, "revenue", -unused),
        ],
        currency=currency,
        subject=(owner_type, owner_id),
    )


async def sessions_used(db: AsyncSession, package: Package) -> int:
    """Each consumed session is one consumption journal on the package."""
    used = await db.execute(
        scoped(Entry, package.business_id)
        .with_only_columns(func.count(func.distinct(Entry.journal_id)))
        .where(_subject_legs("package", package.id), Entry.event == "consumption")
    )
    return int(used.scalar_one())


async def post_consumption(db: AsyncSession, package: Package) -> None:
    """Recognize one used session's share of prepaid package revenue (the last takes the rest)."""
    biz = package.business_id
    used = await sessions_used(db, package) + 1
    remaining, currency = await _owned(db, biz, "package", package.id, "deferred")
    if used >= package.sessions_total:
        share = remaining
    else:
        paid = -sum(
            entry.amount_cents
            for entry, account in await _rows(
                db, biz, (Entry.subject_type == "package") & (Entry.subject_id == package.id)
            )
            if account.category == "deferred" and entry.event == "payment"
        )
        share = min(remaining, paid // package.sessions_total)
    await post(
        db,
        biz,
        event="consumption",
        ref=f"consumption:{package.id}:{used}",
        legs=[
            Leg("package", package.id, "deferred", share),
            Leg("business", biz, "revenue", -share),
        ],
        currency=currency,
        subject=("package", package.id),
        keep_zero=True,
    )


async def deposit_held(db: AsyncSession, booking: Booking) -> int:
    return -await subject_balance(
        db, booking.business_id, category="deposit", subject_type="booking", subject_id=booking.id
    )


async def post_forfeit(db: AsyncSession, booking: Booking) -> None:
    held = await deposit_held(db, booking)
    await post(
        db,
        booking.business_id,
        event="forfeit",
        ref=f"forfeit:{booking.id}",
        legs=[
            Leg("business", booking.business_id, "deposit", held),
            Leg("business", booking.business_id, "revenue", -held),
        ],
        subject=("booking", booking.id),
    )


async def post_application(db: AsyncSession, booking: Booking, invoice: Invoice) -> int:
    """Apply a held deposit to the booking's invoice: the deposit pays down its receivable."""
    biz = booking.business_id
    applied = min(await deposit_held(db, booking), await invoice_balance(db, invoice))
    if applied <= 0:
        return 0
    await post(
        db,
        biz,
        event="application",
        ref=f"application:{booking.id}:{invoice.id}",
        legs=[
            Leg("business", biz, "deposit", applied, subject=("booking", booking.id)),
            Leg(
                *_payer(biz, invoice.client_id),
                "receivable",
                -applied,
                subject=("invoice", invoice.id),
            ),
        ],
        currency=invoice.currency,
        subject=("booking", booking.id),
    )
    return applied


async def applied_invoices(db: AsyncSession, booking: Booking) -> list[str]:
    """The invoices a booking's deposit currently counts toward (applied and not taken back)."""
    prefix = f"application:{booking.id}:"
    refs = set(
        (
            await db.execute(
                scoped(Entry, booking.business_id)
                .with_only_columns(Entry.ref)
                .where(Entry.ref.startswith(prefix), Entry.leg == 0)
            )
        )
        .scalars()
        .all()
    )
    return sorted(
        ref.removeprefix(prefix)
        for ref in refs
        if not ref.endswith(":reversal") and f"{ref}:reversal" not in refs
    )


async def reverse_application(db: AsyncSession, booking: Booking, invoice_id: str) -> None:
    ref = f"application:{booking.id}:{invoice_id}"
    journal = await journal_for(db, booking.business_id, ref)
    if journal is not None:
        await reverse(db, booking.business_id, journal, ref=f"{ref}:reversal")


async def reverse_forfeit(db: AsyncSession, booking: Booking) -> None:
    journal = await journal_for(db, booking.business_id, f"forfeit:{booking.id}")
    if journal is not None:
        await reverse(db, booking.business_id, journal, ref=f"forfeit:{booking.id}:refund")


async def run_reconcile_ledger(db: AsyncSession, gateway: PaymentGateway) -> int:
    """Compare every connected account's Stripe balance with the ledger's; audit each drift."""
    businesses = (
        (await db.execute(select(Business).where(Business.stripe_account_id.is_not(None))))
        .scalars()
        .all()
    )
    drifted = 0
    for business in businesses:
        assert business.stripe_account_id is not None
        ours = await balance(
            db, business.id, owner_type="business", owner_id=business.id, category="stripe"
        )
        theirs = await gateway.get_balance_cents(business.stripe_account_id, currency="CAD")
        if ours != theirs:
            drifted += 1
            db.add(
                Audit(
                    id=new_id("audit"),
                    business_id=business.id,
                    action="ledger.drift",
                    entity_type="business",
                    entity_id=business.id,
                    changes={"ledger_cents": ours, "stripe_cents": theirs},
                )
            )
    await db.commit()
    return drifted
