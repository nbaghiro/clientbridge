from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.ledger import Account, Entry

type AccountKey = tuple[str, str, str, str]


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
    existing = (
        await db.execute(scoped(Entry, business_id).where(Entry.ref == ref).limit(1))
    ).scalar_one_or_none()
    if existing is not None:
        return existing.journal_id
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
    rows = (
        await db.execute(
            scoped(Entry, business_id)
            .add_columns(Account)
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.journal_id == journal_id)
            .order_by(Entry.leg)
        )
    ).all()
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
