"""The clients REST endpoints, end-to-end against the seeded DB."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

BIZ = "bz_birchbark"


async def test_list_is_business_scoped(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/clients", params={"limit": 5})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] > 0
    assert len(body["items"]) <= 5
    assert all(c["business_id"] == BIZ for c in body["items"])


async def test_create_get_update_delete(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Test Client", "email": "t@example.com"})
    assert res.status_code == 201, res.text
    created = res.json()
    cid = created["id"]
    assert cid.startswith("cl_")
    assert created["business_id"] == BIZ

    res = await as_owner.get(f"/v1/clients/{cid}")
    assert res.status_code == 200
    assert res.json()["name"] == "Test Client"

    res = await as_owner.patch(f"/v1/clients/{cid}", json={"name": "Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed"

    res = await as_owner.delete(f"/v1/clients/{cid}")
    assert res.status_code == 204

    # soft delete: gone from scoped reads, but the row survives with deleted_at set
    res = await as_owner.get(f"/v1/clients/{cid}")
    assert res.status_code == 404
    deleted_at = (
        await db.execute(text("SELECT deleted_at FROM clients WHERE id = :i"), {"i": cid})
    ).scalar()
    assert deleted_at is not None


async def test_get_missing_returns_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/clients/cl_does_not_exist")
    assert res.status_code == 404
