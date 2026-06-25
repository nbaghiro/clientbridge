"""Integration tests for the /sync/upload write path (against the seeded DB).

Unauthenticated dev calls act as the demo owner (us_dev); api/db fixtures roll back each test.
"""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

BIZ = "bz_birchbark"


async def _scalar(db: AsyncSession, sql: str) -> object:
    return (await db.execute(text(sql))).scalar()


async def test_put_patch_delete_client(api: httpx.AsyncClient, db: AsyncSession) -> None:
    # PUT — create a client (as the demo owner)
    res = await api.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "clients",
                    "id": "cl_test_upload",
                    "data": {
                        "business_id": BIZ,
                        "name": "Test McUpload",
                        "status": "active",
                        "tags": "[]",
                        "custom_fields": "{}",
                        "lifetime_value_cents": 0,
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
    assert (
        await _scalar(db, "SELECT name FROM clients WHERE id='cl_test_upload'") == "Test McUpload"
    )

    # PATCH — rename
    res = await api.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "clients",
                    "id": "cl_test_upload",
                    "data": {"name": "Renamed"},
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT name FROM clients WHERE id='cl_test_upload'") == "Renamed"

    # DELETE — soft delete
    res = await api.post(
        "/sync/upload", json={"ops": [{"op": "DELETE", "type": "clients", "id": "cl_test_upload"}]}
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT deleted_at FROM clients WHERE id='cl_test_upload'") is not None


async def test_rejects_server_only_table(api: httpx.AsyncClient) -> None:
    # payments are server-authoritative — not writable via sync
    res = await api.post(
        "/sync/upload",
        json={
            "ops": [{"op": "PUT", "type": "payments", "id": "pay_x", "data": {"business_id": BIZ}}]
        },
    )
    assert res.status_code == 403


async def test_rejects_foreign_business(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "clients",
                    "id": "cl_x",
                    "data": {"business_id": "bz_nope", "name": "x"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_admin_table_ok_for_owner(api: httpx.AsyncClient) -> None:
    # invoices require owner/admin; the dev user IS the owner, so it succeeds.
    res = await api.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "invoices",
                    "id": "inv_test_upload",
                    "data": {
                        "business_id": BIZ,
                        "client_id": "cl_amelie",
                        "number": 999001,
                        "status": "draft",
                        "currency": "CAD",
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
