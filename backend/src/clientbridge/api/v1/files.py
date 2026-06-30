from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession, StorageDep
from clientbridge.schemas.files import FileCreate, FileDownload, FileUpload
from clientbridge.services.file_service import FileService

router = APIRouter(prefix="/files", tags=["files"])


@router.post("", response_model=FileUpload, status_code=201)
async def create_file(
    body: FileCreate, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileUpload:
    return await FileService(db, principal, storage).create(body)


@router.get("/{file_id}/url", response_model=FileDownload)
async def file_download_url(
    file_id: str, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileDownload:
    return await FileService(db, principal, storage).download_url(file_id)
