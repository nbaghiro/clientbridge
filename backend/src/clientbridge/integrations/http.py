import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

_clients: dict[asyncio.AbstractEventLoop, httpx.AsyncClient] = {}


def start_http_client() -> None:
    loop = asyncio.get_running_loop()
    if loop not in _clients:
        _clients[loop] = httpx.AsyncClient(timeout=10.0)


async def close_http_client() -> None:
    client = _clients.pop(asyncio.get_running_loop(), None)
    if client is not None:
        await client.aclose()


@asynccontextmanager
async def http_session() -> AsyncIterator[httpx.AsyncClient]:
    client = _clients.get(asyncio.get_running_loop())
    if client is not None:
        yield client
    else:
        async with httpx.AsyncClient(timeout=10.0) as temporary:
            yield temporary
