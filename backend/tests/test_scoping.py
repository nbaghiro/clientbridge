"""Unit: the write-side tenant scoping helpers carry the same business_id (+ soft-delete) guard."""

from clientbridge.core.scoping import scoped_delete, scoped_update
from clientbridge.models.billing import Line
from clientbridge.models.crm import Client


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
