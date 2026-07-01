"""Integration tests for the /sync/upload write path (against the seeded DB).

Calls run as the demo owner (us_dev) via the `as_owner` client; the db fixture rolls back each test.
"""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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


async def test_rejects_minting_a_gift_card(as_owner: httpx.AsyncClient) -> None:
    # gift_cards balance is server-authoritative — a client can't mint store credit via sync
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "gift_cards",
                    "id": "gc_x",
                    "data": {"business_id": BIZ, "code": "FREE", "balance_cents": 100000},
                }
            ]
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


async def test_command_only_table_rejected(as_owner: httpx.AsyncClient) -> None:
    # invoices are fully command-driven (numbering/totals/tax/lifecycle) — not sync-writable at all.
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "invoices",
                    "id": "inv_x",
                    "data": {"business_id": BIZ, "client_id": "cl_amelie"},
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


async def test_rejects_writing_a_file(as_owner: httpx.AsyncClient) -> None:
    # files are server-minted (the s3_key can't be forged) — created only via the file command.
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "files",
                    "id": "fl_x",
                    "data": {
                        "business_id": BIZ,
                        "parent_type": "client",
                        "parent_id": "cl_amelie",
                        "s3_key": "forged/key",
                    },
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_rejects_setting_item_stripe_price(as_owner: httpx.AsyncClient) -> None:
    # stripe_price_id caches the recurring Price the subscription command mints — command-only.
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "items",
                    "id": "it_groom_sm",
                    "data": {"stripe_price_id": "price_forged"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_item_field_edit_still_works(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "items",
                    "id": "it_groom_sm",
                    "data": {"name": "Renamed Groom"},
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT name FROM items WHERE id='it_groom_sm'") == "Renamed Groom"


async def test_availability_recurring_put_and_delete(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # PUT — owner sets a recurring Monday window for a staff member (Time coerced from "HH:MM:SS")
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "availability",
                    "id": "av_test_mon",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_diego",
                        "type": "recurring",
                        "weekday": 0,
                        "start_time": "09:00:00",
                        "end_time": "17:00:00",
                        "is_available": 1,
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT weekday FROM availability WHERE id='av_test_mon'") == 0
    assert str(await _scalar(db, "SELECT start_time FROM availability WHERE id='av_test_mon'")) == (
        "09:00:00"
    )

    # DELETE — availability has no soft-delete column, so the row is hard-deleted (replace-all path)
    res = await as_owner.post(
        "/sync/upload",
        json={"ops": [{"op": "DELETE", "type": "availability", "id": "av_test_mon"}]},
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT id FROM availability WHERE id='av_test_mon'") is None


async def test_staff_sets_own_availability(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    # own_only: a non-admin staff may write their OWN availability (st_diego == us_diego)
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "availability",
                    "id": "av_diego_own",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_diego",
                        "type": "recurring",
                        "weekday": 2,
                        "start_time": "10:00:00",
                        "end_time": "16:00:00",
                        "is_available": 1,
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT weekday FROM availability WHERE id='av_diego_own'") == 2


async def test_staff_cannot_set_others_availability(as_staff: httpx.AsyncClient) -> None:
    # own_only: a non-admin staff cannot touch another staff member's availability
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "availability",
                    "id": "av_owner_x",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_owner",
                        "type": "recurring",
                        "weekday": 0,
                        "is_available": 0,
                    },
                }
            ]
        },
    )
    assert res.status_code == 403
