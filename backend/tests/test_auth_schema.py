"""Kratos owns credentials: no local auth tables, users link 1:1 to identities, nothing synced."""

import re
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_auth_tables_are_gone_and_users_link_to_identities(db: AsyncSession) -> None:
    for table in ("sessions", "tokens"):
        n = (
            await db.execute(
                text("SELECT count(*) FROM information_schema.tables WHERE table_name = :t"),
                {"t": table},
            )
        ).scalar()
        assert n == 0, table
    columns = set(
        (
            await db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
                )
            )
        ).scalars()
    )
    assert "identity_id" in columns and "last_seen_at" in columns
    assert columns.isdisjoint({"password_hash", "oauth", "email_verified_at"})
    unique = (
        await db.execute(
            text(
                "SELECT count(*) FROM pg_indexes WHERE tablename = 'users' "
                "AND indexdef LIKE 'CREATE UNIQUE INDEX%(identity_id)'"
            )
        )
    ).scalar()
    assert unique == 1


def test_server_only_tables_are_not_synced() -> None:
    rules = (
        Path(__file__).resolve().parents[2] / "infra" / "powersync" / "sync-rules.yaml"
    ).read_text()
    synced = set(re.findall(r"FROM\s+(\w+)", rules))
    assert synced.isdisjoint({"users", "commands", "webhooks", "audits", "sync_receipts"})
