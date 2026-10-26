import asyncio
import json
import sys
from datetime import time

import httpx
from sqlalchemy import delete, update

from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.identity import Credential, Identity
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.main import create_app
from clientbridge.models.business import Staff
from clientbridge.models.scheduling import Hours
from scripts.demo_context import run_email, run_id
from scripts.sync_fixtures import require_run, sync_identity


class OwnerSession:
    """The sync fixtures have no logins; every request is the run's seeded owner."""

    async def whoami(self, credential: Credential, *, fresh: bool = False) -> Identity:
        email = run_email("owner@sync.test")
        return Identity(
            id=sync_identity("owner"),
            email=email,
            verified_emails=frozenset({email}),
            name="owner",
            session_id="sync-hours",
            second_factor=False,
        )

    async def identity_exists(self, identity_id: str) -> bool:
        return True


async def run(payload: str) -> None:
    require_run()
    owner, hours = run_id("st_owner"), run_id("av_owner")
    try:
        async with SessionLocal() as db:
            if payload == "reset":
                await db.execute(delete(Hours).where(Hours.staff_id == owner, Hours.id != hours))
                await db.execute(
                    update(Hours)
                    .where(Hours.id == hours)
                    .values(start_time=time(9), end_time=time(17), available=True)
                )
                await db.execute(update(Staff).where(Staff.id == owner).values(hours_revision=0))
                await db.commit()
                return
        app = create_app()
        app.dependency_overrides[get_identity_provider] = OwnerSession
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://verification"
        ) as client:
            response = await client.post(
                f"/v1/hours/{owner}/week",
                content=payload,
                headers={
                    "X-Session-Token": "sync-hours",
                    "Content-Type": "application/json",
                    "X-Business-Id": run_id("bz_first"),
                },
            )
            print(json.dumps({"status": response.status_code, "body": response.text}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1]))
