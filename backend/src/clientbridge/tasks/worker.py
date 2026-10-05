"""The arq worker (`uv run arq clientbridge.tasks.worker.WorkerSettings`)."""

from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from clientbridge.core.config import get_settings
from clientbridge.tasks.billing import sweep_overdue_invoices
from clientbridge.tasks.bookings import reap_unpaid_bookings, send_booking_reminders
from clientbridge.tasks.ledger import reconcile_ledger
from clientbridge.tasks.maintenance import run_daily_maintenance
from clientbridge.tasks.messaging import send_due_broadcasts
from clientbridge.tasks.reviews import send_review_requests


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions: ClassVar[list[object]] = []
    cron_jobs: ClassVar[list[object]] = [
        cron(send_booking_reminders, minute={0, 15, 30, 45}),
        cron(reap_unpaid_bookings, minute={5, 20, 35, 50}),
        cron(send_due_broadcasts, minute={0, 15, 30, 45}),
        cron(sweep_overdue_invoices, hour=7, minute=0),
        cron(run_daily_maintenance, hour=3, minute=30),
        cron(reconcile_ledger, hour=4, minute=0),
        cron(send_review_requests, hour=8, minute=0),
    ]
