from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business, SubjectKind
from clientbridge.models.clients import Client, Subject
from clientbridge.schemas.subjects import ATTRIBUTES, SubjectCreate, SubjectUpdate


async def subject_kind(db: AsyncSession, business_id: str) -> SubjectKind | None:
    found = await db.execute(select(Business.subject).where(Business.id == business_id))
    return found.scalar_one_or_none()


def typed_attributes(kind: SubjectKind | None, attributes: dict[str, object]) -> dict[str, object]:
    if kind is None:
        return {k: v for k, v in attributes.items() if v is not None}
    try:
        typed = ATTRIBUTES[kind].model_validate(attributes)
    except ValidationError as e:
        raise Unprocessable(
            "the subject's details did not validate",
            code="invalid_request",
            detail={"errors": e.errors(include_url=False, include_context=False)},
        ) from e
    return typed.model_dump(mode="json", exclude_none=True)


async def new_subject(
    db: AsyncSession, business_id: str, client_id: str, name: str, attributes: dict[str, object]
) -> Subject:
    kind = await subject_kind(db, business_id)
    if kind is None:
        raise Conflict("this business books only the client", code="no_subjects")
    return Subject(
        id=new_id("subject"),
        business_id=business_id,
        client_id=client_id,
        name=name.strip(),
        attributes=typed_attributes(kind, attributes),
    )


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
        client = await self.db.execute(
            scoped(Client, self.biz, soft_delete=True).where(Client.id == data.client_id)
        )
        if client.scalar_one_or_none() is None:
            raise NotFound("client not found")
        subject = await new_subject(self.db, self.biz, data.client_id, data.name, data.attributes)
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
            kind = await subject_kind(self.db, self.biz)
            subject.attributes = typed_attributes(kind, data.attributes)
        await self.db.flush()
        await self.db.refresh(subject)
        await self.db.commit()
        return subject

    async def delete(self, subject_id: str) -> None:
        subject = await self._get(subject_id)
        subject.deleted_at = clock.now()
        await self.db.commit()
