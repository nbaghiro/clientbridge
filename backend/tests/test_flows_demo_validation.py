from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from scripts.demo_engine import build_edition, edition_of
from scripts.demo_validate import validate_database, validate_graph
from scripts.seed_demo import build_demo, validate_seed_target
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client, Consent
from clientbridge.models.platform import File, FileParent
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory


def test_demo_preflight_rejects_corrupted_booking_timestamps() -> None:
    ctx = build_demo(datetime(2026, 10, 8, 16, tzinfo=UTC), core=True)
    booking = next(row for row in ctx.all(Booking) if row.status == "completed")
    slot = ctx.get(Slot, booking.slot_id)
    booking.completed_at = slot.starts_at
    booking.confirmed_at = ctx.now + timedelta(days=1)
    errors = validate_graph(ctx)
    assert f"{booking.id}: completion chronology" in errors
    assert f"{booking.id}: future confirmation" in errors


def test_demo_preflight_rejects_a_phone_not_stored_as_e164() -> None:
    ctx = build_demo(datetime(2026, 10, 8, 16, tzinfo=UTC), core=True)
    client = next(row for row in ctx.all(Client) if row.phone)
    client.phone = "(514) 555-1111"
    assert f"{client.id}: phone is not stored as E.164" in validate_graph(ctx)


def test_demo_preflight_rejects_two_live_clients_on_one_phone() -> None:
    ctx = build_demo(datetime(2026, 10, 8, 16, tzinfo=UTC), core=True)
    holder, other = sorted((row for row in ctx.all(Client) if row.phone), key=lambda c: c.id)[:2]
    other.phone = holder.phone
    assert f"{other.id}: phone is already {holder.id}'s" in validate_graph(ctx)


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
        client_id="cl_cc_morgan",
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


async def test_a_portrait_may_sit_on_a_bill_that_is_not_yet_due(
    db: AsyncSession, factory: Factory
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    client = await factory.client(business=business, name="Portrait Client")
    now = clock.now()
    bill = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=client.id,
        number=9901,
        status="sent",
        currency="CAD",
        total_cents=5000,
        issued_at=now - timedelta(hours=1),
        due_at=now + timedelta(days=14),
    )
    photo = File(
        id=new_id("file"),
        business_id=BIZ,
        parent_type="client",
        parent_id=client.id,
        purpose="photo",
        s3_key=f"{BIZ}/portrait",
        uploaded_at=now,
    )
    db.add_all([bill, photo])
    await db.flush()
    flagged = f"photo_on_negative_storyline: {client.id}"
    within_terms = (await validate_database(db))["errors"]
    assert isinstance(within_terms, list) and flagged not in within_terms
    bill.due_at = now - timedelta(days=1)
    await db.flush()
    overdue = (await validate_database(db))["errors"]
    assert isinstance(overdue, list) and flagged in overdue


async def test_seed_reset_preserves_unrelated_accounts(owner_db: AsyncSession) -> None:
    db = owner_db
    from scripts.seed_demo import build_graph, replace_business
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
    graph = build_graph(BIZ, clock.now())
    await replace_business(db, BIZ, graph.ctx.all(User))
    assert await db.scalar(select(Business.id).where(Business.id == outsider.id)) == outsider.id
    assert await db.scalar(select(User.id).where(User.id == user.id)) == user.id
    assert await db.scalar(select(Business.id).where(Business.id == BIZ)) is None


async def test_a_reseed_replaces_a_demo_user_whose_id_changed(owner_db: AsyncSession) -> None:
    db = owner_db
    from scripts.seed_demo import build_graph, replace_business

    from clientbridge.models.business import Business, Staff, User

    graphs = [build_graph(b, clock.now()) for b in ("bz_demo_second", "bz_northlight")]
    seeded = {graph.business_id: graph.ctx.all(User) for graph in graphs}
    emails = {user.email: user for users in seeded.values() for user in users}
    owner, other = emails["owner@cedarcoast.example"], emails["owner@northlight.example"]
    for business_id, users in seeded.items():
        await replace_business(db, business_id, users)
    cedar = Business(id="bz_demo_second", name="Cedar Coast Pet Care", slug="cedar-before")
    earlier = User(
        id="us_second_owner", identity_id=owner.identity_id, email=owner.email, name=owner.name
    )
    gone = User(id="us_gone", identity_id=str(uuid4()), email="gone@example.test", name="Gone")
    db.add_all([cedar, earlier, gone])
    await db.flush()
    db.add_all(
        [
            Staff(id="st_second_owner", business_id=cedar.id, user_id=earlier.id, role="owner"),
            Staff(id="st_gone", business_id=cedar.id, user_id=gone.id, role="staff"),
        ]
    )
    await db.flush()
    await replace_business(db, "bz_demo_second", seeded["bz_demo_second"])
    db.add(User(id=owner.id, identity_id=owner.identity_id, email=owner.email, name=owner.name))
    await db.flush()
    assert (await db.scalars(select(User.id).where(User.email == owner.email))).all() == [owner.id]
    assert await db.scalar(select(User.id).where(User.id == gone.id)) is None
    outsider = Business(id="bz_outsider_seed", name="Outsider", slug="outsider-seed")
    moved = User(id="us_moved", identity_id=str(uuid4()), email=other.email, name=other.name)
    db.add_all([outsider, moved])
    await db.flush()
    db.add(Staff(id="st_moved", business_id=outsider.id, user_id=moved.id, role="owner"))
    await db.flush()
    with pytest.raises(ValueError, match="belong to another business"):
        await replace_business(db, "bz_northlight", seeded["bz_northlight"])


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


