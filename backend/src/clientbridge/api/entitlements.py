from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.entitlements import (
    GiftCardOut,
    GiftCardPurchase,
    GiftCardPurchaseOut,
    GiftCardRedeem,
    PackageOut,
    PackagePurchase,
    PackagePurchaseOut,
    SubscriptionCreate,
    SubscriptionOut,
)
from clientbridge.services.entitlements import GiftCardService, PackageService, SubscriptionService

gift_cards_router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])


@gift_cards_router.post("", response_model=GiftCardPurchaseOut, status_code=201)
async def purchase_gift_card(
    body: GiftCardPurchase,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardPurchaseOut:
    return await GiftCardService(db, principal, gateway).purchase_gift_card(body, idempotency_key)


@gift_cards_router.post("/redeem", response_model=GiftCardOut)
async def redeem_gift_card(
    body: GiftCardRedeem,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GiftCardOut:
    return await GiftCardService(db, principal, gateway).redeem_gift_card(body, idempotency_key)


packages_router = APIRouter(prefix="/packages", tags=["packages"])


@packages_router.post("", response_model=PackagePurchaseOut, status_code=201)
async def purchase_package(
    body: PackagePurchase,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PackagePurchaseOut:
    return await PackageService(db, principal, gateway).purchase_package(body, idempotency_key)


@packages_router.post("/{package_id}/consume", response_model=PackageOut)
async def consume_session(
    package_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PackageOut:
    return await PackageService(db, principal, gateway).consume_session(package_id, idempotency_key)


subscriptions_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@subscriptions_router.post("", response_model=SubscriptionOut, status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SubscriptionOut:
    return await SubscriptionService(db, principal, gateway).create_subscription(
        body, idempotency_key
    )


@subscriptions_router.post("/{subscription_id}/cancel", response_model=SubscriptionOut)
async def cancel_subscription(
    subscription_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SubscriptionOut:
    return await SubscriptionService(db, principal, gateway).cancel_subscription(
        subscription_id, idempotency_key
    )
