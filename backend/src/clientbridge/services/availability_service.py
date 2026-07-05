from datetime import UTC, date, datetime, time

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.models.scheduling import Availability
from clientbridge.services.business_service import business_tz


async def open_windows(
    db: AsyncSession, staff_id: str, business_id: str, on_date: date
) -> list[tuple[time, time]] | None:
    """The staff member's open work intervals (local business-tz wall-clock) on `on_date`.

    Returns ``None`` when the day is unconfigured — no date override and no recurring window for its
    weekday — and callers treat that as "no restriction". An empty list means explicitly closed.
    Date-specific rows override the recurring weekday windows for that date.
    """
    rows = (
        (
            await db.execute(
                scoped(Availability, business_id).where(Availability.staff_id == staff_id)
            )
        )
        .scalars()
        .all()
    )
    date_rows = [r for r in rows if r.type == "date" and r.date == on_date]
    if date_rows:
        if any(not r.is_available and r.start_time is None for r in date_rows):
            return []
        return [
            (r.start_time or time.min, r.end_time or time.max) for r in date_rows if r.is_available
        ]
    weekday_rows = [r for r in rows if r.type == "recurring" and r.weekday == on_date.weekday()]
    if not weekday_rows:
        return None
    return [
        (r.start_time or time.min, r.end_time or time.max) for r in weekday_rows if r.is_available
    ]


def _as_utc(dt: datetime) -> datetime:
    return (dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)).astimezone(UTC)


async def is_within_availability(
    db: AsyncSession, staff_id: str, business_id: str, start: datetime, end: datetime
) -> bool:
    """Whether ``[start, end]`` sits inside an open window on its date, or the day is unconfigured.

    Windows are local wall-clock, so the session instants are converted into the business timezone
    before comparing time-of-day (and picking the local date whose windows apply)."""
    tz = await business_tz(db, business_id)
    start_local, end_local = _as_utc(start).astimezone(tz), _as_utc(end).astimezone(tz)
    windows = await open_windows(db, staff_id, business_id, start_local.date())
    if windows is None:
        return True
    if end_local.date() != start_local.date():
        return False
    return any(ws <= start_local.time() and end_local.time() <= we for ws, we in windows)
