import importlib
import inspect
import pkgutil
from datetime import UTC, datetime, timedelta
from types import FunctionType
from typing import cast

from arq.cron import CronJob
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge import services
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.platform import Device
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from clientbridge.services.billing import estimate_status, run_overdue_sweep
from clientbridge.services.entitlements import run_expiry_sweeps
from clientbridge.services.ledger import Leg
from clientbridge.services.notifications import Notifier, run_prune_devices
from clientbridge.services.reviews import build_review_request, run_review_requests
from clientbridge.tasks.worker import WorkerSettings
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import client_id, sent_invoice

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
# far in the past so the global scans see only the rows each test plants (the seed is ~now)
NOW = datetime(2020, 1, 1, tzinfo=UTC)


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
    cid = await client_id(db, email="od@example.ca")
    overdue_id = await sent_invoice(db, client=cid, due_at=NOW - timedelta(days=5))
    current_id = await sent_invoice(db, client=cid, due_at=NOW + timedelta(days=5))

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), NOW)

    assert swept == 1
    assert await _status(db, Invoice, overdue_id) == "overdue"
    assert await _status(db, Invoice, current_id) == "sent"  # not yet due — untouched
    assert any(m.to == "od@example.ca" and "overdue" in m.body.lower() for m in email.sent)


async def test_overdue_sweep_is_idempotent(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db, email="od@example.ca")
    await sent_invoice(db, client=cid, due_at=NOW - timedelta(days=5))
    notifier = _notifier(email, sms, push)
    assert await run_overdue_sweep(db, notifier, NOW) == 1
    assert await run_overdue_sweep(db, notifier, NOW) == 0  # the transition is the dedup marker


async def test_overdue_sweep_is_multi_tenant(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
    factory: Factory,
) -> None:
    # Two businesses each have an overdue invoice; the one global scan must sweep both
    cid_a = await client_id(db, email="tenant-a@example.ca")
    inv_a = await sent_invoice(db, client=cid_a, due_at=NOW - timedelta(days=5))

    other = await factory.business(name="Second Tenant")
    client_b = await factory.client(business=other, name="B Client")
    client_b.email = "tenant-b@example.ca"
    await db.flush()
    inv_b = await sent_invoice(
        db, client=client_b.id, due_at=NOW - timedelta(days=5), business_id=other.id
    )

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), NOW)

    assert swept == 2  # the single scan resolved both tenants' rows, not just the seeded one
    assert await _status(db, Invoice, inv_a) == "overdue"
    assert await _status(db, Invoice, inv_b) == "overdue"
    recipients = {m.to for m in email.sent}
    assert "tenant-a@example.ca" in recipients
    assert "tenant-b@example.ca" in recipients  # the second tenant's client was notified per-row


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
    cid = await client_id(db, email="rev-job@example.ca")
    bid = await _completed_booking(db, cid, completed_at=NOW)
    notifier = _notifier(email, sms, push)

    assert await run_review_requests(db, notifier, NOW) == 1
    req = (await db.execute(select(Review).where(Review.booking_id == bid))).scalar_one()
    assert req.status == "requested" and req.token
    assert any(m.to == "rev-job@example.ca" for m in email.sent)
    assert await run_review_requests(db, notifier, NOW) == 0  # any existing request dedups


async def test_review_requests_skips_already_requested(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db)
    bid = await _completed_booking(db, cid, completed_at=NOW)
    db.add(build_review_request(BIZ, cid, bid, NOW))
    await db.flush()
    assert await run_review_requests(db, _notifier(email, sms, push), NOW) == 0


async def test_review_requests_skips_non_completed_and_stale(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await client_id(db)
    await _completed_booking(db, cid, completed_at=NOW, status="confirmed")  # not completed
    await _completed_booking(db, cid, completed_at=NOW - timedelta(days=30))  # outside 7d window
    assert await run_review_requests(db, _notifier(email, sms, push), NOW) == 0


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