async def test_a_scratch_business_copies_back_row_for_row(owner_db: AsyncSession) -> None:
    from scripts import demo_copy
    from scripts.seed_demo import replace_business

    from clientbridge.core.db import Base
    from clientbridge.models.business import Staff, User
    from clientbridge.models.payments import Payment

    members = select(Staff.user_id).where(Staff.business_id == BIZ)
    user_ids = list((await owner_db.scalars(select(User.id).where(User.id.in_(members)))).all())
    users = list((await owner_db.scalars(select(User).where(User.id.in_(user_ids)))).all())

    async def counts() -> dict[str, int]:
        found: dict[str, int] = {}
        for table in Base.metadata.sorted_tables:
            scoped = demo_copy.scope(table, [BIZ], user_ids)
            if scoped is not None:
                where = scoped[0].replace("$1::text[]", "CAST(:keys AS text[])")
                query = text(f"SELECT count(*) FROM {table.name} WHERE {where}")
                found[table.name] = await owner_db.scalar(query, {"keys": scoped[1]}) or 0
        booked = Payment.business_id == BIZ, Payment.booking_id.isnot(None)
        found["payments.booking_id"] = (
            await owner_db.scalar(select(func.count()).where(*booked)) or 0
        )
        return found

    before = await counts()
    assert before["entries"] and before["payments.booking_id"]
    # the seeded rows are committed, so a second connection reads them as a scratch database would
    scratch = await demo_copy.connect(get_settings().migration_database_url)
    try:
        await replace_business(owner_db, BIZ, users)
        assert (await counts())["businesses"] == 0
        copied = await demo_copy.copy_business(scratch, owner_db, BIZ, user_ids)
    finally:
        await scratch.close()
    assert await counts() == before
    assert copied == sum(rows for name, rows in before.items() if "." not in name)


async def test_the_scratch_database_is_neither_the_target_nor_in_use() -> None:
    from scripts import demo_copy

    url = get_settings().migration_database_url
    with pytest.raises(SystemExit, match="not be the seed target"):
        await demo_copy.prepare(url, url)
    with pytest.raises(SystemExit, match="must start empty"):
        await demo_copy.prepare(url, url.rsplit("/", 1)[0] + "/elsewhere")


def test_demo_preflight_rejects_a_shared_room_and_one_outside_the_pool() -> None:
    demo = build_edition(edition_of("bz_riverbend"), datetime(2026, 10, 8, 16, tzinfo=UTC))
    ctx = demo.ctx
    assert validate_graph(ctx) == []
    held = [s for s in ctx.all(Slot) if s.resource_id is not None and s.status != "canceled"]
    first, other = held[0], next(s for s in held[1:] if s.resource_id != held[0].resource_id)
    other.starts_at, other.ends_at = first.starts_at, first.ends_at
    other.resource_id = first.resource_id
    golf = next(s for s in held if s.resource_id == "rs_rb_golf")
    automatic = next(s for s in held if s.item_id == "it_rb_lesson_auto" and s is not first)
    automatic.resource_id = "rs_rb_golf"
    errors = validate_graph(ctx)
    assert any(first.id in e and other.id in e and "resource conflict" in e for e in errors), errors
    assert f"{automatic.id}: holds a resource outside it_rb_lesson_auto's pool" in errors
    golf.resource_id = None
    assert f"{golf.id}: {golf.item_id} needs a resource and holds none" in validate_graph(ctx)
