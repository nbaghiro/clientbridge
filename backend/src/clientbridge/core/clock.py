"""The one source of the current time; tests and the seed start it at a fixed instant."""

import time
from datetime import UTC, date, datetime, timedelta, tzinfo

_start: datetime | None = None
_started_at = 0.0
_ticking = True


def wall() -> datetime:
    """Real UTC time, for checks against a clock outside this app (auth, PowerSync, Svix)."""
    return datetime.now(UTC)


def now() -> datetime:
    if _start is None:
        return wall()
    if not _ticking:
        return _start
    return _start + timedelta(seconds=time.monotonic() - _started_at)


def today(zone: tzinfo) -> date:
    return now().astimezone(zone).date()


def travel(at: datetime, *, tick: bool = True) -> None:
    global _start, _started_at, _ticking
    _start, _started_at, _ticking = at.astimezone(UTC), time.monotonic(), tick


def freeze(at: datetime | None = None) -> None:
    travel(now() if at is None else at, tick=False)


def reset() -> None:
    global _start, _ticking
    _start, _ticking = None, True
