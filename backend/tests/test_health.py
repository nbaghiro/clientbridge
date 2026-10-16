import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge import main
from clientbridge.core.config import get_settings

UNREACHABLE_REDIS = "redis://127.0.0.1:1/0"


async def _answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    while header := await reader.readline():
        args: list[bytes] = []
        for _ in range(int(header[1:])):
            await reader.readline()
            args.append((await reader.readline()).strip())
        writer.write(b"+PONG\r\n" if args[0].upper() == b"PING" else b"+OK\r\n")
        await writer.drain()
    writer.close()


@pytest.fixture
async def redis(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    """A Redis stand-in that answers PING, since the test job runs no Redis."""
    server = await asyncio.start_server(_answer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setattr(get_settings(), "redis_url", f"redis://127.0.0.1:{port}/0")
    async with server:
        yield


async def test_health_is_a_cheap_liveness_check(
    unauth: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "redis_url", UNREACHABLE_REDIS)
    res = await unauth.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


async def test_ready_when_the_database_and_redis_answer(
    unauth: httpx.AsyncClient, redis: None
) -> None:
    res = await unauth.get("/ready")
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ready"}


async def test_not_ready_without_redis(
    unauth: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "redis_url", UNREACHABLE_REDIS)
    res = await unauth.get("/ready")
    assert res.status_code == 503
    assert res.json() == {"status": "unavailable", "failed": ["redis"]}


async def test_not_ready_without_the_database(
    unauth: httpx.AsyncClient, redis: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreachable = create_async_engine("postgresql+asyncpg://nobody:nothing@127.0.0.1:1/none")
    monkeypatch.setattr(main, "engine", unreachable)
    try:
        res = await unauth.get("/ready")
    finally:
        await unreachable.dispose()
    assert res.status_code == 503
    assert res.json() == {"status": "unavailable", "failed": ["database"]}
