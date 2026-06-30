import time
from collections import defaultdict, deque

from fastapi import Request

from clientbridge.core.errors import TooManyRequests


class RateLimiter:
    """A fixed-window sliding limiter (in-process). Good enough as a per-instance abuse backstop; a
    multi-instance deploy should swap the store for Redis."""

    def __init__(self, limit: int, window_s: float, *, sweep_at: int = 1024) -> None:
        self.limit = limit
        self.window_s = window_s
        self._sweep_at = sweep_at
        self._hits: dict[str, deque[float]] = defaultdict(deque)

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

    def _sweep(self, now: float) -> None:
        cutoff = now - self.window_s
        for key in [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]:
            del self._hits[key]


_public_pay_limiter = RateLimiter(limit=30, window_s=60.0)
_public_review_limiter = RateLimiter(limit=30, window_s=60.0)


def _client_ip(request: Request) -> str:
    # behind a proxy/LB the socket peer is the proxy; the forwarded chain's first hop is the client
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def public_pay_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated pay endpoints (they mint Stripe objects)."""
    if not _public_pay_limiter.check(_client_ip(request), time.monotonic()):
        raise TooManyRequests("too many payment attempts — please wait a moment")


def public_review_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated review endpoints (token probing + writes)."""
    if not _public_review_limiter.check(_client_ip(request), time.monotonic()):
        raise TooManyRequests("too many requests — please wait a moment")
