import hashlib
import time
from collections import defaultdict, deque

from fastapi import Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError, TooManyRequests


class RateLimiter:
    """Fixed-window in-process limiter; a multi-instance deploy would need a shared store."""

    def __init__(self, limit: int, window_s: float, *, sweep_at: int = 1024) -> None:
        self.limit = limit
        self.window_s = window_s
        self._sweep_at = sweep_at
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def __contains__(self, key: str) -> bool:
        return key in self._hits

    def check(self, key: str, now: float) -> bool:
        if len(self._hits) > self._sweep_at:
            self._sweep(now)  # drop buckets that fully aged out, so the dict can't grow forever
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True

    def release(self, key: str) -> None:
        hits = self._hits.get(key)
        if hits:
            hits.pop()

    def _sweep(self, now: float) -> None:
        cutoff = now - self.window_s
        for key in [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]:
            del self._hits[key]


_PER_MINUTE = get_settings().public_rate_limit()
_public_contact_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
_public_pay_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
_public_form_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
_public_contract_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
_public_booking_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
_public_booking_read_limiter = RateLimiter(
    limit=get_settings().public_read_rate_limit(), window_s=60.0
)
_public_invite_limiter = RateLimiter(limit=_PER_MINUTE, window_s=60.0)
connect_refresh_limiter = RateLimiter(limit=6, window_s=60.0)
auth_email_limiter = RateLimiter(limit=get_settings().auth_email_hourly_limit(), window_s=3600.0)


def requester_ip(request: Request) -> str:
    """The client address: the entry each trusted proxy appended last, else the socket peer."""
    peer = request.client.host if request.client else "unknown"
    hops = get_settings().trusted_proxy_hops
    chain = [
        entry.strip()
        for header in request.headers.getlist("x-forwarded-for")
        for entry in header.split(",")
        if entry.strip()
    ]
    if hops == 0 or len(chain) < hops:
        return peer
    return chain[-hops]


async def _allowed(request: Request, scope: str, limiter: RateLimiter) -> bool:
    return await allow_action(requester_ip(request), scope, limiter)


def _action_key(address: str, scope: str) -> str:
    return f"rate:{scope}:{hashlib.sha256(address.encode()).hexdigest()}"


async def allow_action(address: str, scope: str, limiter: RateLimiter) -> bool:
    settings = get_settings()
    if settings.env == "dev":
        return limiter.check(address, time.monotonic())
    key = _action_key(address, scope)
    script = (
        "local n = redis.call('INCR', KEYS[1]); "
        "if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return n"
    )
    try:
        async with Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        ) as redis:
            count = await redis.execute_command(
                "EVAL", script, "1", key, str(int(limiter.window_s * 1000))
            )
        return isinstance(count, int) and count <= limiter.limit
    except RedisError as error:
        raise AppError("request limiting is temporarily unavailable", status_code=503) from error


async def release_action(address: str, scope: str, limiter: RateLimiter) -> None:
    """Gives back what `allow_action` counted, for work that didn't happen."""
    settings = get_settings()
    if settings.env == "dev":
        limiter.release(address)
        return
    # only while the window's key lives: decrementing a lapsed one would recreate it with no expiry
    script = "if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('DECR', KEYS[1]) end"
    try:
        async with Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        ) as redis:
            await redis.execute_command("EVAL", script, "1", _action_key(address, scope))
    except RedisError:
        return  # the count just lapses with its window


async def public_pay_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated pay endpoints (they mint Stripe objects)."""
    if not await _allowed(request, "pay", _public_pay_limiter):
        raise TooManyRequests("too many payment attempts — please wait a moment")


async def public_form_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated form endpoints (token probing + submits)."""
    if not await _allowed(request, "form", _public_form_limiter):
        raise TooManyRequests("too many requests — please wait a moment")


async def public_contract_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated contract endpoints (token probing + signs)."""
    if not await _allowed(request, "contract", _public_contract_limiter):
        raise TooManyRequests("too many requests — please wait a moment")


async def public_booking_rate_limit(request: Request) -> None:
    """Cap how fast one IP books, orders, joins a waitlist or changes a booking."""
    if not await _allowed(request, "booking", _public_booking_limiter):
        raise TooManyRequests("too many requests — please wait a moment")


async def public_booking_read_rate_limit(request: Request) -> None:
    """Cap how fast one IP reads the unauthenticated booking page, its times and the shop."""
    if not await _allowed(request, "booking-read", _public_booking_read_limiter):
        raise TooManyRequests("too many requests — please wait a moment")


async def public_invite_rate_limit(request: Request) -> None:
    """Cap how fast one IP probes invite tokens on the unauthenticated preview."""
    if not await _allowed(request, "invite", _public_invite_limiter):
        raise TooManyRequests("too many requests — please wait a moment")


async def public_contact_rate_limit(request: Request) -> None:
    if not await _allowed(request, "contact", _public_contact_limiter):
        raise TooManyRequests("too many requests — please wait a moment")
