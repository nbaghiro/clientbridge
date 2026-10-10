from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession, StorageDep
from clientbridge.schemas.files import FileCreate, FileOut, FileUpload
from clientbridge.services.files import FileService

router = APIRouter(prefix="/files", tags=["files"])


@router.post("", response_model=FileUpload, status_code=201)
async def create_file(
    body: FileCreate, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileUpload:
    return await FileService(db, principal, storage).create(body)


@router.post("/{file_id}/complete", response_model=FileOut)
async def complete_file(
    file_id: str, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileOut:
    return await FileService(db, principal, storage).complete(file_id)
