from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import event, update
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import engine
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Hours
from clientbridge.services.bookings import Availability, Away, Busy
from tests.conftest import BIZ

TZ = ZoneInfo("America/Vancouver")
DAY = date(2027, 3, 2)
SLUG = "birchbark"
QUERY_CAP = 12


def _item(duration: int = 60, before: int = 0, after: int = 0) -> Item:
    return Item(
        id="it_cut",
        duration_min=duration,
        buffer_before_min=before,
        buffer_after_min=after,
    )


def _hours(*windows: tuple[time, time]) -> list[Hours]:
    return [
        Hours(basis="recurring", weekday=DAY.weekday(), start_time=a, end_time=b, available=True)
        for a, b in windows
    ]


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime.combine(DAY, time(hour, minute), tzinfo=TZ).astimezone(UTC)


def _availability(
    hours: list[Hours],
    *,
    closures: list[Away] | None = None,
    away: list[Away] | None = None,
    busy: list[Busy] | None = None,
) -> Availability:
    return Availability(
        tz=TZ,
        closures=closures or [],
        hours={"st_a": hours},
        time_off={"st_a": away or []},
        busy={"st_a": busy or []},
    )


def _busy(
    starts: datetime,
    minutes: int,
    *,
    item_id: str = "it_other",
    after: int = 0,
    full: bool = True,
) -> Busy:
    return Busy(
        id="sl_1",
        item_id=item_id,
        starts_at=starts,
        ends_at=starts + timedelta(minutes=minutes),
        before=timedelta(0),
        after=timedelta(minutes=after),
        full=full,
    )


def test_starts_follow_each_window_on_the_step_grid() -> None:
    found = _availability(_hours((time(9), time(12)), (time(13), time(14, 30))))
    starts = found.open_starts(_item(), "st_a", DAY, 60)
    assert starts == [_at(9), _at(10), _at(11), _at(13)]


def test_a_day_without_hours_or_a_member_without_rows_has_no_starts() -> None:
    found = _availability([])
    assert found.open_starts(_item(), "st_a", DAY) == []
    assert found.open_starts(_item(), "st_b", DAY) == []
    assert found.open_starts(_item(duration=0), "st_a", DAY) == []


def test_buffers_widen_the_default_step_and_keep_clear_of_other_visits() -> None:
    busy = [_busy(_at(11), 60, after=15)]
    found = _availability(_hours((time(9), time(14))), busy=busy)
    starts = found.open_starts(_item(after=15), "st_a", DAY)
    assert starts == [_at(9), _at(12, 45)]


def test_closures_and_time_off_block_overlapping_starts() -> None:
    closure = [Away(_at(9), _at(10), "Holiday")]
    away = [Away(_at(11), _at(11, 30), "Dentist")]
    found = _availability(_hours((time(9), time(13))), closures=closure, away=away)
    assert found.open_starts(_item(), "st_a", DAY, 30) == [_at(10), _at(11, 30), _at(12)]


def test_a_class_session_with_seats_stays_open_and_an_excluded_slot_is_ignored() -> None:
    session = _busy(_at(10), 60, item_id="it_cut", full=False)
    found = _availability(_hours((time(9), time(12))), busy=[session])
    assert found.open_starts(_item(), "st_a", DAY, 60) == [_at(9), _at(10), _at(11)]
    taken = _availability(_hours((time(9), time(12))), busy=[_busy(_at(10), 60)])
    assert taken.open_starts(_item(), "st_a", DAY, 60) == [_at(9), _at(11)]
    assert taken.open_starts(_item(), "st_a", DAY, 60, exclude="sl_1") == [
        _at(9),
        _at(10),
        _at(11),
    ]


@contextmanager
def _counting() -> Iterator[list[str]]:
    seen: list[str] = []

    def count(_conn: Connection, _cursor: object, statement: str, *_: object) -> None:
        seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)


async def _queries(api: httpx.AsyncClient, path: str) -> int:
    with _counting() as seen:
        res = await api.get(path)
    assert res.status_code == 200, res.text
    return len(seen)


async def test_public_days_and_slots_read_a_fixed_number_of_times(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    start = date.today() + timedelta(days=1)
    base = f"/book/{SLUG}/days?item_id=it_nails&staff_id=any&from={start}"
    await _queries(api, f"{base}&days=1")
    one = await _queries(api, f"{base}&days=1")
    fourteen = await _queries(api, f"{base}&days=14")
    assert one == fourteen and fourteen <= QUERY_CAP
    slots = f"/book/{SLUG}/slots?item_id=it_nails&date={start}"
    assert await _queries(api, f"{slots}&staff_id=any") <= QUERY_CAP
    assert await _queries(api, f"{slots}&staff_id=st_owner") <= QUERY_CAP
    openings = f"/book/{SLUG}/next-openings?item_ids=it_nails&item_ids=it_bath"
    assert await _queries(api, openings) <= QUERY_CAP
    coarse = await _queries(api, f"{slots}&staff_id=any")
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"step_min": 15})
    )
    assert await _queries(api, f"{slots}&staff_id=any") == coarse
