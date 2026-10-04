from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from clientbridge.core.deps import DbSession, StorageDep
from clientbridge.services.media_service import public_media_location

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/{file_id}", response_class=RedirectResponse, status_code=302)
async def public_media(file_id: str, db: DbSession, storage: StorageDep) -> RedirectResponse:
    location = await public_media_location(db, storage, file_id)
    return RedirectResponse(location, status_code=302, headers={"Cache-Control": "max-age=300"})
