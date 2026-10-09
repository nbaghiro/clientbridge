"""The arq worker (`uv run arq clientbridge.tasks.worker.WorkerSettings`): the job schedule only."""

from datetime import UTC, datetime
from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.integrations.expo import get_push_sender
from clientbridge.integrations.postmark import get_email_sender
from clientbridge.integrations.stripe import get_payment_gateway
from clientbridge.integrations.twilio import get_sms_sender
from clientbridge.services.auth import run_prune_refreshes
from clientbridge.services.billing import run_overdue_sweep
from clientbridge.services.bookings import run_reap_unpaid_bookings, run_reminders
from clientbridge.services.entitlements import run_expiry_sweeps
from clientbridge.services.forms import run_intake_forms
from clientbridge.services.ledger import run_reconcile_ledger
from clientbridge.services.messaging import run_due_broadcasts
from clientbridge.services.notifications import Notifier, run_prune_devices
from clientbridge.services.orders import run_pickup_reminders, run_reap_unpaid_orders
from clientbridge.services.receipts import run_prune_receipts
from clientbridge.services.reviews import run_review_requests

Context = dict[str, object]


def _notifier() -> Notifier:
    return Notifier(get_email_sender(), get_sms_sender(), get_push_sender())


async def send_booking_reminders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reminders(db, _notifier(), datetime.now(UTC))


async def reap_unpaid_bookings(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reap_unpaid_bookings(db, datetime.now(UTC))


async def send_due_broadcasts(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_due_broadcasts(db, get_sms_sender(), get_email_sender(), datetime.now(UTC))


async def sweep_overdue_invoices(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_overdue_sweep(db, _notifier(), datetime.now(UTC))


async def expire_entitlements(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_expiry_sweeps(db, datetime.now(UTC))


async def prune_devices(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_devices(db, datetime.now(UTC))


async def reconcile_ledger(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reconcile_ledger(db, get_payment_gateway())


async def send_review_requests(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_review_requests(db, _notifier(), datetime.now(UTC))


async def send_intake_forms(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_intake_forms(db, _notifier(), datetime.now(UTC))


async def send_pickup_reminders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_pickup_reminders(db, _notifier(), datetime.now(UTC))


async def reap_unpaid_orders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reap_unpaid_orders(db, get_payment_gateway(), datetime.now(UTC))


async def prune_uploads(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_receipts(db, datetime.now(UTC))


async def prune_refreshes(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_refreshes(db, datetime.now(UTC))


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions: ClassVar[list[object]] = []
    cron_jobs: ClassVar[list[object]] = [
        cron(send_booking_reminders, minute={0, 15, 30, 45}),
        cron(reap_unpaid_bookings, minute={5, 20, 35, 50}),
        cron(send_due_broadcasts, minute={0, 15, 30, 45}),
        cron(sweep_overdue_invoices, hour=7, minute=0),
        cron(expire_entitlements, hour=3, minute=30),
        cron(prune_devices, hour=3, minute=30),
        cron(prune_uploads, minute={10, 40}),
        cron(prune_refreshes, second=0),
        cron(reconcile_ledger, hour=4, minute=0),
        cron(send_review_requests, hour=8, minute=0),
        cron(send_pickup_reminders, hour=9, minute=0),
        cron(reap_unpaid_orders, minute={5, 20, 35, 50}),
        cron(send_intake_forms, minute={10, 25, 40, 55}),
    ]
