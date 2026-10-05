from typing import Annotated

from fastapi import APIRouter, Depends, Header

from clientbridge.core.deps import DbSession, EmailDep, Principal, require_role
from clientbridge.schemas.staff import InviteBody, InviteOut, StaffPayOut, StaffPayUpdate
from clientbridge.services.staff import StaffService

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


@router.patch("/{staff_id}/pay", response_model=StaffPayOut)
async def update_pay(
    staff_id: str, body: StaffPayUpdate, principal: AdminPrincipal, db: DbSession
) -> StaffPayOut:
    return await StaffService(db).update_pay(principal, staff_id, body)
