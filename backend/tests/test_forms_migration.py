import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core.config import get_settings


async def _verify(db: AsyncSession) -> None:
    await db.execute(
        text(
            "CREATE TEMP TABLE forms (id text, business_id text, name text, "
            "require_signature boolean)"
        )
    )
    await db.execute(
        text(
            "CREATE TEMP TABLE fields (id text, business_id text, form_id text, input text, "
            "name text, label text, help text, required boolean, options jsonb, "
            "validation jsonb, position integer)"
        )
    )
    await db.execute(
        text("CREATE TEMP TABLE responses (id text, business_id text, form_id text, answers jsonb)")
    )
    await db.execute(text("INSERT INTO forms VALUES ('form', 'business', 'Intake', true)"))
    await db.execute(
        text(
            "INSERT INTO fields VALUES ('field', 'business', 'form', 'text', 'allergies', "
            "'Allergies', NULL, true, '[]', '{}', 0)"
        )
    )
    await db.execute(
        text(
            "INSERT INTO responses VALUES ('response', 'business', 'form', "
            '\'{"allergies": "Peanuts"}\')'
        )
    )
    migration = Path(__file__).parents[1] / "migrations/versions/20261018_000000_form_evidence.py"
    spec = importlib.util.spec_from_file_location("form_evidence", migration)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def upgrade(connection: Connection) -> None:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()

    connection = await db.connection()
    await connection.run_sync(upgrade)
    row = (await db.execute(text("SELECT answers, definition, signature FROM responses"))).one()
    assert row.answers == {"allergies": "Peanuts"}
    assert row.definition["provenance"] == "reconstructed"
    assert row.definition["fields"][0]["label"] == "Allergies"
    assert row.definition["require_signature"] is True
    assert row.signature is None


async def test_upgrade_preserves_answers_and_labels_reconstructed_evidence() -> None:
    engine = create_async_engine(get_settings().migration_database_url)
    try:
        async with AsyncSession(engine) as session:
            await _verify(session)
    finally:
        await engine.dispose()
