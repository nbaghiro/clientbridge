from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.bookings import RecurrenceCreate, RecurrenceOut
from clientbridge.services.recurrence_service import RecurrenceService

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@router.post("", response_model=RecurrenceOut, status_code=201)
async def create_recurrence(
    body: RecurrenceCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RecurrenceOut:
    return await RecurrenceService(db, principal).create(body, idempotency_key)
