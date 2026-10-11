from fastapi import APIRouter, Response

from clientbridge.core.zones import SUPPORTED_ZONES, TZDATA_VERSION, transitions
from clientbridge.schemas.zones import ZonesOut

router = APIRouter(prefix="/zones", tags=["zones"])


@router.get("", response_model=ZonesOut)
async def list_zones(response: Response) -> ZonesOut:
    """The offsets clients show times with, so every client uses the server's time zone data."""
    response.headers["Cache-Control"] = "public, max-age=3600"
    return ZonesOut(
        version=TZDATA_VERSION,
        zones={name: list(transitions(name)) for name in SUPPORTED_ZONES},
    )
