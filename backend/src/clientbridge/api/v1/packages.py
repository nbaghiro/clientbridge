from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.packages import PackageOut, PackagePurchase, PackagePurchaseOut
from clientbridge.services.package_service import PackageService

router = APIRouter(prefix="/packages", tags=["packages"])


@router.post("", response_model=PackagePurchaseOut, status_code=201)
async def purchase_package(
    body: PackagePurchase,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PackagePurchaseOut:
    return await PackageService(db, principal, gateway).purchase_package(body, idempotency_key)


@router.post("/{package_id}/consume", response_model=PackageOut)
async def consume_session(
    package_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PackageOut:
    return await PackageService(db, principal, gateway).consume_session(package_id, idempotency_key)
