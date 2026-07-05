from datetime import UTC, date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import Item
from clientbridge.services.availability_service import open_windows
from clientbridge.services.booking_service import conflicting_session
from clientbridge.services.business_service import business_tz


async def open_slots(
    db: AsyncSession, business_id: str, item: Item, staff_id: str, on_date: date
) -> list[datetime]:
    """Bookable start times for ``item`` with ``staff_id`` on ``on_date`` (UTC). Steps the staff's
    open windows by the item's duration + buffers and drops any candidate that `assert_free`-style
    overlaps an existing booking — the read mirror of the invariant `create_booking_core` enforces.

    An unconfigured day (no availability rows) yields no slots: the write path treats it as "no
    restriction" and can't be enumerated, so online booking shows slots only once hours are set.
    """
    duration = item.duration_min
    if duration is None or duration <= 0:
        return []
    windows = await open_windows(db, staff_id, business_id, on_date)
    if not windows:
        return []
    tz = await business_tz(db, business_id)
    step = duration + item.buffer_before_min + item.buffer_after_min
    slots: list[datetime] = []
    for window_start, window_end in windows:
        # window times are local wall-clock; anchor them in the business tz, then work in UTC
        start = datetime.combine(on_date, window_start, tzinfo=tz).astimezone(UTC)
        limit = datetime.combine(on_date, window_end, tzinfo=tz).astimezone(UTC)
        while start + timedelta(minutes=duration) <= limit:
            end = start + timedelta(minutes=duration)
            if not await conflicting_session(db, business_id, item, staff_id, start, end):
                slots.append(start)
            start += timedelta(minutes=step)
    return slots
