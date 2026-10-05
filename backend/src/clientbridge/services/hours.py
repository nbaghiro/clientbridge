from datetime import UTC, date, datetime, time

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.models.scheduling import Hours
from clientbridge.services.business import business_tz


async def open_windows(
    db: AsyncSession, staff_id: str, business_id: str, on_date: date
) -> list[tuple[time, time]] | None:
    """Open work intervals on a date; None when the day has no hours set, [] when closed."""
    rows = (
        (await db.execute(scoped(Hours, business_id).where(Hours.staff_id == staff_id)))
        .scalars()
        .all()
    )
    date_rows = [r for r in rows if r.basis == "date" and r.date == on_date]
    if date_rows:
        if any(not r.available and r.start_time is None for r in date_rows):
            return []
        return [
            (r.start_time or time.min, r.end_time or time.max) for r in date_rows if r.available
        ]
    weekday_rows = [r for r in rows if r.basis == "recurring" and r.weekday == on_date.weekday()]
    if not weekday_rows:
        return None
    return [(r.start_time or time.min, r.end_time or time.max) for r in weekday_rows if r.available]


def _as_utc(dt: datetime) -> datetime:
    return (dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)).astimezone(UTC)


async def is_within_availability(
    db: AsyncSession, staff_id: str, business_id: str, start: datetime, end: datetime
) -> bool:
    """Whether the window sits inside open hours on its local date, or the day has none set."""
    tz = await business_tz(db, business_id)
    start_local, end_local = _as_utc(start).astimezone(tz), _as_utc(end).astimezone(tz)
    windows = await open_windows(db, staff_id, business_id, start_local.date())
    if windows is None:
        return True
    if end_local.date() != start_local.date():
        return False
    return any(ws <= start_local.time() and end_local.time() <= we for ws, we in windows)
