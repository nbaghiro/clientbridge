"""The /sync/upload write path, run as the demo owner over the seeded DB."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import delete, insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import engine
from clientbridge.core.ids import new_id
from clientbridge.models.scheduling import Hours
from tests.conftest import Factory

BIZ = "bz_birchbark"


@pytest.mark.parametrize("protected", ["other_staff", "exception"])
async def test_concurrent_put_cannot_overwrite_a_protected_row(
    as_staff: httpx.AsyncClient, db: AsyncSession, protected: str
) -> None:
    row_id = new_id("hours")
    reader_pid = await db.scalar(text("SELECT pg_backend_pid()"))
    now = datetime.now(UTC)
    target_staff = "st_owner" if protected == "other_staff" else "st_diego"
    basis = "recurring" if protected == "other_staff" else "exception"
    async with engine.connect() as writer:
        await writer.execute(
            insert(Hours).values(
                id=row_id,
                business_id=BIZ,
                staff_id=target_staff,
                basis=basis,
                starts_at=now,
                ends_at=now + timedelta(hours=1),
                available=False,
            )
        )
        pending = asyncio.create_task(
            as_staff.post(
                "/sync/upload",
                json={
                    "ops": [
                        {
                            "op": "PUT",
                            "type": "hours",
                            "id": row_id,
                            "data": {
                                "business_id": BIZ,
                                "staff_id": "st_diego",
                                "basis": "recurring",
                                "weekday": 1,
                                "available": 1,
                            },
                        }
                    ]
                },
            )
        )
        try:
            async with asyncio.timeout(5):
                while not await writer.scalar(
                    text("SELECT pg_backend_pid() = ANY(pg_blocking_pids(:pid))"),
                    {"pid": reader_pid},
                ):
                    if pending.done():
                        raise AssertionError("upload did not wait for the concurrent insert")
                    await asyncio.sleep(0.01)
                await writer.commit()
                response = await pending
            assert response.status_code == 403, response.text
            row = await db.get(Hours, row_id)
            assert row is not None and row.staff_id == target_staff and row.basis == basis
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            await db.rollback()
            await writer.rollback()
            await writer.execute(delete(Hours).where(Hours.id == row_id))
            await writer.commit()


@pytest.mark.parametrize("operation", ["PUT", "PATCH"])
async def test_staff_cannot_reassign_their_hours(
    as_staff: httpx.AsyncClient, db: AsyncSession, operation: str
) -> None:
    data = {"staff_id": "st_owner"}
    if operation == "PUT":
        data |= {"business_id": BIZ, "basis": "recurring"}
    res = await as_staff.post(
        "/sync/upload",
        json={"ops": [{"op": operation, "type": "hours", "id": "av_st_diego_1", "data": data}]},
    )
    assert res.status_code == 403, res.text
    assert await _scalar(db, "SELECT staff_id FROM hours WHERE id='av_st_diego_1'") == "st_diego"


@pytest.mark.parametrize("operation", ["PUT", "PATCH"])
async def test_owner_cannot_reference_another_business_staff(
    as_owner: httpx.AsyncClient, factory: Factory, operation: str
) -> None:
    other = await factory.business()
    foreign = await factory.staff(business=other)
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": operation,
                    "type": "hours",
                    "id": "av_st_diego_1",
                    "data": {"business_id": BIZ, "staff_id": foreign.id, "basis": "recurring"},
                }
            ]
        },
    )
    assert res.status_code == 403, res.text


async def test_patch_uses_the_operation_id(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "hours",
                    "id": "av_st_diego_1",
                    "data": {"id": "av_relocated", "note": "Updated hours"},
                }
            ]
        },
    )
    assert res.status_code == 200, res.text
    assert await _scalar(db, "SELECT note FROM hours WHERE id='av_st_diego_1'") == "Updated hours"
    assert await _scalar(db, "SELECT id FROM hours WHERE id='av_relocated'") is None


async def _scalar(db: AsyncSession, sql: str) -> object:
    return (await db.execute(text(sql))).scalar()


async def test_patch_with_only_an_ignored_id_is_a_noop(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PATCH",
                    "type": "hours",
                    "id": "av_st_diego_1",
                    "data": {"id": "av_relocated"},
                }
            ]
        },
    )
    assert res.status_code == 200, res.text
    assert await _scalar(db, "SELECT id FROM hours WHERE id='av_st_diego_1'") == "av_st_diego_1"
    assert await _scalar(db, "SELECT id FROM hours WHERE id='av_relocated'") is None


@pytest.mark.parametrize(
    ("table", "row_id"),
    [
        ("clients", "cl_amelie"),
        ("subjects", "sj_bella"),
        ("notes", "nt_x"),
        ("messages", "msg_x"),
        ("items", "it_groom_sm"),
        ("resources", "rs_station_a"),
        ("forms", "frm_satisfaction"),
        ("fields", "fld_x"),
        ("contracts", "con_x"),
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
                    "type": "hours",
                    "id": "av_x",
                    "data": {
                        "business_id": "bz_nope",
                        "staff_id": "st_diego",
                        "basis": "recurring",
                        "weekday": 0,
                        "available": 1,
                    },
                }
            ]
        },
    )
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
                    "type": "hours",
                    "id": "av_st_diego_1",
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
                    "type": "hours",
                    "id": "av_st_diego_1",
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
