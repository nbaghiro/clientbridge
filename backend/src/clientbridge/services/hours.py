from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, is_manager
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Staff
from clientbridge.models.scheduling import Hours
from clientbridge.schemas.hours import HoursWeekBody, HoursWeekOut, HoursWeekResult, WeekDay
from clientbridge.services.receipts import reserve_receipt


async def lock_hours(db: AsyncSession, business_id: str) -> None:
    await db.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(f"hours:{business_id}", 0)))
    )


class HoursService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def _staff(self, staff_id: str) -> Staff:
        principal = self.principal
        if not is_manager(principal.role) and staff_id != principal.staff_id:
            raise Forbidden("staff may only edit their own working week")
        staff = await self.db.scalar(
            scoped(Staff, principal.business_id).where(
                Staff.id == staff_id,
                Staff.status == "active",
            )
        )
        if staff is None:
            raise NotFound("active team member not found")
        return staff

    async def read(self, staff_id: str) -> HoursWeekOut:
        await lock_hours(self.db, self.principal.business_id)
        staff = await self._staff(staff_id)
        rows = await self.db.scalars(
            scoped(Hours, self.principal.business_id)
            .where(
                Hours.staff_id == staff_id,
                Hours.basis == "recurring",
            )
            .order_by(Hours.weekday, Hours.start_time, Hours.id)
        )
        return HoursWeekOut(
            staff_id=staff_id,
            revision=staff.hours_revision,
            days=[
                WeekDay(
                    weekday=row.weekday,
                    available=row.available,
                    start_time=row.start_time,
                    end_time=row.end_time,
                )
                for row in rows
                if row.weekday is not None
            ],
        )

    async def replace(self, staff_id: str, body: HoursWeekBody) -> HoursWeekResult:
        if body.request.business_id != self.principal.business_id:
            raise Forbidden("working week belongs to another business")
        # Check current authorization even for a receipt replay.
        await self._staff(staff_id)

        async def run(cmd: Command) -> HoursWeekResult:
            replay = await reserve_receipt(
                body.request,
                {"command": "hours.week", "staff_id": staff_id, **body.model_dump(mode="json")},
                {"revision": body.expected_revision + 1},
                self.principal.user_id,
                self.db,
            )
            if replay is not None:
                return HoursWeekResult.model_validate(replay)
            await lock_hours(self.db, self.principal.business_id)
            # Refresh after acquiring the aggregate lock; another writer may have committed.
            self.db.expire_all()
            staff = await self._staff(staff_id)
            if staff.hours_revision != body.expected_revision:
                raise Conflict(
                    "working week changed on another device", code="hours_revision_conflict"
                )
            rows = list(
                await self.db.scalars(
                    scoped(Hours, self.principal.business_id)
                    .where(
                        Hours.staff_id == staff_id,
                        Hours.basis == "recurring",
                    )
                    .with_for_update()
                )
            )
            if len({row.weekday for row in rows}) != len(rows):
                raise Conflict(
                    "split working days need review before replacing the week",
                    code="hours_split_week",
                )
            existing = {row.weekday: row for row in rows}
            for day in body.days:
                row = existing.get(day.weekday)
                if row is None:
                    row = Hours(
                        id=new_id("hours"),
                        business_id=self.principal.business_id,
                        staff_id=staff_id,
                        basis="recurring",
                        weekday=day.weekday,
                    )
                    self.db.add(row)
                row.available = day.available
                row.start_time = day.start_time
                row.end_time = day.end_time
            staff.hours_revision += 1
            await self.db.flush()
            cmd.record(
                "hours.week",
                entity_type="staff",
                entity_id=staff_id,
                changes={"revision": staff.hours_revision},
            )
            return HoursWeekResult(revision=staff.hours_revision)

        return await run_command(
            self.db, self.principal, action="hours.week", run=run, response_model=HoursWeekResult
        )
