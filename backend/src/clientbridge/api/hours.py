from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.hours import HoursWeekBody, HoursWeekOut, HoursWeekResult
from clientbridge.services.hours import HoursService

router = APIRouter(prefix="/hours", tags=["hours"])


@router.get("/{staff_id}/week", response_model=HoursWeekOut)
async def week(staff_id: str, principal: CurrentPrincipal, db: DbSession) -> HoursWeekOut:
    return await HoursService(db, principal).read(staff_id)


@router.post("/{staff_id}/week", response_model=HoursWeekResult)
async def replace_week(
    staff_id: str, body: HoursWeekBody, principal: CurrentPrincipal, db: DbSession
) -> HoursWeekResult:
    return await HoursService(db, principal).replace(staff_id, body)
