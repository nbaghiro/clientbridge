from typing import Annotated

from fastapi import APIRouter, Depends

from clientbridge.core.deps import DbSession, Principal, require_role
from clientbridge.schemas.dashboard import DashboardSummary
from clientbridge.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

AdminPrincipal = Annotated[Principal, Depends(require_role("owner", "admin"))]


@router.get("/summary", response_model=DashboardSummary)
async def summary(principal: AdminPrincipal, db: DbSession) -> DashboardSummary:
    return await DashboardService(db, principal).summary()
