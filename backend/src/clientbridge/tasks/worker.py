"""The job surface (#5) — an arq worker over Redis. Run with:
`uv run arq clientbridge.tasks.worker.WorkerSettings`. Add jobs as cron entries or `functions`."""

from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from clientbridge.core.config import get_settings
from clientbridge.tasks.reminders import send_booking_reminders


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions: ClassVar[list[object]] = []
    cron_jobs: ClassVar[list[object]] = [cron(send_booking_reminders, minute={0, 15, 30, 45})]
