from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.core.errors import Unprocessable
from clientbridge.schemas.forms import (
    FormAnswersOut,
    FormOut,
    FormResponseOut,
    FormSave,
    FormSend,
    TreatmentNoteCreate,
    TreatmentNoteOut,
    TreatmentNotes,
)
from clientbridge.services.deliveries import send_queued
from clientbridge.services.forms import FormService, TreatmentNoteService

router = APIRouter(prefix="/forms", tags=["forms"])


@router.post("/send", response_model=FormResponseOut, status_code=201)
async def send_form(
    body: FormSend,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> FormResponseOut:
    result = await FormService(db, principal).send_form(body, idempotency_key)
    await send_queued(db, email, sms, push)
    return result


@router.post("", response_model=FormOut, status_code=201)
async def create_form(
    body: FormSave,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> FormOut:
    return await FormService(db, principal).create_form(body, idempotency_key)


@router.patch("/{form_id}", response_model=FormOut)
async def update_form(
    form_id: str, body: FormSave, principal: CurrentPrincipal, db: DbSession
) -> FormOut:
    return await FormService(db, principal).update_form(form_id, body)


@router.post("/treatment-notes", response_model=TreatmentNoteOut, status_code=201)
async def write_treatment_note(
    body: TreatmentNoteCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TreatmentNoteOut:
    return await TreatmentNoteService(db, principal).write(body, idempotency_key)


@router.get("/treatment-notes", response_model=TreatmentNotes)
async def treatment_notes(
    principal: CurrentPrincipal,
    db: DbSession,
    booking_id: str | None = None,
    client_id: str | None = None,
) -> TreatmentNotes:
    """A visit's notes, or every note on a client's visits; each one read is audited."""
    notes = TreatmentNoteService(db, principal)
    if booking_id is not None and client_id is None:
        return await notes.for_booking(booking_id)
    if client_id is not None and booking_id is None:
        return await notes.for_client(client_id)
    raise Unprocessable("name a booking_id or a client_id")


@router.get("/responses/{response_id}", response_model=FormAnswersOut)
async def form_response(
    response_id: str, principal: CurrentPrincipal, db: DbSession
) -> FormAnswersOut:
    return await TreatmentNoteService(db, principal).response(response_id)
