from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.crm import Client, Consent
from clientbridge.models.platform import DeviceToken
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services.notification_service import Notifier
from clientbridge.services.review_service import build_review_request
from clientbridge.tasks.billing_jobs import run_overdue_sweep
from clientbridge.tasks.maintenance import (
    run_consent_expiry,
    run_expiry_sweeps,
    run_prune_device_tokens,
)
from clientbridge.tasks.review_jobs import run_review_requests
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
# far in the past so the global scans see only the rows each test plants (the seed is ~now)
NOW = datetime(2020, 1, 1, tzinfo=UTC)


def _notifier(email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender) -> Notifier:
    return Notifier(email, sms, push)


async def _a_client(db: AsyncSession, *, email: str | None = None) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    if email is not None:
        await db.execute(update(Client).where(Client.id == cid).values(email=email))
    await db.flush()
    return cid


async def _an_item(db: AsyncSession) -> str:
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    return iid


async def _invoice(
    db: AsyncSession, cid: str, *, due_at: datetime, total: int = 5000, business_id: str = BIZ
) -> str:
    inv = Invoice(
        id=new_id("invoice"),
        business_id=business_id,
        client_id=cid,
        status="sent",
        currency="CAD",
        subtotal_cents=total,
        total_cents=total,
        balance_cents=total,
        due_at=due_at,
    )
    db.add(inv)
    await db.flush()
    return inv.id


async def _status(db: AsyncSession, model: type[Invoice] | type[Estimate], row_id: str) -> str:
    return (await db.execute(select(model.status).where(model.id == row_id))).scalar_one()


async def test_overdue_sweep_flags_and_notifies(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await _a_client(db, email="od@example.ca")
    overdue_id = await _invoice(db, cid, due_at=NOW - timedelta(days=5))
    current_id = await _invoice(db, cid, due_at=NOW + timedelta(days=5))

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), NOW)

    assert swept == 1
    assert await _status(db, Invoice, overdue_id) == "overdue"
    assert await _status(db, Invoice, current_id) == "sent"  # not yet due — untouched
    assert any(m.to == "od@example.ca" and "overdue" in m.body.lower() for m in email.sent)


async def test_overdue_sweep_is_idempotent(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await _a_client(db, email="od@example.ca")
    await _invoice(db, cid, due_at=NOW - timedelta(days=5))
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
    # Tenant A (the seeded business) and Tenant B (a second business) each have an overdue invoice;
    # the ONE global scan must sweep + notify both — proving it isn't accidentally single-business.
    cid_a = await _a_client(db, email="tenant-a@example.ca")
    inv_a = await _invoice(db, cid_a, due_at=NOW - timedelta(days=5))

    other = await factory.business(name="Second Tenant")
    client_b = await factory.client(business=other, name="B Client")
    client_b.email = "tenant-b@example.ca"
    await db.flush()
    inv_b = await _invoice(db, client_b.id, due_at=NOW - timedelta(days=5), business_id=other.id)

    swept = await run_overdue_sweep(db, _notifier(email, sms, push), NOW)

    assert swept == 2  # the single scan resolved both tenants' rows, not just the seeded one
    assert await _status(db, Invoice, inv_a) == "overdue"
    assert await _status(db, Invoice, inv_b) == "overdue"
    recipients = {m.to for m in email.sent}
    assert "tenant-a@example.ca" in recipients
    assert "tenant-b@example.ca" in recipients  # the second tenant's client was notified per-row


async def test_consent_expiry_blocks_channel(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await _a_client(db, email="cx@example.ca")
    db.add(
        Consent(
            id=new_id("consent"),
            business_id=BIZ,
            client_id=cid,
            channel="email",
            basis="implied",
            status="granted",
            expires_at=NOW - timedelta(days=1),
        )
    )
    await db.flush()

    assert await run_consent_expiry(db, NOW) == 1

    status = (
        await db.execute(
            select(Consent.status).where(Consent.client_id == cid, Consent.channel == "email")
        )
    ).scalar_one()
    assert status == "withdrawn"

    inv_id = await _invoice(db, cid, due_at=NOW - timedelta(days=5))
    await _notifier(email, sms, push).on_invoice_overdue(db, inv_id)
    assert email.sent == []  # CASL: the lapsed consent now blocks the email channel


async def test_consent_expiry_keeps_unexpired(db: AsyncSession) -> None:
    cid = await _a_client(db)
    db.add(
        Consent(
            id=new_id("consent"),
            business_id=BIZ,
            client_id=cid,
            channel="sms",
            basis="implied",
            status="granted",
            expires_at=NOW + timedelta(days=365),
        )
    )
    await db.flush()
    assert await run_consent_expiry(db, NOW) == 0


async def test_prune_stale_device_tokens(db: AsyncSession) -> None:
    db.add_all(
        [
            DeviceToken(
                id=new_id("device_token"),
                business_id=BIZ,
                user_id="us_dev",
                token="StaleTok",
                platform="ios",
                updated_at=NOW - timedelta(days=90),
            ),
            DeviceToken(
                id=new_id("device_token"),
                business_id=BIZ,
                user_id="us_dev",
                token="FreshTok",
                platform="ios",
                updated_at=NOW,
            ),
        ]
    )
    await db.flush()

    assert await run_prune_device_tokens(db, NOW) == 1  # only the 90-day-old token

    remaining = (
        (await db.execute(select(DeviceToken.token).where(DeviceToken.business_id == BIZ)))
        .scalars()
        .all()
    )
    assert "FreshTok" in remaining
    assert "StaleTok" not in remaining


async def _completed_booking(
    db: AsyncSession, cid: str, *, completed_at: datetime | None, status: str = "completed"
) -> str:
    sess = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=await _an_item(db),
        staff_id=ST_OWNER,
        starts_at=completed_at or NOW,
        ends_at=(completed_at or NOW) + timedelta(hours=1),
        capacity=1,
        booked_count=1,
        status="completed",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=sess.id,
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
    cid = await _a_client(db, email="rev-job@example.ca")
    bid = await _completed_booking(db, cid, completed_at=NOW)
    notifier = _notifier(email, sms, push)

    assert await run_review_requests(db, notifier, NOW) == 1
    req = (
        await db.execute(select(ReviewRequest).where(ReviewRequest.booking_id == bid))
    ).scalar_one()
    assert req.status == "sent" and req.token
    assert any(m.to == "rev-job@example.ca" for m in email.sent)
    assert await run_review_requests(db, notifier, NOW) == 0  # any existing request dedups


async def test_review_requests_skips_already_requested(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await _a_client(db)
    bid = await _completed_booking(db, cid, completed_at=NOW)
    db.add(build_review_request(BIZ, cid, bid, NOW))
    await db.flush()
    assert await run_review_requests(db, _notifier(email, sms, push), NOW) == 0


async def test_review_requests_skips_non_completed_and_stale(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    cid = await _a_client(db)
    await _completed_booking(db, cid, completed_at=NOW, status="confirmed")  # not completed
    await _completed_booking(db, cid, completed_at=NOW - timedelta(days=30))  # outside 7d window
    assert await run_review_requests(db, _notifier(email, sms, push), NOW) == 0


async def test_expiry_sweeps_lapse_only_past_rows(db: AsyncSession) -> None:
    cid = await _a_client(db)
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
        balance_cents=1000,
        status="active",
        expires_at=NOW - timedelta(days=1),
    )
    current_gc = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="JOBTEST-GC-CUR",
        initial_cents=1000,
        balance_cents=1000,
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

    assert await run_expiry_sweeps(db, NOW) == 3

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
