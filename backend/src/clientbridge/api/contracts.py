from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.contracts import (
    ContractCreate,
    ContractOut,
    ContractSend,
    ContractVersionCreate,
    SignatureOut,
)
from clientbridge.services.contracts import ContractService
from clientbridge.services.notifications import Notifier

router = APIRouter(prefix="/contracts", tags=["contracts"])
signatures_router = APIRouter(prefix="/signatures", tags=["contracts"])


@router.post("/send", response_model=SignatureOut, status_code=201)
async def send_contract(
    body: ContractSend,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SignatureOut:
    return await ContractService(db, principal).send_contract(
        body, idempotency_key, Notifier(email, sms, push)
    )


@router.post("", response_model=ContractOut, status_code=201)
async def create_contract(
    body: ContractCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ContractOut:
    return await ContractService(db, principal).create_contract(body, idempotency_key)


@router.post("/{contract_id}/versions", response_model=ContractOut)
async def publish_contract_version(
    contract_id: str,
    body: ContractVersionCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ContractOut:
    return await ContractService(db, principal).publish_version(contract_id, body, idempotency_key)


@signatures_router.post("/{signature_id}/resend", response_model=SignatureOut)
async def resend_signature_request(
    signature_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SignatureOut:
    return await ContractService(db, principal).resend(
        signature_id, idempotency_key, Notifier(email, sms, push)
    )
