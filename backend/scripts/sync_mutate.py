"""Bounded mutations of a sync run's own fixtures, for the actual-service authorization suite."""

import asyncio
import sys

from sqlalchemy import update

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal, engine
from clientbridge.models.business import Staff, User
from clientbridge.models.clients import Client
from scripts.demo_context import run_id
from scripts.sync_fixtures import require_run


async def mutate(action: str) -> None:
    require_run()
    async with SessionLocal() as db:
        if action in {"downgrade", "remove", "restore"}:
            await db.execute(
                update(Staff)
                .where(Staff.id == run_id("st_admin"))
                .values(
                    role="staff" if action == "downgrade" else "admin",
                    status="removed" if action == "remove" else "active",
                )
            )
        elif action in {"rename", "restore_name"}:
            await db.execute(
                update(User)
                .where(User.id == run_id("us_owner"))
                .values(name="renamed" if action == "rename" else "owner")
            )
        elif action in {"delete_client", "restore_client"}:
            await db.execute(
                update(Client)
                .where(Client.id == run_id("cl_first"))
                .values(
                    deleted_at=clock.now() if action == "delete_client" else None,
                )
            )
        else:
            raise ValueError("unknown verification mutation")
        await db.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(mutate(sys.argv[1]))
