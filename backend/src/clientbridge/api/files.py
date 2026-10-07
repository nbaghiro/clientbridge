from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession, StorageDep
from clientbridge.schemas.files import FileCreate, FileUpload
from clientbridge.services.files import FileService

router = APIRouter(prefix="/files", tags=["files"])


@router.post("", response_model=FileUpload, status_code=201)
async def create_file(
    body: FileCreate, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileUpload:
    return await FileService(db, principal, storage).create(body)
