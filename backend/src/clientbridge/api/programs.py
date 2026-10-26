from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import (
    CurrentPrincipal,
    DbSession,
    EmailDep,
    GatewayDep,
    PushDep,
    SmsDep,
)
from clientbridge.schemas.programs import (
    EnrolmentCancel,
    EnrolmentCancelOut,
    EnrolmentCreate,
    EnrolmentOut,
    ProgramCancelOut,
    ProgramCreate,
    ProgramOut,
)
from clientbridge.services.bookings import series_scope
from clientbridge.services.deliveries import dispatch_scope
from clientbridge.services.programs import ProgramService

router = APIRouter(prefix="/programs", tags=["programs"])


@router.post("", response_model=ProgramOut, status_code=201)
async def create_program(
    body: ProgramCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ProgramOut:
    return await ProgramService(db, principal).create(body, idempotency_key)


@router.post("/{program_id}/cancel", response_model=ProgramCancelOut)
async def cancel_program(
    program_id: str, principal: CurrentPrincipal, db: DbSession
) -> ProgramCancelOut:
    return await ProgramService(db, principal).cancel(program_id)


@router.post("/{program_id}/enrolments", response_model=EnrolmentOut, status_code=201)
async def enrol_in_program(
    program_id: str,
    body: EnrolmentCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EnrolmentOut:
    result = await ProgramService(db, principal).enrol(program_id, body, idempotency_key)
    await dispatch_scope(db, series_scope(result.program_id), email, sms, push)
    return result


@router.post("/{program_id}/enrolments/cancel", response_model=EnrolmentCancelOut)
async def cancel_enrolment(
    program_id: str,
    body: EnrolmentCancel,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> EnrolmentCancelOut:
    result = await ProgramService(db, principal).withdraw(program_id, body, gateway)
    await dispatch_scope(db, series_scope(result.program_id), email, sms, push)
    return result
