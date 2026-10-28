from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.core.errors import Unprocessable
from clientbridge.schemas.visit_records import VisitRecordCreate, VisitRecordOut, VisitRecords
from clientbridge.services.visit_records import VisitRecordService

router = APIRouter(prefix="/visit-records", tags=["visit-records"])


@router.post("", response_model=VisitRecordOut, status_code=201)
async def write_visit_record(
    body: VisitRecordCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> VisitRecordOut:
    return await VisitRecordService(db, principal).write(body, idempotency_key)


@router.get("", response_model=VisitRecords)
async def visit_records(
    principal: CurrentPrincipal,
    db: DbSession,
    booking_id: str | None = None,
    client_id: str | None = None,
) -> VisitRecords:
    """A visit's records, or every record on a client's visits; each one read is audited."""
    records = VisitRecordService(db, principal)
    if booking_id is not None and client_id is None:
        return await records.for_booking(booking_id)
    if client_id is not None and booking_id is None:
        return await records.for_client(client_id)
    raise Unprocessable("name a booking_id or a client_id")


@router.get("/{record_id}", response_model=VisitRecordOut)
async def visit_record(
    record_id: str, principal: CurrentPrincipal, db: DbSession
) -> VisitRecordOut:
    return await VisitRecordService(db, principal).one(record_id)
