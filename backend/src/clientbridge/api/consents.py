from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.consents import ConsentExport
from clientbridge.services.consents import ConsentService

router = APIRouter(prefix="/consents", tags=["consents"])


@router.post("/export", response_model=ConsentExport)
async def export_consents(principal: CurrentPrincipal, db: DbSession) -> ConsentExport:
    return await ConsentService(db, principal).export()
