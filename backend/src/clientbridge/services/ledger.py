from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import ColumnElement, Select, and_, case, event, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, Session, SessionTransaction, aliased

from clientbridge.core import clock
from clientbridge.core.errors import UnsupportedCurrency
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import ChargeFees
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services.lines import allocate, fetch_lines
from clientbridge.services.tax import TaxResult, issued_tax, tax_for_amount, tax_within

type AccountKey = tuple[str, str, str, str]
type _Id = InstrumentedAttribute[str] | str

PLATFORM = "clientbridge"
BUSINESS_CURRENCY = "CAD"
# adding a currency here is the switch; accounts are already keyed by currency
SUPPORTED_CURRENCIES = frozenset({BUSINESS_CURRENCY})
_CASH = {"stripe": "stripe", "manual": "cash"}
_CASH_CATEGORIES = ("stripe", "cash", "bank")
# cash legs that settle or unsettle a document: a dispute withdraws like a refund, a win restores
_MONEY_BACK_EVENTS = ("payment", "refund", "dispute")
# recorded by hand: cash sits in the till, a cheque or an e-Transfer already reached the bank
_BANKED_BY_HAND = ("cheque", "etransfer", "bank_eft")
# the credit-side kinds a refund unwinds pro rata (never the receivable: a refund is a credit note)
_UNWOUND = ("revenue", "tax", "deposit", "deferred", "gift_card")


def supported(currency: str) -> str:
    """The currency in canonical form, or refuse one the ledger can't book."""
    if currency.upper() not in SUPPORTED_CURRENCIES:
        raise UnsupportedCurrency(f"{currency.upper()} is not a supported currency")
    return currency.upper()


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
    currency = supported(currency)
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
    at = occurred_at or clock.now()
    for index, leg in enumerate(legs):
        account = accounts[leg.key]
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
    occurred_at: datetime | None = None,
    source: tuple[str, str] | None = None,
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
        source=source or ("journal", journal_id),
        meta=meta,
        occurred_at=occurred_at,
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
                _settled(),
            )
        )
    ).scalar_one()
    return int(value)


_LOCKED = "ledger_locked_accounts"


def _forget_locked(session: Session, transaction: SessionTransaction) -> None:
    # a savepoint's end can release locks and drop accounts it created, so forget them all then
    if transaction.parent is None or transaction.nested:
        session.info.pop(_LOCKED, None)


event.listen(Session, "after_transaction_end", _forget_locked)


async def _lock_accounts(
    db: AsyncSession, business_id: str, currency: str, keys: set[AccountKey]
) -> dict[AccountKey, Account]:
    # a row lock lasts until the transaction ends, so an account locked earlier in it stays locked
    held: dict[tuple[str, str, AccountKey], Account] = db.info.setdefault(_LOCKED, {})
    found = {key: held.get((business_id, currency, key)) for key in keys}
    if all(found.values()):
        return {key: account for key, account in found.items() if account is not None}
    locked = await _lock_new(db, business_id, currency, keys)
    for key, account in locked.items():
        held[(business_id, currency, key)] = account
    return locked


async def _lock_new(
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
    return and_(Entry.subject_type == subject_type, Entry.subject_id == subject_id, _settled())


def _settled() -> ColumnElement[bool]:
    """Dispute legs count against a document only once the dispute is lost."""
    lost = aliased(Entry)
    booked = select(lost.id).where(lost.source_id == Entry.source_id, _lost_journal(lost))
    return or_(Entry.event != "dispute", booked.exists())


def _lost_journal(entry: type[Entry]) -> ColumnElement[bool]:
    return and_(
        entry.source_type == "payment", entry.event == "dispute", entry.ref.like("dispute:%:lost")
    )


def _collected_expr(subject_type: str, subject_id: _Id) -> ColumnElement[int]:
    return (
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs(subject_type, subject_id),
            Account.category.in_(_CASH_CATEGORIES),
            Entry.event.in_(_MONEY_BACK_EVENTS),
        )
        .scalar_subquery()
    )


def _refunded_expr(subject_type: str, subject_id: _Id) -> ColumnElement[bool]:
    return (
        select(Entry.id)
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs(subject_type, subject_id),
            Account.category.in_(_CASH_CATEGORIES),
            Entry.event.in_(("refund", "dispute")),
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
        (Invoice.overdue_notified_at.is_not(None), "overdue"),
        (or_(paid > 0, _applied_expr() > 0), "partial"),
        else_="sent",
    )


