from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.core.scoping import Page, PageQuery
from clientbridge.schemas.catalog import ItemCreate, ItemOut, ItemUpdate, RestockIn
from clientbridge.services.catalog import CatalogService
from clientbridge.services.inventory import StockService

router = APIRouter(prefix="/items", tags=["catalog"])


@router.get("", response_model=Page[ItemOut])
async def list_items(principal: CurrentPrincipal, db: DbSession, page: PageQuery) -> Page[ItemOut]:
    items, total = await CatalogService(db, principal).list(limit=page.limit, offset=page.offset)
    return Page(
        items=[ItemOut.model_validate(i) for i in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate, principal: CurrentPrincipal, db: DbSession) -> ItemOut:
    item = await CatalogService(db, principal).create(body)
    return ItemOut.model_validate(item)


@router.get("/{item_id}", response_model=ItemOut)
async def get_item(item_id: str, principal: CurrentPrincipal, db: DbSession) -> ItemOut:
    item = await CatalogService(db, principal).get(item_id)
    return ItemOut.model_validate(item)


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


@router.delete("/{item_id}", status_code=204)
async def deactivate_item(item_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await CatalogService(db, principal).deactivate(item_id)
