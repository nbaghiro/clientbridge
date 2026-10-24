from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.resources import ResourceCreate, ResourceOut, ResourceUpdate
from clientbridge.services.resources import ResourceService

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("", response_model=list[ResourceOut])
async def list_resources(principal: CurrentPrincipal, db: DbSession) -> list[ResourceOut]:
    return await ResourceService(db, principal).read()


@router.post("", response_model=ResourceOut, status_code=201)
async def create_resource(
    body: ResourceCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ResourceOut:
    return await ResourceService(db, principal).create(body, idempotency_key)


@router.patch("/{resource_id}", response_model=ResourceOut)
async def update_resource(
    resource_id: str,
    body: ResourceUpdate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ResourceOut:
    return await ResourceService(db, principal).update(resource_id, body, idempotency_key)
