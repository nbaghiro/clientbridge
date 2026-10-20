from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from scripts.demo_validate import validate_database, validate_graph
from scripts.seed_demo import build_demo, validate_seed_target
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.clients import Consent
from clientbridge.models.platform import File, FileParent
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


async def test_demo_preflight_rejects_an_estimate_both_booked_and_invoiced(
    db: AsyncSession,
) -> None:
    def invoiced(errors: object) -> list[str]:
        assert isinstance(errors, list)
        return [e for e in errors if isinstance(e, str) and "also invoiced" in e]

    assert invoiced((await validate_database(db))["errors"]) == []
    booking = (
        await db.scalars(
            select(Booking)
            .where(Booking.estimate_id.is_not(None), Booking.status != "canceled")
            .limit(1)
        )
    ).one()
    estimate = await db.get(Estimate, booking.estimate_id)
    invoice = (
        await db.scalars(select(Invoice).where(Invoice.business_id == booking.business_id).limit(1))
    ).one()
    assert estimate is not None
    estimate.converted_invoice_id = invoice.id
    await db.flush()
    errors = invoiced((await validate_database(db))["errors"])
    assert f"{booking.id}: booked from an estimate that was also invoiced" in errors


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


async def test_demo_preflight_rejects_photos_that_break_the_portrait_rules(
    db: AsyncSession,
) -> None:
    def photo(file_id: str, parent_type: FileParent, parent_id: str) -> File:
        return File(
            id=file_id,
            business_id=BIZ,
            parent_type=parent_type,
            parent_id=parent_id,
            purpose="photo",
            s3_key=f"{BIZ}/{file_id}",
            uploaded_at=clock.now(),
        )

    db.add_all(
        [
            photo("fl_test_no_show", "client", "cl_grace"),
            photo("fl_test_second", "user", "us_diego"),
            photo("fl_test_outsider", "user", "us_nl_liam"),
            File(
                id="fl_test_pending",
                business_id=BIZ,
                parent_type="client",
                parent_id="cl_amelie",
                purpose="photo",
                s3_key=f"{BIZ}/fl_test_pending",
            ),
        ]
    )
    await db.flush()
    errors = (await validate_database(db))["errors"]
    assert isinstance(errors, list)
    assert "photo_on_negative_storyline: cl_grace" in errors
    assert "one_photo_per_person: us_diego" in errors
    assert "people_photo_parent: fl_test_outsider" in errors
    assert "people_photo_parent: fl_test_pending" in errors


async def test_seed_reset_preserves_unrelated_accounts(owner_db: AsyncSession) -> None:
    db = owner_db
    from scripts.seed_demo import replace_demo_rows
    from sqlalchemy import select

    from clientbridge.models.business import Business, User

    outsider = Business(id="bz_unrelated_seed", name="Unrelated", slug="unrelated-seed")
    user = User(
        id="us_unrelated_seed",
        identity_id=str(uuid4()),
        email="unrelated@example.test",
        name="Unrelated",
    )
    db.add_all([outsider, user])
    await db.flush()
    await replace_demo_rows(db, build_demo())
    assert await db.scalar(select(Business.id).where(Business.id == outsider.id)) == outsider.id
    assert await db.scalar(select(User.id).where(User.id == user.id)) == user.id
    assert await db.scalar(select(Business.id).where(Business.id == BIZ)) is None


@pytest.mark.parametrize(
    ("env", "url", "allowed"),
    [
        ("dev", "postgresql+asyncpg://u@localhost/clientbridge", True),
        ("staging", "postgresql+asyncpg://u@127.0.0.1/staging_clientbridge", True),
        ("staging", "postgresql+asyncpg://u@127.0.0.1/clientbridge", False),
        ("staging", "postgresql+asyncpg://u@db.internal/staging_clientbridge", False),
        ("prod", "postgresql+asyncpg://u@127.0.0.1/clientbridge", False),
    ],
)
def test_the_demo_seeds_only_a_local_or_staging_database(
    monkeypatch: pytest.MonkeyPatch, env: str, url: str, allowed: bool
) -> None:
    monkeypatch.setattr(get_settings(), "env", env)
    monkeypatch.setattr(get_settings(), "migration_database_url", url)
    if allowed:
        validate_seed_target()
    else:
        with pytest.raises(SystemExit):
            validate_seed_target()
