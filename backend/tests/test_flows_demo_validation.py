from datetime import UTC, datetime, timedelta

from scripts.demo_validate import validate_database, validate_graph
from scripts.seed_demo import build_demo
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.clients import Consent
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ


def test_demo_preflight_rejects_corrupted_booking_timestamps() -> None:
    ctx = build_demo(datetime(2026, 10, 8, 16, tzinfo=UTC))
    booking = next(row for row in ctx.all(Booking) if row.status == "completed")
    slot = ctx.get(Slot, booking.slot_id)
    booking.completed_at = slot.starts_at
    booking.confirmed_at = ctx.now + timedelta(days=1)
    errors = validate_graph(ctx)
    assert f"{booking.id}: completion chronology" in errors
    assert f"{booking.id}: future confirmation" in errors


async def test_demo_preflight_rejects_cross_business_consent(db: AsyncSession) -> None:
    consent = Consent(
        id="cns_test_cross_demo",
        business_id=BIZ,
        client_id="cl_second_private",
        channel="email",
        status="granted",
        source="in_person",
    )
    db.add(consent)
    await db.flush()
    report = await validate_database(db)
    assert report["ok"] is False
    errors = report["errors"]
    assert isinstance(errors, list)
    assert "consents/cns_test_cross_demo: cross-business parent" in errors


async def test_seed_reset_preserves_unrelated_accounts(db: AsyncSession) -> None:
    from scripts.seed_demo import replace_demo_rows
    from sqlalchemy import select

    from clientbridge.models.business import Business, User

    outsider = Business(id="bz_unrelated_seed", name="Unrelated", slug="unrelated-seed")
    user = User(id="us_unrelated_seed", email="unrelated@example.test", name="Unrelated")
    db.add_all([outsider, user])
    await db.flush()
    await replace_demo_rows(db, build_demo())
    assert await db.scalar(select(Business.id).where(Business.id == outsider.id)) == outsider.id
    assert await db.scalar(select(User.id).where(User.id == user.id)) == user.id
    assert await db.scalar(select(Business.id).where(Business.id == BIZ)) is None
