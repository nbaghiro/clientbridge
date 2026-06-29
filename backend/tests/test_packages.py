"""Package purchase + session-consumption command surface, against the seeded DB."""

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item, Package
from clientbridge.models.crm import Client
from tests.conftest import Factory

BIZ = "bz_birchbark"
PKG_ITEM = "it_pkg5"  # seeded package item, session_count = 5


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _package_item(db: AsyncSession, *, business_id: str = BIZ, sessions: int | None) -> str:
    item = Item(
        id=new_id("item"),
        business_id=business_id,
        kind="package",
        name="Custom Package",
        session_count=sessions,
    )
    db.add(item)
    await db.flush()
    return item.id


async def test_purchase_then_consume(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    bought = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert bought.status_code == 201, bought.text
    pkg = bought.json()
    assert pkg["id"].startswith("pkg_")
    assert pkg["client_id"] == cid
    assert pkg["sessions_total"] == 5
    assert pkg["sessions_used"] == 0
    assert pkg["status"] == "active"

    used = await as_owner.post(f"/v1/packages/{pkg['id']}/consume")
    assert used.status_code == 200, used.text
    assert used.json()["sessions_used"] == 1
    assert used.json()["status"] == "active"


async def test_purchase_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": "it_nope"})
    assert res.status_code == 404


async def test_purchase_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/packages", json={"client_id": "cl_nope", "item_id": PKG_ITEM})
    assert res.status_code == 404


async def test_purchase_non_package_item_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    item_id = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ, Item.kind == "product")))
        .scalars()
        .first()
    )
    assert item_id
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})
    assert res.status_code == 409


async def test_purchase_package_without_sessions_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_id(db)
    item_id = await _package_item(db, sessions=None)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})
    assert res.status_code == 422


async def test_consume_unknown_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/packages/pkg_nope/consume")
    assert res.status_code == 404


async def test_consume_to_full_marks_used(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    item_id = await _package_item(db, sessions=1)
    pkg = (await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})).json()
    used = await as_owner.post(f"/v1/packages/{pkg['id']}/consume")
    assert used.status_code == 200
    assert used.json()["sessions_used"] == 1
    assert used.json()["status"] == "used"
    again = await as_owner.post(f"/v1/packages/{pkg['id']}/consume")
    assert again.status_code == 409


async def test_consume_active_but_exhausted_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_id(db)
    pkg = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=cid,
        item_id=PKG_ITEM,
        sessions_total=2,
        sessions_used=2,
        status="active",
    )
    db.add(pkg)
    await db.flush()
    res = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert res.status_code == 409


async def test_staff_cannot_purchase_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_staff.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert res.status_code == 403


async def test_staff_cannot_consume_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/packages/pkg_whatever/consume")
    assert res.status_code == 403


async def test_other_business_package_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    cid = await _client_id(db)
    pkg = Package(
        id=new_id("package"),
        business_id=other.id,
        client_id=cid,
        item_id=PKG_ITEM,
        sessions_total=5,
        sessions_used=0,
        status="active",
    )
    db.add(pkg)
    await db.flush()
    res = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert res.status_code == 404


async def test_idempotent_purchase_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    headers = {"Idempotency-Key": "pkg-buy-1"}
    body = {"client_id": cid, "item_id": PKG_ITEM}
    first = await as_owner.post("/v1/packages", json=body, headers=headers)
    second = await as_owner.post("/v1/packages", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
