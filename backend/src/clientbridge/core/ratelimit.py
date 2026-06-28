import time
from collections import defaultdict, deque

from fastapi import Request

from clientbridge.core.errors import TooManyRequests


class RateLimiter:
    """A fixed-window sliding limiter (in-process). Good enough as a per-instance abuse backstop; a
    multi-instance deploy should swap the store for Redis."""

    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, now: float) -> bool:
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True


_public_pay_limiter = RateLimiter(limit=30, window_s=60.0)


def public_pay_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated pay endpoints (they mint Stripe objects)."""
    key = request.client.host if request.client else "unknown"
    if not _public_pay_limiter.check(key, time.monotonic()):
        raise TooManyRequests("too many payment attempts — please wait a moment")
