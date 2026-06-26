"""Integration tests for the /sync/upload write path (against the seeded DB).

Calls run as the demo owner (us_dev) via the `as_owner` client; the db fixture rolls back each test.
"""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice

BIZ = "bz_birchbark"


async def _scalar(db: AsyncSession, sql: str) -> object:
    return (await db.execute(text(sql))).scalar()


async def test_put_patch_delete_client(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    # PUT — create a client (as the demo owner)
    res = await as_owner.post(
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
    res = await as_owner.post(
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
    res = await as_owner.post(
        "/sync/upload", json={"ops": [{"op": "DELETE", "type": "clients", "id": "cl_test_upload"}]}
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT deleted_at FROM clients WHERE id='cl_test_upload'") is not None


async def test_rejects_server_only_table(as_owner: httpx.AsyncClient) -> None:
    # payments are server-authoritative — not writable via sync
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [{"op": "PUT", "type": "payments", "id": "pay_x", "data": {"business_id": BIZ}}]
        },
    )
    assert res.status_code == 403


async def test_rejects_foreign_business(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
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


async def test_admin_table_ok_for_owner(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    # resources require owner/admin; the dev user IS the owner, so a clean write succeeds.
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "resources",
                    "id": "rs_test_upload",
                    "data": {"business_id": BIZ, "name": "Room 1", "kind": "room"},
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT name FROM resources WHERE id='rs_test_upload'") == "Room 1"


async def test_rejects_command_only_field(as_owner: httpx.AsyncClient) -> None:
    # invoice numbering/status/money are command-only — a sync write may not set them.
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "invoices",
                    "id": "inv_x",
                    "data": {
                        "business_id": BIZ,
                        "client_id": "cl_amelie",
                        "number": 1,
                        "status": "paid",
                    },
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_rejects_cross_tenant_move(as_owner: httpx.AsyncClient) -> None:
    # a write can't relocate an existing row to another business
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "clients",
                    "id": "cl_amelie",
                    "data": {"business_id": "bz_other"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_rejects_server_timestamps(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "clients",
                    "id": "cl_amelie",
                    "data": {"created_at": "2020-01-01T00:00:00+00:00"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_locked_invoice_is_immutable(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    # a paid invoice can't be edited via sync — even a benign field — only via a command
    db.add(
        Invoice(
            id="inv_locked", business_id=BIZ, client_id="cl_amelie", number=990001, status="paid"
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [{"op": "PATCH", "type": "invoices", "id": "inv_locked", "data": {"notes": "x"}}]
        },
    )
    assert res.status_code == 403
