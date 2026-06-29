from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.gift_cards import GiftCardIssue, GiftCardOut, GiftCardRedeem
from clientbridge.services.gift_card_service import GiftCardService

router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])


@router.post("", response_model=GiftCardOut, status_code=201)
async def issue_gift_card(
    body: GiftCardIssue,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardOut:
    return await GiftCardService(db, principal).issue_gift_card(body, idempotency_key)


@router.post("/redeem", response_model=GiftCardOut)
async def redeem_gift_card(
    body: GiftCardRedeem,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardOut:
    return await GiftCardService(db, principal).redeem_gift_card(body, idempotency_key)
