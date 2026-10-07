from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.core.scoping import Page, PageQuery
from clientbridge.schemas.clients import (
    BulkResult,
    ClientCreate,
    ClientIds,
    ClientMerge,
    ClientOut,
    ClientTags,
    ClientUpdate,
)
from clientbridge.services.clients import ClientService

router = APIRouter(prefix="/clients", tags=["clients"])

IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key")]


@router.get("", response_model=Page[ClientOut])
async def list_clients(
    principal: CurrentPrincipal, db: DbSession, page: PageQuery
) -> Page[ClientOut]:
    items, total = await ClientService(db, principal).list(limit=page.limit, offset=page.offset)
    return Page(
        items=[ClientOut.model_validate(c) for c in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post("", response_model=ClientOut, status_code=201)
async def create_client(
    body: ClientCreate, principal: CurrentPrincipal, db: DbSession
) -> ClientOut:
    client = await ClientService(db, principal).create(body)
    return ClientOut.model_validate(client)


@router.post("/archive", response_model=BulkResult)
async def archive_clients(
    body: ClientIds,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> BulkResult:
    return await ClientService(db, principal).archive_many(body, idempotency_key)


@router.post("/tags", response_model=BulkResult)
async def tag_clients(
    body: ClientTags,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> BulkResult:
    return await ClientService(db, principal).tag_many(body, idempotency_key)


@router.get("/{client_id}", response_model=ClientOut)
async def get_client(client_id: str, principal: CurrentPrincipal, db: DbSession) -> ClientOut:
    client = await ClientService(db, principal).get(client_id)
    return ClientOut.model_validate(client)


@router.patch("/{client_id}", response_model=ClientOut)
async def update_client(
    client_id: str, body: ClientUpdate, principal: CurrentPrincipal, db: DbSession
) -> ClientOut:
    client = await ClientService(db, principal).update(client_id, body)
    return ClientOut.model_validate(client)


@router.delete("/{client_id}", status_code=204)
async def delete_client(client_id: str, principal: CurrentPrincipal, db: DbSession) -> None:
    await ClientService(db, principal).delete(client_id)


@router.post("/{client_id}/archive", response_model=ClientOut)
async def archive_client(
    client_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> ClientOut:
    return await ClientService(db, principal).set_archived(
        client_id, archived=True, idempotency_key=idempotency_key
    )


@router.post("/{client_id}/restore", response_model=ClientOut)
async def restore_client(
    client_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> ClientOut:
    return await ClientService(db, principal).set_archived(
        client_id, archived=False, idempotency_key=idempotency_key
    )


@router.post("/{client_id}/merge", response_model=ClientOut)
async def merge_clients(
    client_id: str,
    body: ClientMerge,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: IdempotencyKey = None,
) -> ClientOut:
    return await ClientService(db, principal).merge(client_id, body, idempotency_key)
