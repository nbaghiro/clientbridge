from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import GiftCard, Item, Package
from clientbridge.models.crm import Client, Consent
from clientbridge.models.platform import DeviceToken
from clientbridge.services.notification_service import Notifier
from clientbridge.tasks.billing_jobs import run_overdue_sweep
from clientbridge.tasks.maintenance import (
    run_consent_expiry,
    run_expiry_sweeps,
    run_prune_device_tokens,
)
from tests.conftest import FakeEmailSender, FakePushSender, FakeSmsSender

BIZ = "bz_birchbark"
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


async def _invoice(db: AsyncSession, cid: str, *, due_at: datetime, total: int = 5000) -> str:
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
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
