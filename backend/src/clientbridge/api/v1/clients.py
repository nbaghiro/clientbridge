from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.core.pagination import Page, PageQuery
from clientbridge.schemas.crm import ClientCreate, ClientOut, ClientUpdate
from clientbridge.services.client_service import ClientService

router = APIRouter(prefix="/clients", tags=["clients"])


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
