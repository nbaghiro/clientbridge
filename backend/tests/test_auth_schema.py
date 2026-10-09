"""The server-only tables exist and are excluded from the client AppSchema."""

import re
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_auth_tables_and_column_exist(db: AsyncSession) -> None:
    for table in ("sessions", "tokens"):
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


def test_server_only_tables_are_not_synced() -> None:
    rules = (
        Path(__file__).resolve().parents[2] / "infra" / "powersync" / "sync-rules.yaml"
    ).read_text()
    synced = set(re.findall(r"FROM\s+(\w+)", rules))
    assert synced.isdisjoint(
        {"sessions", "tokens", "commands", "webhooks", "audits", "sync_receipts"}
    )
