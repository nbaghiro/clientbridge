from typing import Annotated

from fastapi import APIRouter, Depends

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
) -> InviteOut:
    staff, raw = await StaffService(db).create_invite(
        business_id=principal.business_id,
        email_sender=email_sender,
        email=body.email,
        role=body.role,
    )
    return InviteOut(
        id=staff.id, email=body.email, role=staff.role, status=staff.status, invite_token=raw
    )
