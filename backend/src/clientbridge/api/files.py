from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, StorageDep
from clientbridge.schemas.files import FileCreate, FileLink, FileOut, FileUpload
from clientbridge.services.files import FileService

router = APIRouter(prefix="/files", tags=["files"])


@router.post("", response_model=FileUpload, status_code=201)
async def create_file(
    body: FileCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    storage: StorageDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> FileUpload:
    return await FileService(db, principal, storage).create(body, idempotency_key)


@router.post("/{file_id}/complete", response_model=FileOut)
async def complete_file(
    file_id: str, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileOut:
    return await FileService(db, principal, storage).complete(file_id)


@router.get("/{file_id}/link", response_model=FileLink)
async def file_link(
    file_id: str, principal: CurrentPrincipal, db: DbSession, storage: StorageDep
) -> FileLink:
    return await FileService(db, principal, storage).link(file_id)
