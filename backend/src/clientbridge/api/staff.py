from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep
from clientbridge.schemas.staff import (
    InviteBody,
    InviteOut,
    RoleUpdate,
    StaffPayOut,
    StaffPayUpdate,
    TeamOut,
)
from clientbridge.services.staff import StaffService

router = APIRouter(prefix="/staff", tags=["staff"])


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    body: InviteBody,
    principal: CurrentPrincipal,
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
    staff_id: str, body: StaffPayUpdate, principal: CurrentPrincipal, db: DbSession
) -> StaffPayOut:
    return await StaffService(db).update_pay(principal, staff_id, body)


@router.get("/team", response_model=TeamOut)
async def team(principal: CurrentPrincipal, db: DbSession) -> TeamOut:
    return await StaffService(db).team(principal)


@router.post("/invites/{invite_id}/resend", response_model=InviteOut)
async def resend_invite(
    invite_id: str, principal: CurrentPrincipal, db: DbSession, email: EmailDep
) -> InviteOut:
    return await StaffService(db).resend_invite(principal, invite_id, email_sender=email)


@router.post("/invites/{invite_id}/revoke", status_code=204)
async def revoke_invite(invite_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await StaffService(db).revoke_invite(principal, invite_id)


@router.patch("/{staff_id}", status_code=204)
async def change_role(
    staff_id: str, body: RoleUpdate, principal: CurrentPrincipal, db: DbSession
) -> None:
    await StaffService(db).change_role(principal, staff_id, body)


@router.delete("/{staff_id}", status_code=204)
async def remove_member(staff_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await StaffService(db).remove(principal, staff_id)
