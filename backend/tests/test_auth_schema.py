"""The server-only auth tables exist and are excluded from the client AppSchema."""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_auth_tables_and_column_exist(db: AsyncSession) -> None:
    for table in ("auth_sessions", "auth_tokens"):
        n = (
            await db.execute(
                text("SELECT count(*) FROM information_schema.tables WHERE table_name = :t"),
                {"t": table},
            )
        ).scalar()
        assert n == 1, table
    col = (
        await db.execute(
            text(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'users' AND column_name = 'email_verified_at'"
            )
        )
    ).scalar()
    assert col == 1


def test_auth_tables_are_server_only() -> None:
    # server-only: must NOT appear in the sync rules → excluded from the client AppSchema
    rules = (
        Path(__file__).resolve().parents[2] / "infra" / "powersync" / "sync-rules.yaml"
    ).read_text()
    assert "auth_sessions" not in rules
    assert "auth_tokens" not in rules
