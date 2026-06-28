from fastapi import APIRouter

from clientbridge.core.deps import DbSession, GatewayDep
from clientbridge.schemas.payments import InteracRequest, PublicCardIntent, PublicInvoice
from clientbridge.services.public_pay_service import PublicPayService

router = APIRouter(prefix="/pay", tags=["public-pay"])


@router.get("/{token}", response_model=PublicInvoice)
async def public_invoice(token: str, db: DbSession, gateway: GatewayDep) -> PublicInvoice:
    return await PublicPayService(db, gateway).invoice(token)


@router.post("/{token}/card", response_model=PublicCardIntent)
async def public_pay_card(token: str, db: DbSession, gateway: GatewayDep) -> PublicCardIntent:
    return await PublicPayService(db, gateway).pay_card(token)


@router.post("/{token}/interac", response_model=InteracRequest)
async def public_pay_interac(token: str, db: DbSession, gateway: GatewayDep) -> InteracRequest:
    return await PublicPayService(db, gateway).pay_interac(token)
