import zoneinfo
from datetime import UTC, datetime, timedelta
from functools import cache
from importlib.metadata import version
from zoneinfo import ZoneInfo

# Zones come from the pinned tzdata package, not host zone files that may predate a rule change.
zoneinfo.reset_tzpath(to=[])

# The zones a business can use; clients take their offsets from here, never from their own data.
SUPPORTED_ZONES = (
    "America/St_Johns",
    "America/Halifax",
    "America/Toronto",
    "America/Winnipeg",
    "America/Regina",
    "America/Edmonton",
    "America/Whitehorse",
    "America/Vancouver",
)
TZDATA_VERSION = version("tzdata")
FIRST_YEAR = 2000
LAST_YEAR = 2060

Transition = tuple[int, int]


@cache
def zone(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def _offset(tz: ZoneInfo, second: int) -> int:
    offset = datetime.fromtimestamp(second, UTC).astimezone(tz).utcoffset()
    return int(offset.total_seconds() // 60) if offset is not None else 0


@cache
def transitions(name: str) -> tuple[Transition, ...]:
    """Each UTC offset the zone takes from 2000 to 2060, as (UTC second it starts, minutes)."""
    tz = zone(name)
    second = int(datetime(FIRST_YEAR, 1, 1, tzinfo=UTC).timestamp())
    end = int(datetime(LAST_YEAR + 1, 1, 1, tzinfo=UTC).timestamp())
    day = int(timedelta(days=1).total_seconds())
    found = [(second, _offset(tz, second))]
    while second < end:
        later = min(second + day, end)
        if _offset(tz, later) != found[-1][1]:
            lo, hi = second, later
            while hi - lo > 1:
                mid = (lo + hi) // 2
                lo, hi = (mid, hi) if _offset(tz, mid) == found[-1][1] else (lo, mid)
            found.append((hi, _offset(tz, hi)))
        second = later
    return tuple(found)
