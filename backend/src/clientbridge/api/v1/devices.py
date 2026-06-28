from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.devices import DeviceOut, DeviceRegister
from clientbridge.services.device_service import DeviceService

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/register", response_model=DeviceOut)
async def register(body: DeviceRegister, principal: CurrentPrincipal, db: DbSession) -> DeviceOut:
    await DeviceService(db, principal).register(body.token, body.platform)
    return DeviceOut(registered=True)
