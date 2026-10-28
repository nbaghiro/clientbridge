"""The worker's queue: a request hands it work to start now instead of at the next cron tick."""

import logging
from typing import Protocol

from arq.connections import RedisSettings, create_pool
from redis.exceptions import RedisError

from clientbridge.core.config import get_settings

_log = logging.getLogger(__name__)


class Jobs(Protocol):
    async def enqueue(self, name: str) -> None: ...


class ArqJobs:
    async def enqueue(self, name: str) -> None:
        settings = RedisSettings.from_dsn(get_settings().redis_url)
        settings.conn_timeout, settings.conn_retries = 2, 0
        try:
            pool = await create_pool(settings)
            try:
                await pool.enqueue_job(name)
            finally:
                await pool.aclose()
        except (RedisError, OSError):
            # the cron run within the minute picks the work up instead
            _log.warning("could not enqueue %s", name)


def get_jobs() -> Jobs:
    return ArqJobs()
