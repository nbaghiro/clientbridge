import calendar
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.scheduling import Schedule
from clientbridge.schemas.bookings import ScheduleCreate, ScheduleOccurrence, ScheduleOut
from clientbridge.services.availability_service import business_tz
from clientbridge.services.booking_service import (
    assert_can_act_as,
    create_booking_core,
    load_client,
    load_item,
    load_staff,
)

_WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
_MAX_OCCURRENCES = 60  # a full year of weekly + headroom; caps runaway/unbounded rules


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year, month = d.year + total // 12, total % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def expand_occurrences(
    *,
    start_date: date,
    frequency: str,
    interval: int,
    byday: Sequence[str] | None,
    count: int | None,
    until: date | None,
) -> list[date]:
    """Occurrence dates for a recurrence rule, bounded by count/until and a hard cap. Weekly
    honours `byday` (else the start date's weekday); monthly clamps to the last valid day."""
    interval = max(1, interval)
    limit = min(count if count is not None else _MAX_OCCURRENCES, _MAX_OCCURRENCES)
    dates: list[date] = []

    if frequency == "weekly":
        weekdays = sorted({_WEEKDAY_CODES[d] for d in byday}) if byday else [start_date.weekday()]
        week_start = start_date - timedelta(days=start_date.weekday())
        for week in range(limit * interval + 8):
            base = week_start + timedelta(weeks=week * interval)
            for wd in weekdays:
                d = base + timedelta(days=wd)
                if d < start_date:
                    continue
                if until is not None and d > until:
                    return dates
                dates.append(d)
                if len(dates) >= limit:
                    return dates
        return dates

    for step in range(limit):
        cur = (
            start_date + timedelta(days=step * interval)
            if frequency == "daily"
            else _add_months(start_date, step * interval)
        )
        if until is not None and cur > until:
            break
        dates.append(cur)
    return dates


class ScheduleService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: ScheduleCreate, idempotency_key: str | None) -> ScheduleOut:
        """Persist a recurrence and expand it into confirmed bookings, one per occurrence. An
        occurrence that falls outside hours or overlaps an existing booking is skipped (rolled back
        to its savepoint) and reported, so a single clash never fails the whole series."""
        assert_can_act_as(self.principal, data.staff_id)
        if data.count is None and data.until is None:
            raise AppError("a recurring schedule needs an end: set count or until", status_code=422)
        item = await load_item(self.db, self.biz, data.item_id)
        if item.duration_min is None or item.duration_min <= 0:
            raise AppError("that service has no duration and can't be booked", status_code=422)
        await load_client(self.db, self.biz, data.client_id)
        await load_staff(self.db, self.biz, data.staff_id)

        base = data.starts_at
        # Keep the intended wall-clock time (in the business tz) and re-localize it per occurrence
        # date, so occurrences across a DST boundary land at the same local time — NOT at the first
        # occurrence's fixed UTC offset (which would drift an hour after the transition).
        tz = await business_tz(self.db, self.biz)
        aware = base if base.tzinfo is not None else base.replace(tzinfo=UTC)
        local_time = aware.astimezone(tz).time()
        occ_dates = expand_occurrences(
            start_date=base.date(),
            frequency=data.frequency,
            interval=data.interval,
            byday=data.byday,
            count=data.count,
            until=data.until,
        )

        async def run(cmd: Command) -> ScheduleOut:
            schedule = Schedule(
                id=new_id("schedule"),
                business_id=self.biz,
                item_id=item.id,
                staff_id=data.staff_id,
                client_id=data.client_id,
                frequency=data.frequency,
                interval=data.interval,
                byday=data.byday,
                count=data.count,
                until=data.until,
                start_date=base.date(),
                status="active",
            )
            self.db.add(schedule)
            await self.db.flush()

            occurrences: list[ScheduleOccurrence] = []
            created = 0
            for d in occ_dates:
                starts_at = datetime.combine(d, local_time, tzinfo=tz).astimezone(UTC)
                try:
                    async with self.db.begin_nested():
                        booking, _ = await create_booking_core(
                            self.db,
                            self.biz,
                            item=item,
                            staff_id=data.staff_id,
                            starts_at=starts_at,
                            client_id=data.client_id,
                            source="manual",
                            subject_id=data.subject_id,
                            resource_id=data.resource_id,
                            recurrence_id=schedule.id,
                        )
                    created += 1
                    occurrences.append(
                        ScheduleOccurrence(starts_at=starts_at, booking_id=booking.id, skipped=None)
                    )
                except Conflict as exc:
                    occurrences.append(
                        ScheduleOccurrence(starts_at=starts_at, booking_id=None, skipped=str(exc))
                    )

            cmd.record("schedule.create", entity_type="schedule", entity_id=schedule.id)
            return ScheduleOut(
                id=schedule.id,
                business_id=self.biz,
                item_id=schedule.item_id,
                staff_id=schedule.staff_id,
                client_id=schedule.client_id,
                frequency=schedule.frequency,
                interval=schedule.interval,
                status=schedule.status,
                created=created,
                skipped=len(occurrences) - created,
                occurrences=occurrences,
            )

        return await run_command(
            self.db,
            self.principal,
            action="schedule.create",
            run=run,
            response_model=ScheduleOut,
            idempotency_key=idempotency_key,
        )
