"""The ledger core: balanced, idempotent, append-only journals with cached account balances."""

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.ledger import Account, Entry
from clientbridge.services import ledger_service as ledger
from clientbridge.services.ledger_service import Leg, UnbalancedJournal
from tests.conftest import BIZ, Factory


def _sale(amount: int, client: str = "cl_x") -> list[Leg]:
    return [
        Leg("client", client, "receivable", amount),
        Leg("business", BIZ, "revenue", -amount),
    ]


async def _receivable(db: AsyncSession, client: str = "cl_x", business: str = BIZ) -> int:
    return await ledger.balance(
        db, business, owner_type="client", owner_id=client, kind="receivable"
    )


async def _revenue(db: AsyncSession) -> int:
    return await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, kind="revenue")


async def test_post_writes_balanced_legs_and_caches_balances(db: AsyncSession) -> None:
    revenue = await _revenue(db)
    journal = await ledger.post(db, BIZ, type="invoice", ref="t:inv1", legs=_sale(11500))

    rows = (
        (await db.execute(select(Entry).where(Entry.journal_id == journal).order_by(Entry.leg)))
        .scalars()
        .all()
    )
    assert [r.leg for r in rows] == [0, 1]
    assert sum(r.amount_cents for r in rows) == 0
    assert await _receivable(db) == 11500
    assert await _revenue(db) == revenue - 11500


async def test_post_accumulates_on_existing_accounts(db: AsyncSession) -> None:
    await ledger.post(db, BIZ, type="invoice", ref="t:a", legs=_sale(1000))
    await ledger.post(db, BIZ, type="invoice", ref="t:b", legs=_sale(250))

    assert await _receivable(db) == 1250
    count = await db.scalar(
        select(func.count()).select_from(Account).where(Account.owner_id == "cl_x")
    )
    assert count == 1


async def test_unbalanced_journal_is_rejected(db: AsyncSession) -> None:
    with pytest.raises(UnbalancedJournal):
        await ledger.post(
            db,
            BIZ,
            type="adjustment",
            ref="t:bad",
            legs=[Leg("client", "cl_x", "receivable", 100), Leg("business", BIZ, "revenue", -99)],
        )


async def test_zero_legs_are_dropped_and_an_empty_journal_is_skipped(db: AsyncSession) -> None:
    assert await ledger.post(db, BIZ, type="invoice", ref="t:zero", legs=_sale(0)) is None

    journal = await ledger.post(
        db,
        BIZ,
        type="invoice",
        ref="t:mixed",
        legs=[*_sale(500), Leg("business", BIZ, "tax", 0, "GST")],
    )
    legs = await db.scalar(select(func.count()).where(Entry.journal_id == journal))
    assert legs == 2


async def test_repeated_ref_replays_the_original_journal(db: AsyncSession) -> None:
    first = await ledger.post(db, BIZ, type="invoice", ref="t:once", legs=_sale(700))
    again = await ledger.post(db, BIZ, type="invoice", ref="t:once", legs=_sale(700))

    assert again == first
    assert await _receivable(db) == 700


async def test_reverse_negates_a_journal_once(db: AsyncSession) -> None:
    journal = await ledger.post(
        db, BIZ, type="invoice", ref="t:void", legs=_sale(900), subject=("invoice", "inv_x")
    )
    assert journal is not None

    reversal = await ledger.reverse(db, BIZ, journal, ref="t:void:reverse")
    replay = await ledger.reverse(db, BIZ, journal, ref="t:void:reverse")

    assert reversal is not None and replay == reversal
    assert await _receivable(db) == 0
    assert (
        await ledger.subject_balance(
            db, BIZ, kind="receivable", subject_type="invoice", subject_id="inv_x"
        )
        == 0
    )
    source = await db.scalar(select(Entry.source_id).where(Entry.journal_id == reversal).limit(1))
    assert source == journal


async def test_reverse_of_unknown_journal_is_a_noop(db: AsyncSession) -> None:
    assert await ledger.reverse(db, BIZ, "jrn_missing", ref="t:none") is None


async def test_subject_balance_sums_one_kind_per_entity(db: AsyncSession) -> None:
    await ledger.post(
        db,
        BIZ,
        type="invoice",
        ref="t:subj",
        legs=[
            Leg("client", "cl_x", "receivable", 1150),
            Leg("business", BIZ, "revenue", -1000),
            Leg("business", BIZ, "tax", -150, "GST", ("line", "ln_x")),
        ],
        subject=("invoice", "inv_s"),
    )

    receivable = await ledger.subject_balance(
        db, BIZ, kind="receivable", subject_type="invoice", subject_id="inv_s"
    )
    line_tax = await ledger.subject_balance(
        db, BIZ, kind="tax", subject_type="line", subject_id="ln_x"
    )
    assert (receivable, line_tax) == (1150, -150)


async def test_currencies_keep_separate_accounts(db: AsyncSession) -> None:
    await ledger.post(db, BIZ, type="invoice", ref="t:cad", legs=_sale(100))
    await ledger.post(db, BIZ, type="invoice", ref="t:usd", legs=_sale(300), currency="USD")

    assert await _receivable(db) == 100
    usd = await ledger.balance(
        db, BIZ, owner_type="client", owner_id="cl_x", kind="receivable", currency="USD"
    )
    assert usd == 300


async def test_balances_and_journals_are_tenant_scoped(db: AsyncSession) -> None:
    other = await Factory(db).business()
    journal = await ledger.post(db, BIZ, type="invoice", ref="t:tenant", legs=_sale(400))
    assert journal is not None

    assert await _receivable(db, business=other.id) == 0
    assert await ledger.reverse(db, other.id, journal, ref="t:tenant:x") is None
    assert (
        await ledger.subject_balance(
            db, other.id, kind="receivable", subject_type="invoice", subject_id="inv_x"
        )
        == 0
    )
    assert await _receivable(db) == 400


async def test_entries_are_append_only(db: AsyncSession) -> None:
    journal = await ledger.post(db, BIZ, type="invoice", ref="t:frozen", legs=_sale(100))

    with pytest.raises(DBAPIError, match="append-only"):
        async with db.begin_nested():
            await db.execute(
                text("UPDATE entries SET amount_cents = 1 WHERE journal_id = :j"), {"j": journal}
            )
    with pytest.raises(DBAPIError, match="append-only"):
        async with db.begin_nested():
            await db.execute(text("DELETE FROM entries WHERE journal_id = :j"), {"j": journal})


async def test_database_rejects_an_unbalanced_journal(db: AsyncSession) -> None:
    await ledger.post(db, BIZ, type="invoice", ref="t:seed", legs=_sale(100))
    account = await db.scalar(select(Account.id).where(Account.owner_id == "cl_x"))

    with pytest.raises(DBAPIError, match="does not balance"):
        async with db.begin_nested():
            await db.execute(text("SET CONSTRAINTS entries_balanced IMMEDIATE"))
            await db.execute(
                text(
                    "INSERT INTO entries (id, business_id, journal_id, account_id, owner_type, "
                    "owner_id, amount_cents, currency, type, ref, leg, meta) VALUES ('ent_x', :b, "
                    "'jrn_x', :a, 'client', 'cl_x', 5, 'CAD', 'adjustment', 't:raw', 0, '{}')"
                ),
                {"b": BIZ, "a": account},
            )
