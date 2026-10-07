import time
from collections import defaultdict, deque

from fastapi import Request

from clientbridge.core.errors import TooManyRequests


class RateLimiter:
    """Fixed-window in-process limiter; a multi-instance deploy would need a shared store."""

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


class LoginGuard:
    """Pauses sign-in for an email after `limit` failed attempts inside `window_s`, in-process."""

    def __init__(self, limit: int = 5, window_s: float = 15 * 60.0) -> None:
        self.limit = limit
        self.window_s = window_s
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str, now: float) -> deque[float]:
        failures = self._failures[key]
        while failures and failures[0] <= now - self.window_s:
            failures.popleft()
        return failures

    def locked(self, email: str, now: float) -> bool:
        return len(self._recent(email.strip().lower(), now)) >= self.limit

    def failed(self, email: str, now: float) -> None:
        self._recent(email.strip().lower(), now).append(now)

    def succeeded(self, email: str) -> None:
        self._failures.pop(email.strip().lower(), None)


login_guard = LoginGuard()

_public_pay_limiter = RateLimiter(limit=30, window_s=60.0)
_public_review_limiter = RateLimiter(limit=30, window_s=60.0)
_public_form_limiter = RateLimiter(limit=30, window_s=60.0)
_public_contract_limiter = RateLimiter(limit=30, window_s=60.0)
_public_booking_limiter = RateLimiter(limit=30, window_s=60.0)


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


def public_form_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated form endpoints (token probing + submits)."""
    if not _public_form_limiter.check(_client_ip(request), time.monotonic()):
        raise TooManyRequests("too many requests — please wait a moment")


def public_contract_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated contract endpoints (token probing + signs)."""
    if not _public_contract_limiter.check(_client_ip(request), time.monotonic()):
        raise TooManyRequests("too many requests — please wait a moment")


def public_booking_rate_limit(request: Request) -> None:
    """Cap how fast one IP hits the unauthenticated booking endpoints."""
    if not _public_booking_limiter.check(_client_ip(request), time.monotonic()):
        raise TooManyRequests("too many requests — please wait a moment")
