from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, is_manager
from clientbridge.core.errors import Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Note, Subject
from clientbridge.schemas.notes import NoteCreate, NoteUpdate
from clientbridge.services.clients import load_client


class NoteService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def _parent(self, parent_type: str, parent_id: str) -> None:
        if parent_type == "client":
            await load_client(self.db, self.biz, parent_id)
            return
        found = (
            await self.db.execute(
                scoped(Subject, self.biz, soft_delete=True).where(Subject.id == parent_id)
            )
        ).scalar_one_or_none()
        if found is None:
            raise NotFound("subject not found")

    async def _own(self, note_id: str) -> Note:
        note = (
            await self.db.execute(scoped(Note, self.biz).where(Note.id == note_id))
        ).scalar_one_or_none()
        if note is None:
            raise NotFound("note not found")
        if not is_manager(self.principal.role) and note.created_by != self.principal.user_id:
            raise Forbidden("staff can change only the notes they wrote")
        return note

    async def create(self, data: NoteCreate) -> Note:
        await self._parent(data.parent_type, data.parent_id)
        note = Note(
            id=new_id("note"),
            business_id=self.biz,
            created_by=self.principal.user_id,
            parent_type=data.parent_type,
            parent_id=data.parent_id,
            body=data.body.strip(),
            pinned=data.pinned,
        )
        self.db.add(note)
        await self.db.flush()
        await self.db.refresh(note)
        await self.db.commit()
        return note

    async def update(self, note_id: str, data: NoteUpdate) -> Note:
        note = await self._own(note_id)
        if data.body is not None:
            note.body = data.body.strip()
        if data.pinned is not None:
            note.pinned = data.pinned
        await self.db.flush()
        await self.db.refresh(note)
        await self.db.commit()
        return note

    async def delete(self, note_id: str) -> None:
        note = await self._own(note_id)
        await self.db.delete(note)
        await self.db.commit()
