from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, JobsDep, PushDep, SmsDep
from clientbridge.schemas.forms import (
    FormAnswersOut,
    FormOut,
    FormResponseOut,
    FormSave,
    FormSend,
)
from clientbridge.services.deliveries import send_queued
from clientbridge.services.forms import FormService

router = APIRouter(prefix="/forms", tags=["forms"])


@router.post("/send", response_model=FormResponseOut, status_code=201)
async def send_form(
    body: FormSend,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    jobs: JobsDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> FormResponseOut:
    result = await FormService(db, principal).send_form(body, idempotency_key)
    await send_queued(db, email, sms, push, jobs)
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


@router.get("/responses/{response_id}", response_model=FormAnswersOut)
async def form_response(
    response_id: str, principal: CurrentPrincipal, db: DbSession
) -> FormAnswersOut:
    return await FormService(db, principal).response(response_id)
