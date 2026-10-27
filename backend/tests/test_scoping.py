"""The tenant scoping helpers all apply the same business and soft-delete guard."""

import pytest
from sqlalchemy import Column, MetaData, String, Table, delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock, ids
from clientbridge.core.policies import TABLE_POLICIES, TablePolicy, table_policy_errors
from clientbridge.core.scoping import confine_to_namespace, scoped, scoped_delete, scoped_update
from clientbridge.models import Base
from clientbridge.models.billing import Line
from clientbridge.models.business import Business, User
from clientbridge.models.clients import Client
from tests.conftest import Factory
from tests.helpers import EnvSettings


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
        .where(Line.order_id == "ord_1")
        .compile(compile_kwargs={"literal_binds": True})
    )
    assert "lines.business_id = 'bz_1'" in sql
    assert "lines.order_id = 'ord_1'" in sql


async def test_scoped_reads_isolate_business_and_soft_delete(db: AsyncSession) -> None:
    f = Factory(db)
    biz1 = await f.business(name="One")
    biz2 = await f.business(name="Two")
    keep = await f.client(business=biz1, name="Keep")
    gone = await f.client(business=biz1, name="Gone")
    gone.deleted_at = clock.now()
    await f.client(business=biz2, name="Other")
    await db.flush()

    live = (await db.execute(scoped(Client, biz1.id, soft_delete=True))).scalars().all()
    assert [c.id for c in live] == [keep.id]
    every = (await db.execute(scoped(Client, biz1.id))).scalars().all()
    assert {c.id for c in every} == {keep.id, gone.id}


def test_every_model_has_an_explicit_matching_table_policy() -> None:
    assert table_policy_errors(Base.metadata) == ()
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        assert isinstance(table, Table)
        assert TABLE_POLICIES[table.name].owner == mapper.class_.__module__.rsplit(".", 1)[1]


def test_table_policy_guard_rejects_new_and_removed_tables() -> None:
    metadata = MetaData()
    for table in Base.metadata.tables.values():
        table.to_metadata(metadata)
    Table("unclassified", metadata, Column("id", String, primary_key=True))
    assert "unclassified: missing table policy" in table_policy_errors(metadata)
    metadata.remove(metadata.tables["clients"])
    assert "clients: policy has no table" in table_policy_errors(metadata)


@pytest.mark.parametrize(
    ("name", "policy", "message"),
    [
        ("clients", TablePolicy("tenant", "client_id", "clients"), "expected tenant key"),
        ("staff", TablePolicy("identity", None, "business"), "scope disagrees"),
        ("businesses", TablePolicy("tenant", "business_id", "business"), "expected tenant key"),
        ("users", TablePolicy("routing", None, "business"), "identity scope required"),
        ("webhooks", TablePolicy("operational", None, "platform"), "routing scope required"),
        ("commands", TablePolicy("operational", "business_id", "platform"), "scope disagrees"),
        ("clients", TablePolicy("tenant", "business_id", ""), "domain owner required"),
    ],
)
def test_table_policy_guard_rejects_incorrect_declarations(
    name: str, policy: TablePolicy, message: str
) -> None:
    policies = {**TABLE_POLICIES, name: policy}
    assert any(message in error for error in table_policy_errors(Base.metadata, policies))


@pytest.mark.parametrize("nullable", [False, True])
def test_table_policy_guard_rejects_invalid_tenant_columns(nullable: bool) -> None:
    metadata = MetaData()
    Table("businesses", metadata, Column("id", String, primary_key=True))
    Table("clients", metadata, Column("business_id", String, nullable=nullable))
    policies = {name: TABLE_POLICIES[name] for name in metadata.tables}
    errors = table_policy_errors(metadata, policies)
    assert "clients: tenant key must reference businesses.id" in errors
    assert ("clients: tenant key must be non-null" in errors) == nullable


@pytest.mark.parametrize("has_id", [False, True])
def test_table_policy_guard_requires_tenant_root_primary_key(has_id: bool) -> None:
    metadata = MetaData()
    Table("businesses", metadata, Column("id" if has_id else "other", String, nullable=False))
    errors = table_policy_errors(metadata, {"businesses": TABLE_POLICIES["businesses"]})
    expected = "tenant root key must be primary" if has_id else "missing tenant key 'id'"
    assert errors == (f"businesses: {expected}",)


async def test_a_namespace_confines_reads_joins_and_writes_to_its_businesses(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = Factory(db)
    owned: list[str] = []
    for namespace in ("1111", "2222"):
        settings = EnvSettings(env="dev", run_namespace=namespace)
        monkeypatch.setattr(ids, "get_settings", lambda settings=settings: settings)
        business = await f.business(name=namespace)
        await f.client(business=business, name="Pat")
        await f.client(business=business, name="Sam")
        owned.append(business.id)
    mine, theirs = owned
    users = await db.scalar(select(func.count()).select_from(User))
    confine_to_namespace("1111", db.sync_session)
    assert set(await db.scalars(select(Business.id))) == {mine}
    assert set(await db.scalars(select(Client.business_id))) == {mine}
    joined = await db.execute(
        select(Business.id, Client.name).join(Client, Client.business_id == Business.id)
    )
    assert sorted(joined.tuples()) == [(mine, "Pat"), (mine, "Sam")]
    await db.execute(update(Client).where(Client.name == "Pat").values(name="Renamed"))
    await db.execute(delete(Client).where(Client.name == "Sam"))
    assert await db.scalar(select(func.count()).select_from(User)) == users
    conn = await db.connection()
    left = await conn.execute(
        text("SELECT business_id, name FROM clients WHERE business_id IN (:a, :b) ORDER BY 1, 2"),
        {"a": mine, "b": theirs},
    )
    assert sorted(left.tuples()) == sorted([(mine, "Renamed"), (theirs, "Pat"), (theirs, "Sam")])
