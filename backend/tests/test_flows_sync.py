"""Every sync-writable table accepts a PUT, a PATCH and a DELETE from the device."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.sync.upload import WRITE_POLICY
from tests.conftest import BIZ
from tests.flows import column, ok, removed

CLIENT = "cl_amelie"


def _writes(thread_id: str) -> list[tuple[str, dict[str, object], dict[str, object]]]:
    return [
        ("clients", {"name": "Synced", "tags": "[]", "custom_fields": "{}"}, {"name": "Renamed"}),
        ("subjects", {"client_id": CLIENT, "kind": "pet", "name": "Biscuit"}, {"name": "Bis"}),
        (
            "notes",
            {"parent_type": "client", "parent_id": CLIENT, "body": "Allergic to oats"},
            {"body": "Allergic to oats and wheat"},
        ),
        (
            "messages",
            {"thread_id": thread_id, "direction": "out", "channel": "sms", "body": "Draft"},
            {"body": "Edited"},
        ),
        (
            "availability",
            {
                "staff_id": "st_diego",
                "type": "recurring",
                "weekday": 0,
                "start_time": "09:00:00",
                "end_time": "12:00:00",
                "is_available": 1,
            },
            {"end_time": "13:00:00"},
        ),
        ("items", {"kind": "service", "name": "Synced Service"}, {"name": "Renamed Service"}),
        ("resources", {"name": "Room 9", "kind": "room"}, {"name": "Room 10"}),
        ("forms", {"name": "Intake"}, {"name": "Intake v2"}),
        (
            "form_fields",
            {"form_id": "frm_satisfaction", "type": "text", "name": "pet", "label": "Pet"},
            {"label": "Pet name"},
        ),
        ("contracts", {"name": "Policy", "body": "Terms"}, {"body": "New terms"}),
    ]


async def test_sync_upload_writes_each_policy_table(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    thread = ok(
        await api.post(
            "/v1/messages", json={"client_id": CLIENT, "channel": "sms", "body": "Hello"}
        )
    ).json()["thread_id"]
    writes = _writes(thread)
    assert {table for table, _, _ in writes} == set(WRITE_POLICY)

    for table, data, patch in writes:
        row_id = f"sync_{table}"
        put = {"op": "PUT", "type": table, "id": row_id, "data": {"business_id": BIZ, **data}}
        ok(await api.post("/sync/upload", json={"ops": [put]}))
        assert await column(db, table, row_id, "business_id") == BIZ

        [(field, value)] = patch.items()
        edit = {"op": "PATCH", "type": table, "id": row_id, "data": patch}
        ok(await api.post("/sync/upload", json={"ops": [edit]}))
        assert str(await column(db, table, row_id, field)) == value

        drop = {"op": "DELETE", "type": table, "id": row_id}
        ok(await api.post("/sync/upload", json={"ops": [drop]}))
        assert await removed(db, table, row_id), table
