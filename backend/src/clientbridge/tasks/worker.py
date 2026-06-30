"""The job surface (#5) — an arq worker over Redis. Run with:
`uv run arq clientbridge.tasks.worker.WorkerSettings`. Add jobs as cron entries or `functions`."""

from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from clientbridge.core.config import get_settings
from clientbridge.tasks.billing_jobs import sweep_overdue_invoices
from clientbridge.tasks.booking_jobs import reap_unpaid_bookings
from clientbridge.tasks.maintenance import run_daily_maintenance
from clientbridge.tasks.messaging_jobs import send_due_broadcasts
from clientbridge.tasks.reminders import send_booking_reminders
from clientbridge.tasks.review_jobs import send_review_requests


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions: ClassVar[list[object]] = []
    cron_jobs: ClassVar[list[object]] = [
        cron(send_booking_reminders, minute={0, 15, 30, 45}),
        cron(reap_unpaid_bookings, minute={5, 20, 35, 50}),
        cron(send_due_broadcasts, minute={0, 15, 30, 45}),
        cron(sweep_overdue_invoices, hour=7, minute=0),
        cron(run_daily_maintenance, hour=3, minute=30),
        cron(send_review_requests, hour=8, minute=0),
    ]
