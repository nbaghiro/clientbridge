from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.models.billing import Estimate
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.platform import DeviceToken

_TOKEN_TTL = timedelta(days=60)


async def run_prune_device_tokens(db: AsyncSession, now: datetime) -> int:
    """Drop push tokens not seen in 60 days — a coarse staleness heuristic (no delivery-failure
    signal is tracked yet; reacting to Expo's DeviceNotRegistered is the follow-up)."""
    tokens = (
        (await db.execute(select(DeviceToken).where(DeviceToken.updated_at < now - _TOKEN_TTL)))
        .scalars()
        .all()
    )
    for token in tokens:
        await db.delete(token)
    await db.commit()
    return len(tokens)


async def run_expiry_sweeps(db: AsyncSession, now: datetime) -> int:
    """Status-only lapse of time-boxed rows: sent estimates past `valid_until`, and active gift
    cards / packages past `expires_at`, all to `expired`. Each row carries its own business."""
    swept = 0
    estimates = (
        (
            await db.execute(
                select(Estimate).where(
                    Estimate.status == "sent",
                    Estimate.valid_until.is_not(None),
                    Estimate.valid_until < now.date(),
                )
            )
        )
        .scalars()
        .all()
    )
    for estimate in estimates:
        estimate.status = "expired"
        swept += 1
    gift_cards = (
        (
            await db.execute(
                select(GiftCard).where(
                    GiftCard.status == "active",
                    GiftCard.expires_at.is_not(None),
                    GiftCard.expires_at < now,
                )
            )
        )
        .scalars()
        .all()
    )
    for gift_card in gift_cards:
        gift_card.status = "expired"
        swept += 1
    packages = (
        (
            await db.execute(
                select(Package).where(
                    Package.status == "active",
                    Package.expires_at.is_not(None),
                    Package.expires_at < now,
                )
            )
        )
        .scalars()
        .all()
    )
    for package in packages:
        package.status = "expired"
        swept += 1
    await db.commit()
    return swept


async def run_daily_maintenance(ctx: dict[str, object]) -> int:
    """arq cron entry — the daily housekeeping pass (token pruning, expiry sweeps). Returns the
    total rows touched across the sweeps."""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        return await run_prune_device_tokens(db, now) + await run_expiry_sweeps(db, now)
