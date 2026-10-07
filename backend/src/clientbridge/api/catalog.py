from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.catalog import (
    ItemCreate,
    ItemOut,
    ItemUpdate,
    RestockIn,
    TaxClassChange,
    TaxClassResult,
)
from clientbridge.services.catalog import CatalogService
from clientbridge.services.inventory import StockService

router = APIRouter(prefix="/items", tags=["catalog"])


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate, principal: CurrentPrincipal, db: DbSession) -> ItemOut:
    item = await CatalogService(db, principal).create(body)
    return ItemOut.model_validate(item)


@router.post("/tax-class", response_model=TaxClassResult)
async def set_tax_class(
    body: TaxClassChange,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TaxClassResult:
    return await CatalogService(db, principal).set_tax_class(body, idempotency_key)


@router.patch("/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: str, body: ItemUpdate, principal: CurrentPrincipal, db: DbSession
) -> ItemOut:
    item = await CatalogService(db, principal).update(item_id, body)
    return ItemOut.model_validate(item)


@router.post("/{item_id}/restock", response_model=ItemOut)
async def restock_item(
    item_id: str,
    body: RestockIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ItemOut:
    return await StockService(db, principal).restock(item_id, body, idempotency_key)
