"""The tenant scoping helpers carry the same business_id (+ soft-delete) guard — the write-side
helpers verified by compiled SQL, the read-side helpers by real rows across two businesses."""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped_count, scoped_delete, scoped_page, scoped_update
from clientbridge.models.billing import Line
from clientbridge.models.crm import Client
from tests.conftest import Factory


def test_scoped_update_filters_business_and_soft_delete() -> None:
    sql = str(
        scoped_update(Client, "bz_1", soft_delete=True)
        .values(name="x")
        .compile(compile_kwargs={"literal_binds": True})
    )
    assert "clients.business_id = 'bz_1'" in sql
    assert "clients.deleted_at IS NULL" in sql


def test_scoped_update_omits_soft_delete_by_default() -> None:
    sql = str(
        scoped_update(Line, "bz_1")
        .values(position=0)
        .compile(compile_kwargs={"literal_binds": True})
    )
    assert "lines.business_id = 'bz_1'" in sql
    assert "deleted_at" not in sql


def test_scoped_delete_filters_business() -> None:
    sql = str(
        scoped_delete(Line, "bz_1")
        .where(Line.parent_id == "ord_1")
        .compile(compile_kwargs={"literal_binds": True})
    )
    assert "lines.business_id = 'bz_1'" in sql
    assert "lines.parent_id = 'ord_1'" in sql


async def test_scoped_reads_isolate_business_and_soft_delete(db: AsyncSession) -> None:
    f = Factory(db)
    biz1 = await f.business(name="One")
    biz2 = await f.business(name="Two")
    keep = await f.client(business=biz1, name="Keep")
    gone = await f.client(business=biz1, name="Gone")
    gone.deleted_at = datetime.now(UTC)
    await f.client(business=biz2, name="Other")
    await db.flush()

    # live rows are this business's, minus tombstones
    assert await scoped_count(db, Client, biz1.id, soft_delete=True) == 1
    live = await scoped_page(db, Client, biz1.id, limit=50, offset=0, soft_delete=True)
    assert [c.id for c in live] == [keep.id]

    # without the soft-delete guard the tombstoned row is still counted — biz2's never is
    assert await scoped_count(db, Client, biz1.id) == 2
    ids = {c.id for c in await scoped_page(db, Client, biz1.id, limit=50, offset=0)}
    assert ids == {keep.id, gone.id}
