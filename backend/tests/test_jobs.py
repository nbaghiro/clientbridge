import importlib
import inspect
import pkgutil
from datetime import UTC, datetime, timedelta
from types import FunctionType
from typing import cast

import pytest
from arq.cron import CronJob
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge import services
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.clients import Client
from clientbridge.models.platform import Device
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.billing import estimate_status, run_overdue_sweep
from clientbridge.services.entitlements import run_expiry_sweeps
from clientbridge.services.ledger import Leg
from clientbridge.services.notifications import Notifier, run_prune_devices
from clientbridge.services.reviews import build_review_request, run_review_requests
from clientbridge.tasks.worker import WorkerSettings
from tests.conftest import (
    DownEmailSender,
    DownSmsSender,
    Factory,
    FakeEmailSender,
    FakePushSender,
    FakeSmsSender,
)
from tests.google_business import configure_google_review_profile
from tests.helpers import client_id, new_client, queued_subjects, sent_invoice

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
# far in the past so the global scans see only the rows each test plants (the seed is ~now)
NOW = datetime(2020, 1, 1, tzinfo=UTC)
# daily client messages go out at a local hour; the seed business is in Vancouver (UTC-8)
OVERDUE_AT = datetime(2020, 1, 1, 15, tzinfo=UTC)
REVIEWS_AT = datetime(2020, 1, 1, 16, tzinfo=UTC)


def _notifier(email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender) -> Notifier:
    return Notifier(email, sms, push)


async def _an_item(db: AsyncSession) -> str:
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    return iid


async def _status(db: AsyncSession, model: type[Invoice] | type[Estimate], row_id: str) -> str:
    if model is Invoice:
        query = select(ledger.invoice_status_expr()).where(Invoice.id == row_id)
        return str((await db.execute(query)).scalar_one())
    estimate = (await db.execute(select(Estimate).where(Estimate.id == row_id))).scalar_one()
    return estimate_status(estimate, NOW.date())


async def test_overdue_sweep_flags_and_notifies(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db)
    overdue_id = await sent_invoice(db, client=cid, due_at=NOW - timedelta(days=5))
    current_id = await sent_invoice(db, client=cid, due_at=NOW + timedelta(days=5))

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), OVERDUE_AT)

    assert swept == 1
    assert await _status(db, Invoice, overdue_id) == "overdue"
    assert await _status(db, Invoice, current_id) == "sent"  # not yet due — untouched
    assert any(m.to == "+16045550223" and "overdue" in m.body.lower() for m in sms.sent)


async def test_overdue_sweep_is_idempotent(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db)
    await sent_invoice(db, client=cid, due_at=NOW - timedelta(days=5))
    notifier = _notifier(email, sms, push)
    assert await run_overdue_sweep(db, notifier, OVERDUE_AT) == 1
    assert (
        await run_overdue_sweep(db, notifier, OVERDUE_AT) == 0
    )  # the transition is the dedup marker


async def test_a_failed_overdue_notice_is_sent_on_a_later_morning(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db)
    invoice_id = await sent_invoice(db, client=cid, due_at=NOW - timedelta(days=5))
    down = Notifier(DownEmailSender(), DownSmsSender(), push)
    assert await run_overdue_sweep(db, down, OVERDUE_AT) == 0
    invoice = await db.get(Invoice, invoice_id, populate_existing=True)
    assert invoice is not None and invoice.overdue_notified_at is None

    next_morning = OVERDUE_AT + timedelta(days=1)
    assert await run_overdue_sweep(db, _notifier(email, sms, push), next_morning) == 1
    assert any(m.to == "+16045550223" for m in sms.sent)


