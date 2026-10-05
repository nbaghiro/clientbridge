from typing import Literal

from pydantic import BaseModel


class DeviceRegister(BaseModel):
    token: str
    platform: Literal["ios", "android", "web"]


class DeviceOut(BaseModel):
    registered: bool
