"""The arq worker (`uv run arq clientbridge.tasks.worker.WorkerSettings`): the job schedule only."""

from datetime import UTC
from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.core.logs import configure_logging
from clientbridge.integrations.expo import get_push_sender
from clientbridge.integrations.http import close_http_client, start_http_client
from clientbridge.integrations.resend import get_email_sender
from clientbridge.integrations.s3 import get_file_storage
from clientbridge.integrations.stripe import close_stripe_client, get_payment_gateway
from clientbridge.integrations.twilio import get_sms_sender
from clientbridge.services.billing import run_overdue_sweep
from clientbridge.services.bookings import (
    run_complete_past_bookings,
    run_reap_unpaid_bookings,
    run_reminders,
)
from clientbridge.services.deliveries import run_deliveries
from clientbridge.services.entitlements import run_expiry_sweeps
from clientbridge.services.files import run_prune_pending_files
from clientbridge.services.forms import run_intake_forms
from clientbridge.services.messaging import run_due_broadcasts
from clientbridge.services.notifications import Notifier, run_prune_devices
from clientbridge.services.orders import run_pickup_reminders, run_reap_unpaid_orders
from clientbridge.services.payments import run_reconcile_payments
from clientbridge.services.plans import run_sync_seats, run_trial_reminders
from clientbridge.services.receipts import run_prune_receipts
from clientbridge.services.reviews import run_review_requests

Context = dict[str, object]


def _notifier() -> Notifier:
    return Notifier(get_email_sender(), get_sms_sender(), get_push_sender())


async def send_booking_reminders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reminders(db, _notifier(), clock.now())


async def reap_unpaid_bookings(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reap_unpaid_bookings(db, get_payment_gateway(), _notifier(), clock.now())


async def complete_past_bookings(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_complete_past_bookings(db, get_payment_gateway(), clock.now())


async def send_due_broadcasts(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_due_broadcasts(db, get_sms_sender(), get_email_sender(), clock.now())


async def sweep_overdue_invoices(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_overdue_sweep(db, _notifier(), clock.now())


async def expire_entitlements(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_expiry_sweeps(db, clock.now())


async def prune_devices(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_devices(db, clock.now())


async def reconcile_ledger(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reconcile_payments(db, get_payment_gateway())


async def send_review_requests(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_review_requests(db, _notifier(), clock.now())


async def send_intake_forms(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_intake_forms(db, _notifier(), clock.now())


async def send_pickup_reminders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_pickup_reminders(db, _notifier(), clock.now())


async def reap_unpaid_orders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_reap_unpaid_orders(db, get_payment_gateway(), clock.now())


async def prune_receipts(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_receipts(db, clock.now())


async def prune_pending_files(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_prune_pending_files(db, get_file_storage(), clock.now())


async def sync_plan_seats(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_sync_seats(db, get_payment_gateway(), clock.now())


async def send_trial_reminders(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_trial_reminders(db, _notifier(), clock.now())


async def send_deliveries(ctx: Context) -> int:
    async with SessionLocal() as db:
        return await run_deliveries(db, get_email_sender(), get_sms_sender(), get_push_sender())


async def startup(ctx: Context) -> None:
    start_http_client()
    configure_logging(get_settings().env)


async def shutdown(ctx: Context) -> None:
    await close_http_client()
    await close_stripe_client()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    timezone = UTC  # cron times are UTC whatever the host's zone
    on_startup = startup
    on_shutdown = shutdown
    job_timeout = 900
    # the liveness probe runs `arq --check`, which fails once this heartbeat is a minute late
    health_check_interval = 60
    functions: ClassVar[list[object]] = []
    cron_jobs: ClassVar[list[object]] = [
        cron(send_deliveries, second=15),
        cron(send_booking_reminders, minute={0, 15, 30, 45}),
        cron(reap_unpaid_bookings, minute={5, 20, 35, 50}),
        cron(complete_past_bookings, minute={2, 17, 32, 47}),
        cron(send_due_broadcasts, second=0),
        cron(sweep_overdue_invoices, minute=0),
        cron(expire_entitlements, hour=3, minute=30),
        cron(prune_devices, hour=3, minute=30),
        cron(prune_receipts, minute={10, 40}),
        cron(prune_pending_files, minute=20),
        cron(reconcile_ledger, hour=4, minute=0),
        cron(send_review_requests, minute=0),
        cron(send_pickup_reminders, minute=0),
        cron(reap_unpaid_orders, minute={5, 20, 35, 50}),
        cron(send_intake_forms, minute={10, 25, 40, 55}),
        cron(sync_plan_seats, hour=5, minute=0),
        cron(send_trial_reminders, minute=0),
    ]
