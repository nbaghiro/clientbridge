from pydantic import BaseModel

from clientbridge.core.mirrors import Mirror
from clientbridge.models.platform import Device, DevicePlatform


class DeviceRegister(Mirror):
    mirrors = Device

    token: str
    platform: DevicePlatform


class DeviceUnregister(Mirror):
    mirrors = Device

    token: str


class DeviceOut(BaseModel):
    registered: bool
