"""Item-specific receipts, authorization and atomicity for retryable catalog creation."""

import asyncio
import uuid

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit, IdempotencyKey
from clientbridge.schemas.catalog import ItemCreate
from clientbridge.services.catalog import CatalogService
from tests.conftest import BIZ, OWNER_USER, STAFF_USER, FakeIdentityProvider, session_token


async def test_create_replays_one_item_audit_and_receipt_and_refuses_changed_body(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    key = f"catalog-{uuid.uuid4().hex}"
    body = {"kind": "product", "name": "Gentle Paw Balm", "track_stock": True}
    headers = {"Idempotency-Key": key}
    first = await as_owner.post("/v1/items", json=body, headers=headers)
    assert first.status_code == 201, first.text
    replayed = await as_owner.post("/v1/items", json=body, headers=headers)
    assert replayed.status_code == 201 and replayed.json() == first.json()
    changed = await as_owner.post("/v1/items", json={**body, "name": "Other Balm"}, headers=headers)
    assert changed.status_code == 422 and changed.json()["error"] == "idempotency_key_reused"
    item_id = first.json()["id"]
    audits = (await db.scalars(select(Audit).where(Audit.entity_id == item_id))).all()
    receipts = (await db.scalars(select(IdempotencyKey).where(IdempotencyKey.key == key))).all()
    assert len(audits) == len(receipts) == 1
    assert audits[0].action == receipts[0].scope == "item.create"
    assert receipts[0].response["id"] == item_id
    assert (await db.get(Item, item_id)) is not None


async def test_staff_cannot_replay_an_owner_create(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    body = {"kind": "product", "name": "Owner's Paw Balm"}
    key = f"catalog-{uuid.uuid4().hex}"
    headers = {"Idempotency-Key": key}
    created = await as_owner.post("/v1/items", json=body, headers=headers)
    assert created.status_code == 201
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
    denied = await as_owner.post("/v1/items", json=body, headers=headers)
    assert denied.status_code == 403
    receipts = (await db.scalars(select(IdempotencyKey).where(IdempotencyKey.key == key))).all()
    assert len(receipts) == 1


async def test_sku_rejection_leaves_no_create_receipt_or_partial_item(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sku = f"BALM-{uuid.uuid4().hex}"
    first = await as_owner.post("/v1/items", json={"kind": "product", "name": "Balm", "sku": sku})
    assert first.status_code == 201
    key = f"catalog-{uuid.uuid4().hex}"
    body = {"kind": "product", "name": f"Second Balm {key}", "sku": sku}
    denied = await as_owner.post("/v1/items", json=body, headers={"Idempotency-Key": key})
    assert denied.status_code == 409
    assert (await db.scalars(select(Item).where(Item.name == body["name"]))).all() == []
    assert (await db.scalars(select(IdempotencyKey).where(IdempotencyKey.key == key))).all() == []
    corrected = await as_owner.post(
        "/v1/items", json={**body, "sku": None}, headers={"Idempotency-Key": f"{key}-corrected"}
    )
    assert corrected.status_code == 201


async def test_concurrent_item_create_has_one_item_audit_and_receipt(db: AsyncSession) -> None:
    key = f"catalog-race-{uuid.uuid4().hex}"
    name = f"Gentle Balm {key}"
    principal = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")
    ready = asyncio.Event()
    count = 0

    async def create() -> str:
        nonlocal count
        async with SessionLocal() as session:
            count += 1
            if count == 2:
                ready.set()
            await ready.wait()
            result = await CatalogService(session, principal).create(
                ItemCreate(kind="product", name=name), key
            )
            return result.id

    try:
        async with asyncio.TaskGroup() as group:
            first_task = group.create_task(create())
            second_task = group.create_task(create())
        first, second = first_task.result(), second_task.result()
        assert first == second
        async with SessionLocal() as check:
            items = (await check.scalars(select(Item).where(Item.name == name))).all()
            audits = (await check.scalars(select(Audit).where(Audit.entity_id == first))).all()
            receipts = (
                await check.scalars(select(IdempotencyKey).where(IdempotencyKey.key == key))
            ).all()
            assert len(items) == len(audits) == len(receipts) == 1
            assert audits[0].action == receipts[0].scope == "item.create"
    finally:
        async with SessionLocal() as cleanup:
            ids = select(Item.id).where(Item.name == name)
            await cleanup.execute(delete(Audit).where(Audit.entity_id.in_(ids)))
            await cleanup.execute(delete(Item).where(Item.name == name))
            await cleanup.execute(delete(IdempotencyKey).where(IdempotencyKey.key == key))
            await cleanup.commit()
