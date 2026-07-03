from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.forms import FormResponseOut, FormSend
from clientbridge.services.form_service import FormService
from clientbridge.services.notification_service import Notifier

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