async def test_overdue_sweep_waits_for_each_business_morning(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    eastern = await factory.business(name="Halifax Tenant")
    eastern.timezone = "America/Halifax"
    client = await factory.client(business=eastern, name="East Client")
    await db.flush()
    inv = await sent_invoice(
        db, client=client.id, due_at=NOW - timedelta(days=5), business_id=eastern.id
    )
    notifier = _notifier(email, sms, push)

    assert await run_overdue_sweep(db, notifier, OVERDUE_AT) == 0  # 11 a.m. in Halifax
    assert await _status(db, Invoice, inv) == "sent"
    assert await run_overdue_sweep(db, notifier, datetime(2020, 1, 1, 11, tzinfo=UTC)) == 1
    assert await _status(db, Invoice, inv) == "overdue"


def test_daily_client_messages_run_hourly() -> None:
    hourly = {"sweep_overdue_invoices", "send_review_requests", "send_pickup_reminders"}
    for job in WorkerSettings.cron_jobs:
        assert isinstance(job, CronJob)
        if job.name.removeprefix("cron:") in hourly:
            assert job.hour is None and job.minute == 0


async def test_overdue_sweep_is_multi_tenant(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    # Two businesses each have an overdue invoice; the one global scan must sweep both
    cid_a = await client_id(db, phone="+16045550151")
    inv_a = await sent_invoice(db, client=cid_a, due_at=NOW - timedelta(days=5))

    other = await factory.business(name="Second Tenant")
    other.sms_number = "+16045550198"
    client_b = await factory.client(business=other, name="B Client")
    client_b.phone = "+16045550152"
    await db.flush()
    inv_b = await sent_invoice(
        db, client=client_b.id, due_at=NOW - timedelta(days=5), business_id=other.id
    )

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), OVERDUE_AT)

    assert swept == 2  # the single scan resolved both tenants' rows, not just the seeded one
    assert await _status(db, Invoice, inv_a) == "overdue"
    assert await _status(db, Invoice, inv_b) == "overdue"
    recipients = {m.to for m in sms.sent}
    assert "+16045550151" in recipients
    assert "+16045550152" in recipients


async def test_prune_stale_devices(db: AsyncSession) -> None:
    db.add_all(
        [
            Device(
                id=new_id("device"),
                business_id=BIZ,
                user_id="us_dev",
                token="StaleTok",
                platform="ios",
                updated_at=NOW - timedelta(days=90),
            ),
            Device(
                id=new_id("device"),
                business_id=BIZ,
                user_id="us_dev",
                token="FreshTok",
                platform="ios",
                updated_at=NOW,
            ),
        ]
    )
    await db.flush()

    assert await run_prune_devices(db, NOW) == 1  # only the 90-day-old token

    remaining = (
        (await db.execute(select(Device.token).where(Device.business_id == BIZ))).scalars().all()
    )
    assert "FreshTok" in remaining
    assert "StaleTok" not in remaining


