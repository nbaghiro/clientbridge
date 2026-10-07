from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.notes import NoteCreate, NoteOut, NoteUpdate
from clientbridge.services.notes import NoteService

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(body: NoteCreate, principal: CurrentPrincipal, db: DbSession) -> NoteOut:
    return NoteOut.model_validate(await NoteService(db, principal).create(body))


@router.patch("/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: str, body: NoteUpdate, principal: CurrentPrincipal, db: DbSession
) -> NoteOut:
    return NoteOut.model_validate(await NoteService(db, principal).update(note_id, body))


@router.delete("/{note_id}", status_code=204)
async def delete_note(note_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await NoteService(db, principal).delete(note_id)