def _applied_expr() -> ColumnElement[int]:
    """Visit deposits applied to an invoice and not taken back, which pay part of it."""
    return (
        select(func.coalesce(-func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            _subject_legs("invoice", Invoice.id),
            Account.category == "receivable",
            Entry.ref.startswith("application:"),
        )
        .scalar_subquery()
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


def _deposit_applied_expr(order_id: _Id) -> ColumnElement[int]:
    """Visit deposits a sale's payment applied (their legs belong to the booking, not the sale)."""
    return (
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .join(Payment, Payment.id == Entry.source_id)
        .where(
            Entry.source_type == "payment",
            Entry.event == "payment",
            Account.category == "deposit",
            Payment.order_id == order_id,
        )
        .scalar_subquery()
    )


async def order_deposit_applied(db: AsyncSession, order: Order) -> int:
    return int((await db.execute(select(_deposit_applied_expr(order.id)))).scalar_one())


def _gift_card_applied_expr(order_id: _Id) -> ColumnElement[int]:
    """Gift card balance redeemed against a sale, net of the reversal a refund or void posts."""
    return (
        select(func.coalesce(func.sum(Entry.amount_cents), 0))
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.source_type == "order",
            Entry.source_id == order_id,
            Account.category == "gift_card",
        )
        .scalar_subquery()
    )


async def order_gift_card_applied(db: AsyncSession, order: Order) -> int:
    return int((await db.execute(select(_gift_card_applied_expr(order.id)))).scalar_one())


def order_status_expr() -> ColumnElement[str]:
    """An order stores only open/void; whether it is paid or refunded comes from the ledger."""
    return _order_status(
        _collected_expr("order", Order.id),
        _deposit_applied_expr(Order.id) + _gift_card_applied_expr(Order.id),
        _refunded_expr("order", Order.id),
    )


def _order_status(
    paid: ColumnElement[int], applied: ColumnElement[int], refunded: ColumnElement[bool]
) -> ColumnElement[str]:
    covered = paid + applied
    return case(
        (Order.status == "void", "void"),
        (and_(paid <= 0, refunded), "refunded"),
        (and_(covered > 0, or_(covered >= Order.total_cents, refunded)), "paid"),
        else_="open",
    )


def held_orders(business_id: str) -> Select[tuple[Order]]:
    cash = (
        scoped(Entry, business_id)
        .join(Account, Account.id == Entry.account_id)
        .with_only_columns(
            Entry.subject_id.label("order_id"),
            func.sum(Entry.amount_cents).label("paid"),
            func.bool_or(Entry.event.in_(("refund", "dispute"))).label("refunded"),
        )
        .where(
            Entry.subject_type == "order",
            _settled(),
            Account.category.in_(_CASH_CATEGORIES),
            Entry.event.in_(_MONEY_BACK_EVENTS),
        )
        .group_by(Entry.subject_id)
        .subquery()
    )
    deposits = (
        scoped(Entry, business_id)
        .join(Account, Account.id == Entry.account_id)
        .join(Payment, Payment.id == Entry.source_id)
        .with_only_columns(Payment.order_id, func.sum(Entry.amount_cents).label("applied"))
        .where(
            Entry.source_type == "payment",
            Entry.event == "payment",
            Account.category == "deposit",
            Payment.order_id.is_not(None),
        )
        .group_by(Payment.order_id)
        .subquery()
    )
    gift_cards = (
        scoped(Entry, business_id)
        .join(Account, Account.id == Entry.account_id)
        .with_only_columns(
            Entry.source_id.label("order_id"), func.sum(Entry.amount_cents).label("applied")
        )
        .where(Entry.source_type == "order", Account.category == "gift_card")
        .group_by(Entry.source_id)
        .subquery()
    )
    status = _order_status(
        func.coalesce(cash.c.paid, 0),
        func.coalesce(deposits.c.applied, 0) + func.coalesce(gift_cards.c.applied, 0),
        func.coalesce(cash.c.refunded, False),
    )
    return (
        scoped(Order, business_id)
        .outerjoin(cash, cash.c.order_id == Order.id)
        .outerjoin(deposits, deposits.c.order_id == Order.id)
        .outerjoin(gift_cards, gift_cards.c.order_id == Order.id)
        .where(Order.source == "pos", Order.status == "open", status == "open")
        .order_by(Order.created_at)
    )


def order_paid_at_expr() -> ColumnElement[datetime | None]:
    settled = (
        select(func.max(Entry.occurred_at))
        .join(Account, Account.id == Entry.account_id)
        .where(
            or_(
                and_(
                    _subject_legs("order", Order.id),
                    Account.category.in_(_CASH_CATEGORIES),
                    Entry.event == "payment",
                ),
                and_(
                    Entry.source_type == "order",
                    Entry.source_id == Order.id,
                    Entry.event == "redemption",
                ),
            )
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
        _subject_legs(subject_type, subject_id) & Entry.event.in_(_MONEY_BACK_EVENTS),
    )
    cash = [(e, a) for e, a in rows if a.category in _CASH_CATEGORIES]
    return sum(e.amount_cents for e, _ in cash), any(e.event != "payment" for e, _ in cash)


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
    await post_tips(db, payment, tip_shares(payment), ref=f"tip:{payment.id}")


async def _settlement(db: AsyncSession, payment: Payment) -> tuple[tuple[str, str], list[Leg]]:
    """What a settled payment pays for — the credit side of its journal."""
    biz, amount = payment.business_id, payment.amount_cents
    tip = _tip_contra(payment)
    if payment.invoice_id is not None:
        payer = _payer(biz, payment.client_id)
        net = amount - payment.tip_cents
        return ("invoice", payment.invoice_id), [Leg(*payer, "receivable", -net), *tip]
    if payment.order_id is not None:
        return ("order", payment.order_id), [*await _order_sale(db, payment), *tip]
    if payment.booking_id is not None:
        return ("booking", payment.booking_id), [Leg("business", biz, "deposit", -amount)]
    package = (
        await db.execute(scoped(Package, biz).where(Package.payment_id == payment.id))
    ).scalar_one_or_none()
    if package is not None:
        tax = await _package_tax(db, payment, await db.get(Item, package.item_id))
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


async def _package_tax(db: AsyncSession, payment: Payment, item: Item | None) -> TaxResult:
    """The tax charged in a package's price when it was sold, backed out of the paid total."""
    biz, amount, sold = payment.business_id, payment.amount_cents, payment.created_at
    tax_class = item.tax_class if item is not None else "standard"
    if item is not None:
        # registration may have changed since the sale, so match the price as either
        for registered in (True, False):
            priced = await tax_for_amount(
                db, biz, item.price_cents, tax_class=tax_class, at=sold, registered=registered
            )
            if priced.total_cents == amount:
                return priced
    return await tax_within(db, biz, amount, tax_class=tax_class, at=sold)


def _tip_contra(payment: Payment) -> list[Leg]:
    """A tip is not the business's money: it passes through to the staff tip journals."""
    if payment.tip_cents <= 0:
        return []
    return [Leg("business", payment.business_id, "staff_cost", -payment.tip_cents)]


async def _order_sale(db: AsyncSession, payment: Payment) -> list[Leg]:
    """A sale's revenue and the tax gift cards haven't booked, with held deposits applied."""
    biz = payment.business_id
    assert payment.order_id is not None
    order, lines, tax = await _order_tax(db, biz, payment.order_id, payment.created_at)
    booked = await _redeemed_tax(db, biz, payment.order_id)
    tax = _without(tax, booked)
    paid = payment.amount_cents - payment.tip_cents
    want = (order.total_cents if order is not None else paid) - paid
    applied: list[Leg] = []
    for booking_id in dict.fromkeys(ln.booking_id for ln in lines if ln.booking_id):
        booking = await db.get(Booking, booking_id)
        take = min(want, await deposit_held(db, booking)) if booking is not None else 0
        if take > 0:
            applied.append(Leg("business", biz, "deposit", take, subject=("booking", booking_id)))
            want -= take
    return [*applied, *_sale_legs(biz, paid + sum(leg.amount_cents for leg in applied), tax)]


async def post_tips(
    db: AsyncSession,
    payment: Payment,
    shares: list[tuple[str, int]],
    *,
    ref: str,
    sign: int = 1,
    occurred_at: datetime | None = None,
    source_id: str | None = None,
) -> None:
    """One tip journal per staff member, owed to them like an earning (a negative one on refund)."""
    subject, _ = await _settlement(db, payment)
    for staff_id, cents in shares:
        if cents <= 0:
            continue
        meta: dict[str, object] = {"basis": "tip", "client_id": payment.client_id}
        tipped = (
            await journal_for(db, payment.business_id, f"tip:{payment.id}:{staff_id}")
            if sign < 0
            else None
        )
        if tipped is not None:
            # a returned tip settles with the tip it returns, like a clawback with its earning
            meta["of"] = tipped
        await post(
            db,
            payment.business_id,
            event="tip",
            ref=f"{ref}:{staff_id}",
            legs=[
                Leg("business", payment.business_id, "staff_cost", sign * cents),
                Leg("staff", staff_id, "payable", -sign * cents, "pending"),
            ],
            currency=payment.currency,
            source=("payment", source_id or payment.id),
            subject=subject,
            occurred_at=occurred_at or payment.paid_at,
            meta=meta,
        )


def tip_shares(payment: Payment) -> list[tuple[str, int]]:
    return [(str(s["staff_id"]), int(str(s["cents"]))) for s in payment.tip_split or []]


async def document_tips(db: AsyncSession, business_id: str, subject: tuple[str, str]) -> int:
    """Tips paid on an invoice or order, less what refunds and lost disputes returned."""
    rows = await _rows(db, business_id, _subject_legs(*subject) & (Entry.event != "tip"))
    return -sum(entry.amount_cents for entry, account in rows if account.category == "staff_cost")


async def amount_kept(
    db: AsyncSession, business_id: str, subject: tuple[str, str], category: str
) -> tuple[int, int]:
    """(still kept, first booked) of a document's revenue or a package's deferred revenue."""
    # sessions used and breakage recognize revenue; only refunds and disputes give money back
    rows = await _rows(
        db,
        business_id,
        _subject_legs(*subject)
        & (Account.category == category)
        & Entry.event.not_in(("consumption", "breakage")),
    )
    booked = -sum(
        entry.amount_cents
        for entry, _ in rows
        if entry.event not in ("refund", "dispute", "reversal")
    )
    return -sum(entry.amount_cents for entry, _ in rows), booked


async def tip_returned(db: AsyncSession, original: Payment, returned: int, refund_id: str) -> int:
    """The tip's pro rata part of a refund; the last refund returns exactly what is left of it."""
    if original.tip_cents <= 0:
        return 0
    earlier = (
        scoped(Payment, original.business_id)
        .with_only_columns(Payment.id)
        .where(
            Payment.kind == "refund",
            Payment.parent_payment_id == original.id,
            Payment.status == "succeeded",
            Payment.id != refund_id,
        )
    )
    rows = await _rows(
        db,
        original.business_id,
        (Entry.event == "refund") & Entry.source_id.in_(earlier.scalar_subquery()),
    )
    prior_cash = -sum(e.amount_cents for e, a in rows if a.category in _CASH_CATEGORIES)
    prior_tip = sum(e.amount_cents for e, a in rows if a.category == "staff_cost")
    done = min(original.amount_cents, prior_cash + returned)
    return original.tip_cents * done // original.amount_cents - prior_tip


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
    refund_id: str,
    credits: list[tuple[Entry, Account]],
    base: int,
    returned: int,
) -> list[Leg]:
    """Each credit leg's share still to unwind, so the final refund clears every leg exactly."""
    refunds = scoped(Payment, original.business_id).where(
        Payment.kind == "refund",
        Payment.status == "succeeded",
        Payment.id != refund_id,
        Payment.invoice_id == original.invoice_id
        if original.invoice_id
        else Payment.parent_payment_id == original.id,
    )
    lost = scoped(Entry, original.business_id).where(_lost_journal(Entry))
    disputed = scoped(Payment, original.business_id).where(
        Payment.kind != "refund",
        Payment.id.in_(lost.with_only_columns(Entry.source_id).scalar_subquery()),
        Payment.invoice_id == original.invoice_id
        if original.invoice_id
        else Payment.id == original.id,
    )
    owed: dict[str, tuple[Account, int]] = {}
    for entry, account in credits:
        owed[account.id] = (account, owed.get(account.id, (account, 0))[1] - entry.amount_cents)
    prior_rows = await _rows(
        db,
        original.business_id,
        Entry.account_id.in_(owed)
        & or_(
            (Entry.event == "refund")
            & Entry.source_id.in_(refunds.with_only_columns(Payment.id).scalar_subquery()),
            (Entry.event == "dispute")
            & Entry.source_id.in_(disputed.with_only_columns(Payment.id).scalar_subquery()),
        ),
    )
    prior: dict[str, int] = {}
    for entry, _ in prior_rows:
        prior[entry.account_id] = prior.get(entry.account_id, 0) + entry.amount_cents
    unwound = sum(prior.values())
    done = min(unwound + returned, base)
    shares = [
        (a, credit * done // base - prior.get(a.id, 0), credit) for a, credit in owed.values()
    ]
    largest = max(range(len(shares)), key=lambda i: shares[i][2])
    short = done - unwound - sum(cents for _, cents, _ in shares)
    legs = [
        Leg(
            a.owner_type,
            a.owner_id,
            a.category,
            await _within_holding(db, a, cents + (short if i == largest else 0)),
            a.code,
        )
        for i, (a, cents, _) in enumerate(shares)
    ]
    # money returned beyond what the sale still carries was lost twice, never a negative sale
    lost = returned - sum(leg.amount_cents for leg in legs)
    if lost > 0:
        legs.append(Leg("business", original.business_id, "loss", lost))
    return legs


async def _within_holding(db: AsyncSession, account: Account, cents: int) -> int:
    """A gift card or package gives back only what it still holds; the used part is spent."""
    if account.owner_type not in ("gift_card", "package"):
        return cents
    held = await db.scalar(select(Account.balance_cents).where(Account.id == account.id))
    return min(cents, max(0, -(held or 0)))


async def refund_legs(
    db: AsyncSession,
    original: Payment,
    returned: int,
    *,
    refund_id: str = "",
    unapplied: bool = False,
) -> list[Leg]:
    """What returning `returned` of a payment unwinds, part by part (the credit note's split)."""
    biz = original.business_id
    basis = f"invoice:{original.invoice_id}" if original.invoice_id else f"payment:{original.id}"
    credits = [
        (entry, account)
        for entry, account in await _rows(db, biz, Entry.ref == basis)
        if account.category in _UNWOUND and entry.amount_cents < 0
    ]
    tip = await tip_returned(db, original, returned, refund_id)
    tip_legs = [Leg("business", biz, "staff_cost", tip)] if tip else []
    if unapplied:
        # the payment never paid the invoice off, so only the receivable it credited comes back
        return [Leg(*_payer(biz, original.client_id), "receivable", returned - tip), *tip_legs]
    base = -sum(entry.amount_cents for entry, _ in credits)
    if base <= 0:
        return [Leg("business", biz, "revenue", returned - tip), *tip_legs]
    return [*await _unwind(db, original, refund_id, credits, base, returned - tip), *tip_legs]


async def post_fee_return(db: AsyncSession, payment: Payment, refund_id: str) -> None:
    """Our application fee goes back to the business with a refund we made for our own reasons."""
    biz = payment.business_id
    rows = await _rows(db, biz, Entry.ref == f"fee:{payment.id}")
    app = sum(e.amount_cents for e, a in rows if a.category == "platform_fee" and a.owner_id == biz)
    if app <= 0:
        return
    await post(
        db,
        biz,
        event="fee",
        ref=f"fee_return:{refund_id}",
        legs=[
            Leg("business", biz, "platform_fee", -app),
            Leg("business", biz, "stripe", app),
            Leg("platform", PLATFORM, "stripe", -app),
            Leg("platform", PLATFORM, "fee_revenue", app),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
    )


async def payment_fee(db: AsyncSession, payment: Payment) -> int:
    """The Stripe and platform fee booked for a charge (kept when it is refunded)."""
    rows = await _rows(db, payment.business_id, Entry.ref == f"fee:{payment.id}")
    return sum(
        entry.amount_cents
        for entry, account in rows
        if account.category in ("processing_fee", "platform_fee")
    )


async def post_refund(
    db: AsyncSession,
    refund: Payment,
    original: Payment,
    *,
    amount: int | None = None,
    ref: str | None = None,
    unapplied: bool = False,
) -> None:
    """Return the money and unwind what it paid for, pro rata."""
    biz = original.business_id
    returned = refund.amount_cents if amount is None else amount
    legs = await refund_legs(db, original, returned, refund_id=refund.id, unapplied=unapplied)
    subject, _ = await _settlement(db, original)
    tip = sum(leg.amount_cents for leg in legs if leg.category == "staff_cost")
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
    if tip > 0:
        split = tip_shares(original)
        back = allocate(tip, [cents for _, cents in split])
        await post_tips(
            db,
            original,
            [(staff_id, cents) for (staff_id, _), cents in zip(split, back, strict=True)],
            ref=f"tip:{refund.id}",
            sign=-1,
            occurred_at=refund.paid_at,
            source_id=refund.id,
        )


async def reverse_refund(db: AsyncSession, refund: Payment, original: Payment) -> None:
    """Stripe failed a refund it had marked succeeded: the money is back, so undo its journals."""
    biz = original.business_id
    source = ("payment", refund.id)  # reports join payments on the source, so keep the refund's
    journal = await journal_for(db, biz, f"refund:{refund.id}")
    if journal is not None:
        await reverse(
            db, biz, journal, ref=f"refund:{refund.id}:failed", event="refund", source=source
        )
    for staff_id, _ in tip_shares(original):
        tip = await journal_for(db, biz, f"tip:{refund.id}:{staff_id}")
        # an unpaid returned tip was cancelled outright (earnings.cancel_returned_tips)
        if tip is not None and await journal_for(db, biz, f"earning:{tip}:reversal") is None:
            await reverse(
                db,
                biz,
                tip,
                ref=f"tip:{refund.id}:{staff_id}:failed",
                event="tip",
                source=source,
                meta={"basis": "tip", "client_id": original.client_id},
            )


async def post_dispute(
    db: AsyncSession,
    payment: Payment,
    *,
    dispute_id: str,
    amount: int,
    fee: int,
    occurred_at: datetime | None = None,
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
        occurred_at=occurred_at,
    )
    fee_ref = f"dispute_fee:{dispute_id}"
    rows = await _rows(
        db, biz, or_(Entry.ref == fee_ref, Entry.ref.startswith(f"{fee_ref}:", autoescape=True))
    )
    recorded = sum(
        entry.amount_cents
        for entry, account in rows
        if account.category == "processing_fee" and entry.amount_cents > 0
    )
    if fee <= recorded:
        return
    await post(
        db,
        biz,
        event="fee",
        ref=fee_ref if recorded == 0 else f"{fee_ref}:{fee}",
        legs=[
            Leg("business", biz, "processing_fee", fee - recorded),
            Leg("business", biz, "stripe", recorded - fee),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
        occurred_at=occurred_at,
    )


async def close_dispute(
    db: AsyncSession, payment: Payment, dispute_id: str, *, returned_fee: int = 0
) -> None:
    """A won dispute: Stripe reinstates the amount and returns whatever part of the fee it does."""
    business_id = payment.business_id
    journal = await journal_for(db, business_id, f"dispute:{dispute_id}")
    if journal is not None:
        await reverse(
            db,
            business_id,
            journal,
            ref=f"dispute:{dispute_id}:won",
            event="dispute",
            source=("payment", payment.id),
        )
    fee_ref = f"dispute_fee:{dispute_id}"
    fee_rows = await _rows(
        db,
        business_id,
        or_(Entry.ref == fee_ref, Entry.ref.startswith(f"{fee_ref}:", autoescape=True)),
    )
    returned = -sum(
        entry.amount_cents
        for entry, account in fee_rows
        if account.category == "processing_fee" and entry.amount_cents < 0
    )
    if returned_fee <= returned or not fee_rows:
        return
    entry = fee_rows[0][0]
    await post(
        db,
        business_id,
        event="fee",
        ref=f"{fee_ref}:won" if returned == 0 else f"{fee_ref}:won:{returned_fee}",
        legs=[
            Leg("business", business_id, "processing_fee", returned - returned_fee),
            Leg("business", business_id, "stripe", returned_fee - returned),
        ],
        currency=entry.currency,
        source=(entry.source_type, entry.source_id)
        if entry.source_type and entry.source_id
        else None,
        subject=(entry.subject_type, entry.subject_id)
        if entry.subject_type and entry.subject_id
        else None,
    )


async def lose_dispute(
    db: AsyncSession,
    payment: Payment,
    *,
    dispute_id: str,
    amount: int,
    occurred_at: datetime | None = None,
) -> None:
    """A lost dispute: the receivable is uncollectable, so unwind the sale like a refund."""
    biz = payment.business_id
    if await journal_for(db, biz, f"dispute:{dispute_id}") is None:
        return
    legs = await refund_legs(db, payment, amount)
    subject, _ = await _settlement(db, payment)
    tip = sum(leg.amount_cents for leg in legs if leg.category == "staff_cost")
    await post(
        db,
        biz,
        event="dispute",
        ref=f"dispute:{dispute_id}:lost",
        legs=[Leg(*_payer(biz, payment.client_id), "receivable", -amount), *legs],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
        occurred_at=occurred_at,
    )
    if tip > 0:
        split = tip_shares(payment)
        back = allocate(tip, [cents for _, cents in split])
        await post_tips(
            db,
            payment,
            [(staff_id, cents) for (staff_id, _), cents in zip(split, back, strict=True)],
            ref=f"tip:dispute:{dispute_id}",
            sign=-1,
            occurred_at=occurred_at,
        )


async def reinstate_dispute(
    db: AsyncSession, payment: Payment, dispute_id: str, *, amount: int, net: int
) -> None:
    """Funds Stripe hands back on a lost dispute, such as a part refunded first, reduce the loss."""
    biz = payment.business_id
    if amount <= 0 or await journal_for(db, biz, f"dispute:{dispute_id}:lost") is None:
        return
    ref = f"dispute:{dispute_id}:reinstated"
    rows = await _rows(
        db, biz, or_(Entry.ref == ref, Entry.ref.startswith(f"{ref}:", autoescape=True))
    )
    booked = -sum(e.amount_cents for e, a in rows if a.category == "loss")
    booked_net = sum(e.amount_cents for e, a in rows if a.category == "stripe")
    if amount <= booked:
        return
    subject, _ = await _settlement(db, payment)
    await post(
        db,
        biz,
        event="dispute",
        ref=ref if not rows else f"{ref}:{amount}",
        legs=[
            Leg("business", biz, "stripe", net - booked_net),
            Leg("business", biz, "loss", booked - amount),
            Leg("business", biz, "processing_fee", amount - booked - (net - booked_net)),
        ],
        currency=payment.currency,
        source=("payment", payment.id),
        subject=subject,
    )


async def post_payout(
    db: AsyncSession,
    business_id: str,
    *,
    payout_id: str,
    amount: int,
    currency: str,
    arrival_at: datetime | None,
    occurred_at: datetime | None,
) -> None:
    """Stripe's balance drops when it creates the payout; the money is in transit until arrival."""
    await post(
        db,
        business_id,
        event="payout",
        ref=f"payout:{payout_id}",
        legs=[
            Leg("business", business_id, "transit", amount),
            Leg("business", business_id, "stripe", -amount),
        ],
        currency=currency,
        source=("stripe_payout", payout_id),
        occurred_at=occurred_at,
        available_at=arrival_at,
    )


async def arrive_payout(
    db: AsyncSession,
    business_id: str,
    *,
    payout_id: str,
    amount: int,
    currency: str,
    arrival_at: datetime,
) -> None:
    """Deposited when Stripe says it was paid, dated at its arrival; never after a failure."""
    if await journal_for(db, business_id, f"payout:{payout_id}:failed") is not None:
        return
    await post(
        db,
        business_id,
        event="payout",
        ref=f"payout:{payout_id}:paid",
        legs=[
            Leg("business", business_id, "bank", amount),
            Leg("business", business_id, "transit", -amount),
        ],
        currency=currency,
        source=("stripe_payout", payout_id),
        occurred_at=arrival_at,
        available_at=arrival_at,
    )


async def fail_payout(
    db: AsyncSession, business_id: str, payout_id: str, *, occurred_at: datetime | None = None
) -> None:
    for ref in (f"payout:{payout_id}", f"payout:{payout_id}:paid"):
        journal = await journal_for(db, business_id, ref)
        if journal is not None:
            await reverse(db, business_id, journal, ref=f"{ref}:failed", occurred_at=occurred_at)


async def gift_card_balance(db: AsyncSession, card: GiftCard) -> int:
    return -await balance(
        db, card.business_id, owner_type="gift_card", owner_id=card.id, category="gift_card"
    )


def gift_card_status(card: GiftCard, balance_cents: int) -> str:
    """A spent card stays `active` in storage and reads as `redeemed`."""
    return "redeemed" if card.status == "active" and balance_cents == 0 else card.status


async def _order_tax(
    db: AsyncSession, biz: str, order_id: str, fallback: datetime
) -> tuple[Order | None, list[Line], TaxResult]:
    lines = await fetch_lines(db, biz, "order", order_id)
    order = await db.get(Order, order_id)
    return order, lines, await issued_tax(db, biz, lines, order.created_at if order else fallback)


async def _redeemed_tax(db: AsyncSession, biz: str, order_id: str) -> dict[str, int]:
    """The tax gift cards have booked on a sale so far, by code, net of their reversals."""
    rows = await db.execute(
        scoped(Entry, biz)
        .join(Account, Account.id == Entry.account_id)
        .where(Entry.source_type == "order", Entry.source_id == order_id, Account.category == "tax")
        .with_only_columns(Account.code, func.sum(Entry.amount_cents))
        .group_by(Account.code)
    )
    return {code: -int(cents) for code, cents in rows.tuples().all() if cents}


def _without(tax: TaxResult, booked: dict[str, int]) -> TaxResult:
    left = {code: cents - booked.get(code, 0) for code, cents in tax.by_jurisdiction.items()}
    return replace(tax, tax_total_cents=sum(left.values()), by_jurisdiction=left)


async def _redemption_tax(db: AsyncSession, biz: str, order_id: str, amount: int) -> TaxResult:
    """A redemption's share of the sale's tax: a gift card is taxed when it pays for something."""
    order, _, tax = await _order_tax(db, biz, order_id, clock.now())
    if order is None or order.total_cents <= 0:
        return _without(tax, tax.by_jurisdiction)
    applied = int(await db.scalar(select(_gift_card_applied_expr(order_id))) or 0)
    covered = min(order.total_cents, applied + amount)
    # shares of the running total, so redemptions that cover the sale book exactly its tax
    through = {
        code: allocate(cents, [covered, order.total_cents - covered])[0]
        for code, cents in tax.by_jurisdiction.items()
    }
    return _without(replace(tax, by_jurisdiction=through), await _redeemed_tax(db, biz, order_id))


async def post_redemption(
    db: AsyncSession, card: GiftCard, amount: int, *, source: tuple[str, str] | None = None
) -> None:
    remaining = await gift_card_balance(db, card)
    biz = card.business_id
    tax = (
        await _redemption_tax(db, biz, source[1], amount)
        if source is not None and source[0] == "order"
        else None
    )
    await post(
        db,
        biz,
        event="redemption",
        ref=f"redemption:{card.id}:{source[1]}:{new_id('journal')}"
        if source
        else f"redemption:{card.id}:{remaining}",
        legs=[
            Leg("gift_card", card.id, "gift_card", amount),
            *(
                _sale_legs(biz, amount, tax)
                if tax is not None
                else [Leg("business", biz, "revenue", -amount)]
            ),
        ],
        currency=await _subject_currency(
            db, card.business_id, category="gift_card", subject_type="gift_card", subject_id=card.id
        ),
        subject=("gift_card", card.id),
        source=source,
    )


async def reverse_order_redemptions(db: AsyncSession, order: Order) -> None:
    """Give back the gift card balance a refunded or voided sale had used, once per redemption."""
    journals = await db.scalars(
        scoped(Entry, order.business_id)
        .with_only_columns(Entry.journal_id)
        .where(
            Entry.source_type == "order",
            Entry.source_id == order.id,
            Entry.event == "redemption",
        )
        .distinct()
    )
    for journal in journals.all():
        await reverse(
            db,
            order.business_id,
            journal,
            ref=f"redemption:{journal}:reversal",
            source=("order", order.id),
        )


async def _owned(
    db: AsyncSession, business_id: str, owner_type: str, owner_id: str, category: str
) -> tuple[int, str]:
    """What an entity's own liability account still holds, in the currency it was bought in."""
    row = (
        await db.execute(
            scoped(Account, business_id)
            .with_only_columns(Account.balance_cents, Account.currency)
            .where(
                Account.owner_type == owner_type,
                Account.owner_id == owner_id,
                Account.category == category,
            )
        )
    ).one_or_none()
    return (0, "CAD") if row is None else (-int(row[0]), str(row[1]))


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


async def post_consumption(
    db: AsyncSession,
    package: Package,
    *,
    occurred_at: datetime | None = None,
    booking_id: str | None = None,
) -> int:
    """Recognize one used session's share of prepaid package revenue (the last takes the rest)."""
    if booking_id is not None:
        booking = await db.get(Booking, booking_id)
        if booking is None or (
            booking.business_id,
            booking.client_id,
            booking.package_id,
            booking.status,
        ) != (package.business_id, package.client_id, package.id, "completed"):
            raise ValueError("package consumption needs its completed owned booking")
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
        ref=f"consumption:{package.id}:booking:{booking_id}"
        if booking_id
        else f"consumption:{package.id}:{used}",
        legs=[
            Leg("package", package.id, "deferred", share),
            Leg("business", biz, "revenue", -share),
        ],
        currency=currency,
        subject=("package", package.id),
        keep_zero=True,
        occurred_at=occurred_at,
        source=("booking", booking_id) if booking_id else None,
    )
    return share


async def deposit_held(db: AsyncSession, booking: Booking) -> int:
    return -await subject_balance(
        db, booking.business_id, category="deposit", subject_type="booking", subject_id=booking.id
    )


async def _subject_currency(
    db: AsyncSession, business_id: str, *, category: str, subject_type: str, subject_id: str
) -> str:
    """The currency an entity's legs were booked in (its deposit, its card balance)."""
    row = await db.execute(
        scoped(Entry, business_id)
        .with_only_columns(Entry.currency)
        .join(Account, Account.id == Entry.account_id)
        .where(
            Entry.subject_type == subject_type,
            Entry.subject_id == subject_id,
            Account.category == category,
        )
        .limit(1)
    )
    return row.scalar_one_or_none() or BUSINESS_CURRENCY


async def post_forfeit(db: AsyncSession, booking: Booking) -> None:
    await _move_forfeit(db, booking, await deposit_held(db, booking), f"forfeit:{booking.id}")


async def post_application(
    db: AsyncSession, booking: Booking, invoice: Invoice, *, again: str | None = None
) -> int:
    """Apply a held deposit to the booking's invoice: the deposit pays down its receivable."""
    biz = booking.business_id
    applied = min(await deposit_held(db, booking), await invoice_balance(db, invoice))
    if applied <= 0:
        return 0
    await post(
        db,
        biz,
        event="application",
        ref=f"application:{booking.id}:{invoice.id}" + (f":again:{again}" if again else ""),
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
    return sorted(
        {ref.removeprefix(prefix).split(":")[0] for ref in await _applications(db, booking)}
    )


async def reverse_application(db: AsyncSession, booking: Booking, invoice_id: str) -> None:
    for ref in await _applications(db, booking):
        if ref.startswith(f"application:{booking.id}:{invoice_id}"):
            journal = await journal_for(db, booking.business_id, ref)
            if journal is not None:
                await reverse(db, booking.business_id, journal, ref=f"{ref}:reversal")


async def _applications(db: AsyncSession, booking: Booking) -> list[str]:
    """Refs of the booking's application journals that have not been reversed."""
    refs = set(
        (
            await db.execute(
                scoped(Entry, booking.business_id)
                .with_only_columns(Entry.ref)
                .where(Entry.ref.startswith(f"application:{booking.id}:"), Entry.leg == 0)
            )
        )
        .scalars()
        .all()
    )
    return sorted(
        ref for ref in refs if not ref.endswith(":reversal") and f"{ref}:reversal" not in refs
    )


async def reverse_forfeit(db: AsyncSession, booking: Booking, key: str) -> None:
    """Money leaving a deposit (refund `key` or lost dispute `key`) takes its forfeit back."""
    rows = await _rows(
        db,
        booking.business_id,
        or_(
            Entry.ref == f"forfeit:{booking.id}",
            Entry.ref.startswith(f"forfeit:{booking.id}:", autoescape=True),
        ),
    )
    forfeited = -sum(entry.amount_cents for entry, account in rows if account.category == "revenue")
    if forfeited > 0:
        await _move_forfeit(db, booking, -forfeited, f"forfeit:{booking.id}:back:{key}")


async def restore_forfeit(db: AsyncSession, booking: Booking, key: str) -> int:
    """A refund that failed after taking a forfeit back forfeits that money again."""
    rows = await _rows(db, booking.business_id, Entry.ref == f"forfeit:{booking.id}:back:{key}")
    taken = sum(entry.amount_cents for entry, account in rows if account.category == "revenue")
    if taken > 0:
        await _move_forfeit(db, booking, taken, f"forfeit:{booking.id}:restore:{key}")
    return max(taken, 0)


async def _move_forfeit(db: AsyncSession, booking: Booking, cents: int, ref: str) -> None:
    await post(
        db,
        booking.business_id,
        event="forfeit",
        ref=ref,
        legs=[
            Leg("business", booking.business_id, "deposit", cents),
            Leg("business", booking.business_id, "revenue", -cents),
        ],
        currency=await _subject_currency(
            db,
            booking.business_id,
            category="deposit",
            subject_type="booking",
            subject_id=booking.id,
        ),
        subject=("booking", booking.id),
    )


async def stale_accounts(db: AsyncSession, business_id: str) -> list[str]:
    """Accounts whose cached balance is not the sum of their entries."""
    totals = (
        scoped(Entry, business_id)
        .with_only_columns(Entry.account_id, func.sum(Entry.amount_cents).label("total"))
        .group_by(Entry.account_id)
        .subquery()
    )
    rows = await db.execute(
        scoped(Account, business_id)
        .with_only_columns(Account.id)
        .join(totals, totals.c.account_id == Account.id, isouter=True)
        .where(Account.balance_cents != func.coalesce(totals.c.total, 0))
        .order_by(Account.id)
    )
    return list(rows.scalars().all())


async def post_stripe_fee(
    db: AsyncSession, business_id: str, identity: str, net: int, occurred_at: datetime
) -> str:
    ref = f"stripe_fee:{identity}"
    await post(
        db,
        business_id,
        event="fee",
        ref=ref,
        legs=[
            Leg("business", business_id, "stripe", net),
            Leg("business", business_id, "processing_fee", -net),
        ],
        source=("stripe_transaction", identity),
        occurred_at=occurred_at,
    )
    return ref


def orphaned() -> ColumnElement[bool]:
    """Legs of a charge refunded because no sale was recorded for it; never revenue."""
    return Entry.ref.startswith("orphan:")


async def post_orphan(
    db: AsyncSession,
    business_id: str,
    transaction_id: str,
    intent_id: str,
    amount: int,
    processing_fee: int,
    application_fee: int,
    occurred_at: datetime,
) -> str:
    ref = f"orphan:{transaction_id}"
    await post(
        db,
        business_id,
        event="fee" if amount == 0 else "payment" if amount > 0 else "refund",
        ref=ref,
        legs=[
            Leg("business", business_id, "stripe", amount - processing_fee - application_fee),
            Leg("business", business_id, "payable", -amount, code="orphan"),
            Leg("business", business_id, "processing_fee", processing_fee),
            Leg("business", business_id, "platform_fee", application_fee),
            Leg("platform", PLATFORM, "stripe", application_fee),
            Leg("platform", PLATFORM, "fee_revenue", -application_fee),
        ],
        source=("stripe_transaction", transaction_id),
        subject=("payment_intent", intent_id),
        occurred_at=occurred_at,
    )
    return ref
