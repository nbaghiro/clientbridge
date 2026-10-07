from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Subject
from clientbridge.schemas.subjects import SubjectCreate, SubjectUpdate
from clientbridge.services.clients import load_client


class SubjectService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def _get(self, subject_id: str) -> Subject:
        row = (
            await self.db.execute(
                scoped(Subject, self.biz, soft_delete=True).where(Subject.id == subject_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("subject not found")
        return row

    async def create(self, data: SubjectCreate) -> Subject:
        await load_client(self.db, self.biz, data.client_id)
        subject = Subject(
            id=new_id("subject"),
            business_id=self.biz,
            client_id=data.client_id,
            kind=data.kind,
            name=data.name.strip(),
            attributes=data.attributes.model_dump(mode="json", exclude_none=True),
        )
        self.db.add(subject)
        await self.db.flush()
        await self.db.refresh(subject)
        await self.db.commit()
        return subject

    async def update(self, subject_id: str, data: SubjectUpdate) -> Subject:
        subject = await self._get(subject_id)
        if data.name is not None:
            subject.name = data.name.strip()
        if data.attributes is not None:
            subject.attributes = data.attributes.model_dump(mode="json", exclude_none=True)
        await self.db.flush()
        await self.db.refresh(subject)
        await self.db.commit()
        return subject

    async def delete(self, subject_id: str) -> None:
        subject = await self._get(subject_id)
        subject.deleted_at = datetime.now(UTC)
        await self.db.commit()
