"""Bounded mutations for the disposable actual-service authorization suite."""

import asyncio
import sys
from datetime import UTC, datetime

from sqlalchemy import update

from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.business import Staff
from clientbridge.models.clients import Client


async def mutate(action: str) -> None:
    if engine.url.database != "clientbridge_test_sync":
        raise RuntimeError("sync mutations require the isolated verification database")
    async with SessionLocal() as db:
        if action in {"downgrade", "remove", "restore"}:
            await db.execute(
                update(Staff)
                .where(Staff.id == "st_admin")
                .values(
                    role="staff" if action == "downgrade" else "admin",
                    status="removed" if action == "remove" else "active",
                )
            )
        elif action in {"delete_client", "restore_client"}:
            await db.execute(
                update(Client)
                .where(Client.id == "cl_first")
                .values(
                    deleted_at=datetime.now(UTC) if action == "delete_client" else None,
                )
            )
        else:
            raise ValueError("unknown verification mutation")
        await db.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(mutate(sys.argv[1]))
