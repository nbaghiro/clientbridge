from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.platform import Device
from clientbridge.services import ledger_service as ledger

_TOKEN_TTL = timedelta(days=60)


async def run_prune_devices(db: AsyncSession, now: datetime) -> int:
    """Drop push tokens not seen in 60 days — a coarse staleness heuristic (no delivery-failure
    signal is tracked yet; reacting to Expo's DeviceNotRegistered is the follow-up)."""
    tokens = (
        (await db.execute(select(Device).where(Device.updated_at < now - _TOKEN_TTL)))
        .scalars()
        .all()
    )
    for token in tokens:
        await db.delete(token)
    await db.commit()
    return len(tokens)


async def run_expiry_sweeps(db: AsyncSession, now: datetime) -> int:
    """Lapse active gift cards and packages past `expires_at` to `expired`, booking their unspent
    balance as breakage revenue. A fully spent card is left as it is (it reads as redeemed)."""
    swept = 0
    gift_cards = (
        (
            await db.execute(
                select(GiftCard)
                .where(
                    GiftCard.status == "active",
                    GiftCard.expires_at.is_not(None),
                    GiftCard.expires_at < now,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for gift_card in gift_cards:
        if await ledger.gift_card_balance(db, gift_card) == 0:
            continue
        gift_card.status = "expired"
        await ledger.post_breakage(
            db,
            gift_card.business_id,
            owner_type="gift_card",
            owner_id=gift_card.id,
            category="gift_card",
        )
        swept += 1
    packages = (
        (
            await db.execute(
                select(Package)
                .where(
                    Package.status == "active",
                    Package.expires_at.is_not(None),
                    Package.expires_at < now,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for package in packages:
        package.status = "expired"
        await ledger.post_breakage(
            db, package.business_id, owner_type="package", owner_id=package.id, category="deferred"
        )
        swept += 1
    await db.commit()
    return swept


async def run_daily_maintenance(ctx: dict[str, object]) -> int:
    """arq cron entry — the daily housekeeping pass (token pruning, expiry sweeps). Returns the
    total rows touched across the sweeps."""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        return await run_prune_devices(db, now) + await run_expiry_sweeps(db, now)
