import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

_TIMEOUT_S = 2.0
_log = logging.getLogger(__name__)


async def _database_ready(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def unready_dependencies(engine: AsyncEngine) -> list[str]:
    """The dependencies every request needs that failed to answer within the timeout."""
    # Redis is left out: only the public rate limits and the worker use it, and they fail alone
    try:
        await asyncio.wait_for(_database_ready(engine), _TIMEOUT_S)
    except Exception as error:
        _log.warning(
            "readiness check failed", extra={"dependency": "database", "error": repr(error)}
        )
        return ["database"]
    return []
