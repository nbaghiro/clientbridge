"""The database refuses rows outside each column's vocabulary, and the API and sync turn that into
a 422 before it gets there."""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import BIZ

REFUSED = [
    "UPDATE staff SET role = 'manager' WHERE id = 'st_diego'",
    "UPDATE staff SET status = 'gone' WHERE id = 'st_diego'",
    "UPDATE staff SET rate_type = 'weekly' WHERE id = 'st_diego'",
    "UPDATE staff SET rate_cents = 100 WHERE id = 'st_diego'",
    "UPDATE staff SET user_id = 'us_dev' WHERE id = 'st_diego'",
    "UPDATE clients SET status = 'lead' WHERE id = 'cl_amelie'",
    f"UPDATE businesses SET status = 'paused' WHERE id = '{BIZ}'",
    "UPDATE files SET parent_type = 'invoice' WHERE id = (SELECT min(id) FROM files)",
    "UPDATE files SET kind = 'video' WHERE id = (SELECT min(id) FROM files)",
    "UPDATE notes SET parent_type = 'order' WHERE id = (SELECT min(id) FROM notes)",
    "UPDATE form_responses SET parent_type = 'order'",
    "UPDATE signatures SET parent_type = 'order'",
    "UPDATE items SET frequency = 'monthly' WHERE id = 'it_daycare'",
    "UPDATE schedules SET frequency = 'weekly' WHERE id = 'sch_puppy'",
    "UPDATE payments SET method = 'eft' WHERE id = (SELECT min(id) FROM payments)",
    "UPDATE payments SET kind = 'refund' WHERE parent_payment_id IS NULL",
    "UPDATE payments SET order_id = (SELECT min(id) FROM orders) WHERE invoice_id IS NOT NULL",
]


@pytest.mark.parametrize("statement", REFUSED)
async def test_database_refuses_values_outside_the_vocabulary(
    db: AsyncSession, statement: str
) -> None:
    with pytest.raises(IntegrityError):
        await db.execute(text(statement))
    await db.rollback()


async def test_client_status_outside_the_vocabulary_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Lead", "status": "lead"})
    assert res.status_code == 422
    ok = await as_owner.post("/v1/clients", json={"name": "Quiet", "status": "inactive"})
    assert ok.status_code == 201, ok.text


async def test_file_parent_outside_the_vocabulary_is_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/files", json={"parent_type": "invoice", "parent_id": "inv_1"})
    assert res.status_code == 422


async def test_sync_note_on_an_unknown_parent_is_422(as_owner: httpx.AsyncClient) -> None:
    op = {
        "op": "PUT",
        "type": "notes",
        "id": "nt_bad_parent",
        "data": {"business_id": BIZ, "parent_type": "order", "parent_id": "x", "body": "hi"},
    }
    res = await as_owner.post("/sync/upload", json={"ops": [op]})
    assert res.status_code == 422
