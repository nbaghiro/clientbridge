import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge import main
from clientbridge.core.config import get_settings

UNREACHABLE_REDIS = "redis://127.0.0.1:1/0"


async def test_health_is_a_cheap_liveness_check(
    unauth: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "redis_url", UNREACHABLE_REDIS)
    res = await unauth.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


async def test_ready_without_redis_since_only_public_limits_and_the_worker_need_it(
    unauth: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "redis_url", UNREACHABLE_REDIS)
    res = await unauth.get("/ready")
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ready"}


async def test_not_ready_without_the_database(
    unauth: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreachable = create_async_engine("postgresql+asyncpg://nobody:nothing@127.0.0.1:1/none")
    monkeypatch.setattr(main, "engine", unreachable)
    try:
        res = await unauth.get("/ready")
    finally:
        await unreachable.dispose()
    assert res.status_code == 503
    assert res.json() == {"status": "unavailable", "failed": ["database"]}
