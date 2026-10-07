from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.subjects import SubjectCreate, SubjectOut, SubjectUpdate
from clientbridge.services.subjects import SubjectService

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.post("", response_model=SubjectOut, status_code=201)
async def create_subject(
    body: SubjectCreate, principal: CurrentPrincipal, db: DbSession
) -> SubjectOut:
    return SubjectOut.model_validate(await SubjectService(db, principal).create(body))


@router.patch("/{subject_id}", response_model=SubjectOut)
async def update_subject(
    subject_id: str, body: SubjectUpdate, principal: CurrentPrincipal, db: DbSession
) -> SubjectOut:
    return SubjectOut.model_validate(await SubjectService(db, principal).update(subject_id, body))


@router.delete("/{subject_id}", status_code=204)
async def delete_subject(subject_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await SubjectService(db, principal).delete(subject_id)
