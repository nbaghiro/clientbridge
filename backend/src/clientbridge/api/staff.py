from typing import Annotated

from fastapi import APIRouter, Depends, Header

from clientbridge.core.deps import (
    CurrentPrincipal,
    CurrentUser,
    DbSession,
    EmailDep,
    FreshIdentity,
    GatewayDep,
    PushDep,
    SmsDep,
)
from clientbridge.core.ratelimit import public_invite_rate_limit
from clientbridge.schemas.staff import (
    AcceptInviteOut,
    InviteBody,
    InviteOut,
    InvitePreviewOut,
    InviteTokenBody,
    StaffPayOut,
    StaffPayUpdate,
    StaffRemove,
    StaffRemoveOut,
    StaffUpdate,
    TeamOut,
)
from clientbridge.services.deliveries import dispatch_scope
from clientbridge.services.staff import StaffService, removal_scope

router = APIRouter(prefix="/staff", tags=["staff"])


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    body: InviteBody,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InviteOut:
    return await StaffService(db).create_invite(
        principal,
        email_sender=email,
        gateway=gateway,
        email=body.email,
        role=body.role,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/invites/preview",
    response_model=InvitePreviewOut,
    dependencies=[Depends(public_invite_rate_limit)],
)
async def preview_invite(body: InviteTokenBody, db: DbSession) -> InvitePreviewOut:
    return await StaffService(db).preview_invite(body.token)


@router.post("/invites/accept", response_model=AcceptInviteOut)
async def accept_invite(
    body: InviteTokenBody, user: CurrentUser, identity: FreshIdentity, db: DbSession
) -> AcceptInviteOut:
    return await StaffService(db).accept_invite(user, identity, body.token)


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
    invite_id: str, principal: CurrentPrincipal, db: DbSession, email: EmailDep, gateway: GatewayDep
) -> InviteOut:
    return await StaffService(db).resend_invite(
        principal, invite_id, email_sender=email, gateway=gateway
    )


@router.post("/invites/{invite_id}/revoke", status_code=204)
async def revoke_invite(
    invite_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> None:
    await StaffService(db).revoke_invite(principal, invite_id, gateway=gateway)


@router.patch("/{staff_id}", status_code=204)
async def update_member(
    staff_id: str, body: StaffUpdate, principal: CurrentPrincipal, db: DbSession
) -> None:
    await StaffService(db).update_member(principal, staff_id, body)


@router.post("/{staff_id}/remove", response_model=StaffRemoveOut)
async def remove_member(
    staff_id: str,
    body: StaffRemove,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> StaffRemoveOut:
    result = await StaffService(db).remove(
        principal, staff_id, body, gateway=gateway, idempotency_key=idempotency_key
    )
    await dispatch_scope(db, removal_scope(staff_id), email, sms, push)
    return result
