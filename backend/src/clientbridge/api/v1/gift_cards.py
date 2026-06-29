from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.gift_cards import (
    GiftCardOut,
    GiftCardPurchase,
    GiftCardPurchaseOut,
    GiftCardRedeem,
)
from clientbridge.services.gift_card_service import GiftCardService

router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])


@router.post("", response_model=GiftCardPurchaseOut, status_code=201)
async def purchase_gift_card(
    body: GiftCardPurchase,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardPurchaseOut:
    return await GiftCardService(db, principal, gateway).purchase_gift_card(body, idempotency_key)


@router.post("/redeem", response_model=GiftCardOut)
async def redeem_gift_card(
    body: GiftCardRedeem,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardOut:
    return await GiftCardService(db, principal, gateway).redeem_gift_card(body, idempotency_key)
