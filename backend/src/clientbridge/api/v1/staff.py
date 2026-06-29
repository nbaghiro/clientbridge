from typing import Annotated

from fastapi import APIRouter, Depends, Header

from clientbridge.core.deps import DbSession, Principal, require_role
from clientbridge.integrations.email import EmailSender, get_email_sender
from clientbridge.schemas.identity import InviteBody, InviteOut
from clientbridge.services.staff_service import StaffService

router = APIRouter(prefix="/staff", tags=["staff"])


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    body: InviteBody,
    principal: Annotated[Principal, Depends(require_role("owner", "admin"))],
    db: DbSession,
    email_sender: Annotated[EmailSender, Depends(get_email_sender)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InviteOut:
    return await StaffService(db).create_invite(
        principal,
        email_sender=email_sender,
        email=body.email,
        role=body.role,
        idempotency_key=idempotency_key,
    )
