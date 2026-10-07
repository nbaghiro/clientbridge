from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.forms import FormOut, FormResponseOut, FormSave, FormSend
from clientbridge.services.forms import FormService
from clientbridge.services.notifications import Notifier

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
    return await FormService(db, principal).send_form(
        body, idempotency_key, Notifier(email, sms, push)
    )


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
