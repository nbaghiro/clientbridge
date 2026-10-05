"""The /sync/upload write path, run as the demo owner over the seeded DB."""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

BIZ = "bz_birchbark"


async def _scalar(db: AsyncSession, sql: str) -> object:
    return (await db.execute(text(sql))).scalar()


async def test_put_patch_delete_contract(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    def op(kind: str, data: dict[str, object] | None = None) -> dict[str, object]:
        return {"ops": [{"op": kind, "type": "contracts", "id": "con_upload", "data": data}]}

    put = op("PUT", {"business_id": BIZ, "name": "Policy", "body": "Terms"})
    assert (await as_owner.post("/sync/upload", json=put)).status_code == 200
    assert await _scalar(db, "SELECT name FROM contracts WHERE id='con_upload'") == "Policy"

    patch = op("PATCH", {"name": "Policy v2"})
    assert (await as_owner.post("/sync/upload", json=patch)).status_code == 200
    assert await _scalar(db, "SELECT name FROM contracts WHERE id='con_upload'") == "Policy v2"

    assert (await as_owner.post("/sync/upload", json=op("DELETE"))).status_code == 200
    assert await _scalar(db, "SELECT count(*) FROM contracts WHERE id='con_upload'") == 0


@pytest.mark.parametrize(
    ("table", "row_id"),
    [
        ("clients", "cl_amelie"),
        ("subjects", "sj_bella"),
        ("notes", "nt_x"),
        ("messages", "msg_x"),
        ("items", "it_groom_sm"),
        ("resources", "rs_station_a"),
    ],
)
async def test_tables_written_by_commands_are_refused(
    as_owner: httpx.AsyncClient, table: str, row_id: str
) -> None:
    op = {"op": "PATCH", "type": table, "id": row_id, "data": {"name": "Synced"}}
    res = await as_owner.post("/sync/upload", json={"ops": [op]})
    assert res.status_code == 403


async def test_rejects_server_only_table(as_owner: httpx.AsyncClient) -> None:
    # payments are server-authoritative — not writable via sync
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [{"op": "PUT", "type": "payments", "id": "pay_x", "data": {"business_id": BIZ}}]
        },
    )
    assert res.status_code == 403


async def test_rejects_broadcast_sync_write(as_owner: httpx.AsyncClient) -> None:
    # sending broadcasts is the /v1/broadcasts command (audited + cron) — never a sync write
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "broadcasts",
                    "id": "bc_x",
                    "data": {"business_id": BIZ, "status": "scheduled", "channel": "sms"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_rejects_faking_an_inbound_message(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "messages",
                    "id": "msg_fake",
                    "data": {"business_id": BIZ, "direction": "in", "status": "delivered"},
                }
            ]
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
                    "type": "forms",
                    "id": "frm_x",
                    "data": {"business_id": "bz_nope", "name": "x"},
                }
            ]
        },
    )
    assert res.status_code == 403


async def test_admin_table_ok_for_owner(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    form = {"business_id": BIZ, "name": "A"}
    op = {"op": "PUT", "type": "forms", "id": "frm_upload", "data": form}
    res = await as_owner.post("/sync/upload", json={"ops": [op]})
    assert res.status_code == 200
    assert await _scalar(db, "SELECT name FROM forms WHERE id='frm_upload'") == "A"


async def test_admin_table_refused_for_staff(as_staff: httpx.AsyncClient) -> None:
    form = {"business_id": BIZ, "name": "A"}
    op = {"op": "PUT", "type": "forms", "id": "frm_upload", "data": form}
    res = await as_staff.post("/sync/upload", json={"ops": [op]})
    assert res.status_code == 403


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
                    "type": "forms",
                    "id": "frm_satisfaction",
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
                    "type": "forms",
                    "id": "frm_satisfaction",
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


async def test_hours_recurring_put_and_delete(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # PUT — owner sets a recurring Monday window for a staff member (Time coerced from "HH:MM:SS")
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "hours",
                    "id": "av_test_mon",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_diego",
                        "basis": "recurring",
                        "weekday": 0,
                        "start_time": "09:00:00",
                        "end_time": "17:00:00",
                        "available": 1,
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT weekday FROM hours WHERE id='av_test_mon'") == 0
    assert str(await _scalar(db, "SELECT start_time FROM hours WHERE id='av_test_mon'")) == (
        "09:00:00"
    )

    # DELETE — hours has no soft-delete column, so the row is hard-deleted (replace-all path)
    res = await as_owner.post(
        "/sync/upload",
        json={"ops": [{"op": "DELETE", "type": "hours", "id": "av_test_mon"}]},
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT id FROM hours WHERE id='av_test_mon'") is None


async def test_staff_sets_own_hours(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    # own_only: a non-admin staff may write their OWN hours (st_diego == us_diego)
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "hours",
                    "id": "av_diego_own",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_diego",
                        "basis": "recurring",
                        "weekday": 2,
                        "start_time": "10:00:00",
                        "end_time": "16:00:00",
                        "available": 1,
                    },
                }
            ]
        },
    )
    assert res.status_code == 200
    assert await _scalar(db, "SELECT weekday FROM hours WHERE id='av_diego_own'") == 2


async def test_staff_cannot_set_others_hours(as_staff: httpx.AsyncClient) -> None:
    # own_only: a non-admin staff cannot touch another staff member's hours
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "hours",
                    "id": "av_owner_x",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": "st_owner",
                        "basis": "recurring",
                        "weekday": 0,
                        "available": 0,
                    },
                }
            ]
        },
    )
    assert res.status_code == 403
