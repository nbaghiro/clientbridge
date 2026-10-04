"""Breakage: the unspent balance of an expired gift card or package is recognized as revenue."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.crm import Client
from clientbridge.models.ledger import Entry
from clientbridge.services import ledger_service as ledger
from clientbridge.services.ledger_service import Leg
from clientbridge.tasks.maintenance import run_expiry_sweeps
from tests.conftest import BIZ, Factory

NOW = datetime(2020, 1, 1, tzinfo=UTC)  # past, so the global sweep only sees rows planted here
LAPSED = NOW - timedelta(days=1)


async def _card(
    db: AsyncSession,
    *,
    balance: int,
    spent: int = 0,
    expires_at: datetime = LAPSED,
    business_id: str = BIZ,
) -> str:
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=business_id,
        code=f"BRK-{new_id('gift_card')[-8:]}",
        initial_cents=balance,
        status="active",
        expires_at=expires_at,
    )
    db.add(card)
    await db.flush()
    await ledger.post(
        db,
        business_id,
        type="payment",
        ref=f"test:purchase:{card.id}",
        legs=[
            Leg("business", business_id, "stripe", balance),
            Leg("gift_card", card.id, "gift_card", -balance),
        ],
        subject=("gift_card", card.id),
    )
    if spent:
        await ledger.post(
            db,
            business_id,
            type="redemption",
            ref=f"test:redeem:{card.id}",
            legs=[
                Leg("gift_card", card.id, "gift_card", spent),
                Leg("business", business_id, "revenue", -spent),
            ],
            subject=("gift_card", card.id),
        )
    return card.id


async def _package(db: AsyncSession, *, paid: int) -> str:
    client_id = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    item_id = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert client_id and item_id
    package = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=client_id,
        item_id=item_id,
        sessions_total=5,
        status="active",
        expires_at=LAPSED,
    )
    db.add(package)
    await db.flush()
    await ledger.post(
        db,
        BIZ,
        type="payment",
        ref=f"test:purchase:{package.id}",
        legs=[
            Leg("business", BIZ, "stripe", paid),
            Leg("package", package.id, "deferred", -paid),
        ],
        subject=("package", package.id),
    )
    return package.id


async def _revenue(db: AsyncSession, business_id: str = BIZ) -> int:
    return await ledger.balance(
        db, business_id, owner_type="business", owner_id=business_id, kind="revenue"
    )


async def _breakage_legs(db: AsyncSession, owner_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Entry)
            .where(Entry.type == "breakage", Entry.subject_id == owner_id)
        )
    ).scalar_one()


async def test_expired_card_unspent_balance_becomes_revenue(db: AsyncSession) -> None:
    card_id = await _card(db, balance=5000, spent=2000)
    revenue = await _revenue(db)

    await run_expiry_sweeps(db, NOW)

    status = (await db.execute(select(GiftCard.status).where(GiftCard.id == card_id))).scalar_one()
    assert status == "expired"
    card_liability = await ledger.balance(
        db, BIZ, owner_type="gift_card", owner_id=card_id, kind="gift_card"
    )
    assert card_liability == 0
    assert await _revenue(db) == revenue - 3000
    assert await _breakage_legs(db, card_id) == 2


async def test_expired_package_unused_deferred_becomes_revenue(db: AsyncSession) -> None:
    package_id = await _package(db, paid=5600)
    revenue = await _revenue(db)

    await run_expiry_sweeps(db, NOW)

    deferred = await ledger.balance(
        db, BIZ, owner_type="package", owner_id=package_id, kind="deferred"
    )
    assert deferred == 0
    assert await _revenue(db) == revenue - 5600
    status = (await db.execute(select(Package.status).where(Package.id == package_id))).scalar_one()
    assert status == "expired"


async def test_breakage_posts_once(db: AsyncSession) -> None:
    card_id = await _card(db, balance=4000)
    await run_expiry_sweeps(db, NOW)
    revenue = await _revenue(db)

    await run_expiry_sweeps(db, NOW)
    await ledger.post_breakage(db, BIZ, owner_type="gift_card", owner_id=card_id, kind="gift_card")
    assert await _breakage_legs(db, card_id) == 2
    assert await _revenue(db) == revenue


async def test_fully_spent_card_posts_no_breakage(db: AsyncSession) -> None:
    card_id = await _card(db, balance=3000, spent=3000)
    revenue = await _revenue(db)
    await run_expiry_sweeps(db, NOW)
    assert await _breakage_legs(db, card_id) == 0
    assert await _revenue(db) == revenue


async def test_unexpired_card_is_left_alone(db: AsyncSession) -> None:
    card_id = await _card(db, balance=2500, expires_at=NOW + timedelta(days=30))
    await run_expiry_sweeps(db, NOW)
    status = (await db.execute(select(GiftCard.status).where(GiftCard.id == card_id))).scalar_one()
    assert status == "active"
    assert await _breakage_legs(db, card_id) == 0


async def test_breakage_books_to_the_card_owner_business(
    db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    card_id = await _card(db, balance=1500, business_id=other.id)
    ours, theirs = await _revenue(db), await _revenue(db, other.id)

    await run_expiry_sweeps(db, NOW)

    assert await _revenue(db) == ours
    assert await _revenue(db, other.id) == theirs - 1500
    owners = (
        (await db.execute(select(Entry.business_id).where(Entry.subject_id == card_id)))
        .scalars()
        .all()
    )
    assert set(owners) == {other.id}
