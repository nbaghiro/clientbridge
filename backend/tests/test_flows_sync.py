"""Every sync-writable table accepts a PUT, a PATCH and a DELETE from the device."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.sync.upload import WRITE_POLICY
from tests.conftest import BIZ
from tests.helpers import column, ok, removed


def _writes() -> list[tuple[str, dict[str, object], dict[str, object]]]:
    return [
        (
            "hours",
            {
                "staff_id": "st_diego",
                "basis": "recurring",
                "weekday": 0,
                "start_time": "09:00:00",
                "end_time": "12:00:00",
                "available": 1,
            },
            {"end_time": "13:00:00"},
        ),
    ]


async def test_sync_upload_writes_each_policy_table(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    writes = _writes()
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
