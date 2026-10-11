import asyncio
import json
import sys
from datetime import time

import httpx
from sqlalchemy import delete, update

from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.kratos import Credential, Identity, get_identity_provider
from clientbridge.main import create_app
from clientbridge.models.business import Staff
from clientbridge.models.scheduling import Hours
from scripts.sync_fixtures import sync_identity

OWNER = Identity(
    id=sync_identity("owner"),
    email="owner@sync.test",
    verified_emails=frozenset({"owner@sync.test"}),
    name="owner",
    session_id="sync-hours",
    aal="aal1",
)


class OwnerSession:
    """The disposable sync stack runs no Kratos; every request is the seeded owner."""

    async def whoami(self, credential: Credential) -> Identity:
        return OWNER

    async def revoke_sessions(self, identity_id: str) -> None:
        return None


async def run(payload: str) -> None:
    if engine.url.database != "clientbridge_test_sync":
        raise RuntimeError("sync hours verification requires the disposable database")
    try:
        async with SessionLocal() as db:
            if payload == "reset":
                await db.execute(
                    delete(Hours).where(Hours.staff_id == "st_owner", Hours.id != "av_owner")
                )
                await db.execute(
                    update(Hours)
                    .where(Hours.id == "av_owner")
                    .values(start_time=time(9), end_time=time(17), available=True)
                )
                await db.execute(
                    update(Staff).where(Staff.id == "st_owner").values(hours_revision=0)
                )
                await db.commit()
                return
        app = create_app()
        app.dependency_overrides[get_identity_provider] = OwnerSession
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://verification"
        ) as client:
            response = await client.post(
                "/v1/hours/st_owner/week",
                content=payload,
                headers={
                    "X-Session-Token": "sync-hours",
                    "Content-Type": "application/json",
                    "X-Business-Id": "bz_first",
                },
            )
            print(json.dumps({"status": response.status_code, "body": response.text}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1]))
