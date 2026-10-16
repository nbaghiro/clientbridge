import asyncio
import logging

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

_TIMEOUT_S = 2.0
_log = logging.getLogger(__name__)


async def _database_ready(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def _redis_ready(redis_url: str) -> None:
    redis = Redis.from_url(redis_url, socket_connect_timeout=_TIMEOUT_S, socket_timeout=_TIMEOUT_S)
    try:
        await redis.ping()
    finally:
        await redis.aclose()


async def unready_dependencies(engine: AsyncEngine, redis_url: str) -> list[str]:
    """The dependencies that failed to answer within the timeout, checked concurrently."""
    checks = {"database": _database_ready(engine), "redis": _redis_ready(redis_url)}
    results = await asyncio.gather(
        *(asyncio.wait_for(check, _TIMEOUT_S) for check in checks.values()),
        return_exceptions=True,
    )
    failed = [
        (name, result) for name, result in zip(checks, results, strict=True) if result is not None
    ]
    for name, error in failed:
        _log.warning("readiness check failed", extra={"dependency": name, "error": repr(error)})
    return [name for name, _ in failed]
