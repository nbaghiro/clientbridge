from typing import Annotated

from fastapi import APIRouter, Depends, Header

from clientbridge.core.deps import DbSession, EmailDep, Principal, require_role
from clientbridge.schemas.identity import InviteBody, InviteOut
from clientbridge.services.staff_service import StaffService

router = APIRouter(prefix="/staff", tags=["staff"])

AdminPrincipal = Annotated[Principal, Depends(require_role("owner", "admin"))]


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    body: InviteBody,
    principal: AdminPrincipal,
    db: DbSession,
    email: EmailDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InviteOut:
    return await StaffService(db).create_invite(
        principal,
        email_sender=email,
        email=body.email,
        role=body.role,
        idempotency_key=idempotency_key,
    )
