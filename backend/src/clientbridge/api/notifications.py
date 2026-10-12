from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.notifications import DeviceOut, DeviceRegister, DeviceUnregister
from clientbridge.services.notifications import DeviceService

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/register", response_model=DeviceOut)
async def register(body: DeviceRegister, principal: CurrentPrincipal, db: DbSession) -> DeviceOut:
    await DeviceService(db, principal).register(body.token, body.platform)
    return DeviceOut(registered=True)


@router.post("/unregister", response_model=DeviceOut)
async def unregister(
    body: DeviceUnregister, principal: CurrentPrincipal, db: DbSession
) -> DeviceOut:
    await DeviceService(db, principal).unregister(body.token)
    return DeviceOut(registered=False)
