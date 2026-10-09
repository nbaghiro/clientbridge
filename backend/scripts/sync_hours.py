import asyncio
import json
import sys
from datetime import time

import httpx
from sqlalchemy import delete, update

from clientbridge.core.db import SessionLocal, engine
from clientbridge.main import create_app
from clientbridge.models.business import Staff
from clientbridge.models.scheduling import Hours
from clientbridge.services.auth import AuthService


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
            token = (await AuthService(db).issue_session("us_owner")).access_token
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app()), base_url="http://verification"
        ) as client:
            response = await client.post(
                "/v1/hours/st_owner/week",
                content=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "X-Business-Id": "bz_first",
                },
            )
            print(json.dumps({"status": response.status_code, "body": response.text}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1]))
