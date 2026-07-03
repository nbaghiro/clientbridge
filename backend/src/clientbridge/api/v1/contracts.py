from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.contracts import ContractSend, SignatureOut
from clientbridge.services.contract_service import ContractService
from clientbridge.services.notification_service import Notifier

router = APIRouter(prefix="/contracts", tags=["contracts"])


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