async def _completed_booking(
    db: AsyncSession, cid: str, *, completed_at: datetime | None, status: str = "completed"
) -> str:
    sess = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=await _an_item(db),
        staff_id=ST_OWNER,
        starts_at=completed_at or NOW,
        ends_at=(completed_at or NOW) + timedelta(hours=1),
        capacity=1,
        status="completed",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=sess.id,
        starts_at=sess.starts_at,
        staff_id=ST_OWNER,
        client_id=cid,
        status=status,
        source="manual",
        price_cents=5000,
        completed_at=completed_at,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_review_requests_for_recently_completed(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    cid = await client_id(db)
    bid = await _completed_booking(db, cid, completed_at=NOW)
    notifier = _notifier(email, sms, push)

    assert await run_review_requests(db, notifier, REVIEWS_AT) == 1
    req = (
        await db.execute(select(ReviewRequest).where(ReviewRequest.booking_id == bid))
    ).scalar_one()
    assert req.requested_at == REVIEWS_AT
    [notice] = await queued_subjects(db, f"review:{req.id}")
    assert "https://" in notice
    assert sms.sent == []
    assert await run_review_requests(db, notifier, REVIEWS_AT) == 0  # any existing request dedups


async def test_review_requests_skips_business_without_google_link(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db, False)
    await _completed_booking(db, await client_id(db), completed_at=NOW)
    assert await run_review_requests(db, _notifier(email, sms, push), REVIEWS_AT) == 0
    assert not email.sent


async def test_review_requests_skips_already_requested(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    cid = await client_id(db)
    bid = await _completed_booking(db, cid, completed_at=NOW)
    db.add(build_review_request(BIZ, cid, bid, NOW))
    await db.flush()
    assert await run_review_requests(db, _notifier(email, sms, push), REVIEWS_AT) == 0


async def test_review_requests_skips_non_completed_and_stale(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    cid = await client_id(db)
    await _completed_booking(db, cid, completed_at=NOW, status="confirmed")  # not completed
    await _completed_booking(db, cid, completed_at=NOW - timedelta(days=30))  # outside 7d window
    assert await run_review_requests(db, _notifier(email, sms, push), REVIEWS_AT) == 0


async def test_review_requests_ask_each_client_once(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    cid = await new_client(db, phone="+16045550253")
    await _completed_booking(db, cid, completed_at=NOW - timedelta(days=2))
    latest = await _completed_booking(db, cid, completed_at=NOW)
    notifier = _notifier(email, sms, push)
    assert await run_review_requests(db, notifier, REVIEWS_AT) == 1
    asked = (await db.scalars(select(ReviewRequest).where(ReviewRequest.client_id == cid))).all()
    assert [r.booking_id for r in asked] == [latest]
    assert len(await queued_subjects(db, f"review:{asked[0].id}")) == 1
    assert sms.sent == []
    assert await run_review_requests(db, notifier, REVIEWS_AT + timedelta(days=1)) == 0


async def test_review_requests_skip_businesses_that_turned_them_off(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    business.review_requests_enabled = False
    await db.flush()
    await _completed_booking(db, await new_client(db), completed_at=NOW)
    assert await run_review_requests(db, _notifier(email, sms, push), REVIEWS_AT) == 0
    assert not email.sent


async def test_review_requests_skip_archived_clients(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db)
    await db.flush()
    cid = await new_client(db, phone="+16045550154")
    await _completed_booking(db, cid, completed_at=NOW)
    client = await db.get(Client, cid)
    assert client is not None
    client.deleted_at = NOW
    await db.flush()
    assert await run_review_requests(db, _notifier(email, sms, push), REVIEWS_AT) == 0
    assert not email.sent


async def test_expiry_sweeps_lapse_only_past_rows(db: AsyncSession) -> None:
    cid = await client_id(db)
    item_id = await _an_item(db)
    expired_est = Estimate(
        id=new_id("estimate"),
        business_id=BIZ,
        client_id=cid,
        status="sent",
        valid_until=(NOW - timedelta(days=1)).date(),
    )
    current_est = Estimate(
        id=new_id("estimate"),
        business_id=BIZ,
        client_id=cid,
        status="sent",
        valid_until=(NOW + timedelta(days=30)).date(),
    )
    expired_gc = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="JOBTEST-GC-EXP",
        initial_cents=1000,
        status="active",
        expires_at=NOW - timedelta(days=1),
    )
    current_gc = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="JOBTEST-GC-CUR",
        initial_cents=1000,
        status="active",
        expires_at=NOW + timedelta(days=30),
    )
    expired_pkg = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=cid,
        item_id=item_id,
        sessions_total=5,
        status="active",
        expires_at=NOW - timedelta(days=1),
    )
    db.add_all([expired_est, current_est, expired_gc, current_gc, expired_pkg])
    await db.flush()
    for card in (expired_gc, current_gc):
        await ledger.post(
            db,
            BIZ,
            event="payment",
            ref=f"test:purchase:{card.id}",
            legs=[
                Leg("business", BIZ, "stripe", 1000),
                Leg("gift_card", card.id, "gift_card", -1000),
            ],
            subject=("gift_card", card.id),
        )

    assert await run_expiry_sweeps(db, NOW) == 2  # an estimate's expiry is read, not swept

    assert await _status(db, Estimate, expired_est.id) == "expired"
    assert await _status(db, Estimate, current_est.id) == "sent"
    gc_statuses = {
        gc_id: status
        for gc_id, status in (
            await db.execute(
                select(GiftCard.id, GiftCard.status).where(
                    GiftCard.id.in_([expired_gc.id, current_gc.id])
                )
            )
        ).all()
    }
    assert gc_statuses[expired_gc.id] == "expired"
    assert gc_statuses[current_gc.id] == "active"
    pkg_status = (
        await db.execute(select(Package.status).where(Package.id == expired_pkg.id))
    ).scalar_one()
    assert pkg_status == "expired"


def _service_jobs() -> set[str]:
    found: set[str] = set()
    for info in pkgutil.iter_modules(services.__path__):
        module = importlib.import_module(f"{services.__name__}.{info.name}")
        for name, fn in inspect.getmembers(module, inspect.iscoroutinefunction):
            if name.startswith("run_") and fn.__module__ == module.__name__:
                found.add(name)
    return found


def test_the_worker_schedules_every_service_job() -> None:
    scheduled: set[str] = set()
    for job in WorkerSettings.cron_jobs:
        assert isinstance(job, CronJob)
        scheduled |= {
            n for n in cast(FunctionType, job.coroutine).__code__.co_names if n.startswith("run_")
        }
    jobs = _service_jobs()
    assert jobs, "no run_* jobs found in clientbridge.services"
    assert scheduled == jobs


def test_every_cron_entry_is_a_worker_job_that_fires_at_least_daily() -> None:
    from dataclasses import replace

    from clientbridge.tasks import worker

    start = datetime(2026, 10, 13, 17, 0, 0, 1, tzinfo=UTC)
    names: list[str] = []
    for job in WorkerSettings.cron_jobs:
        assert isinstance(job, CronJob)
        name = job.name.removeprefix("cron:")
        names.append(name)
        assert job.name == f"cron:{name}"
        assert getattr(worker, name) is job.coroutine
        assert inspect.iscoroutinefunction(job.coroutine)
        assert list(inspect.signature(job.coroutine).parameters) == ["ctx"]
        assert not job.run_at_startup
        probe = replace(job, next_run=None)
        probe.calculate_next(start)
        assert probe.next_run is not None
        assert start < probe.next_run <= start + timedelta(days=1)
    assert len(names) == len(set(names))


def test_the_worker_heartbeat_is_fresh_enough_for_the_liveness_probe() -> None:
    assert WorkerSettings.health_check_interval == 60


def test_stripe_recovery_is_not_scheduled() -> None:
    names = set()
    for job in WorkerSettings.cron_jobs:
        assert isinstance(job, CronJob)
        names.add(job.name.removeprefix("cron:"))
    assert "recover_payments" not in names
    assert "reconcile_ledger" in names


def test_ledger_reconciliation_runs_every_hour() -> None:
    (job,) = [
        job
        for job in WorkerSettings.cron_jobs
        if isinstance(job, CronJob) and job.name == "cron:reconcile_ledger"
    ]
    assert (job.hour, job.minute) == (None, 45)


pytestmark = pytest.mark.usefixtures("google_review_provider")


@pytest.mark.usefixtures("db")
async def test_review_job_releases_previous_business_lock_before_next_provider_call(
    monkeypatch: pytest.MonkeyPatch,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    from scripts.seed_demo import purge_businesses
    from sqlalchemy import text

    from clientbridge.core.db import SessionLocal
    from clientbridge.services import reviews

    async with SessionLocal() as setup:
        factory = Factory(setup)
        first = await factory.business()
        second = await factory.business()
        await setup.commit()

    async def businesses(db: AsyncSession, now: datetime, hour: int) -> list[Business]:
        return [first, second]

    async def link(db: AsyncSession, business_id: str) -> str | None:
        if business_id == second.id:
            async with SessionLocal() as probe:
                assert (
                    await probe.scalar(
                        text("SELECT pg_try_advisory_xact_lock(hashtextextended(:key, 0))"),
                        {"key": f"google:{first.id}"},
                    )
                    is True
                )
        return None

    monkeypatch.setattr(reviews, "businesses_at_hour", businesses)
    monkeypatch.setattr(reviews, "google_invitation_url", link)
    try:
        async with SessionLocal() as job:
            assert await run_review_requests(job, _notifier(email, sms, push), REVIEWS_AT) == 0
    finally:
        from sqlalchemy.ext.asyncio import create_async_engine

        from clientbridge.core.config import get_settings

        owner = create_async_engine(get_settings().migration_database_url)
        async with AsyncSession(owner) as cleanup:
            await purge_businesses(cleanup, [first.id, second.id], [])
            await cleanup.commit()
        await owner.dispose()
