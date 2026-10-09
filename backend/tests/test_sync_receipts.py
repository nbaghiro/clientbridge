from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Staff
from clientbridge.models.platform import SyncReceipt
from clientbridge.services.receipts import run_prune_receipts
from tests.conftest import access_token
from tests.test_hours import week_body

URL = "/v1/hours/st_diego/week"


async def test_invalid_week_has_no_receipt(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = week_body()
    body["days"] = []
    assert (await as_owner.post(URL, json=body)).status_code == 422
    assert (await db.scalars(select(SyncReceipt))).first() is None


async def test_revision_conflict_rolls_back_receipt(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    assert (await as_owner.post(URL, json=week_body(999))).status_code == 409
    assert (await db.scalars(select(SyncReceipt))).first() is None


async def test_receipt_rechecks_membership(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = week_body()
    assert (await as_owner.post(URL, json=body)).status_code == 200
    await db.execute(update(Staff).where(Staff.id == "st_owner").values(status="removed"))
    response = await as_owner.post(URL, json=body)
    assert response.status_code == 403


async def test_receipt_is_actor_bound(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = week_body()
    assert (await as_owner.post(URL, json=body)).status_code == 200
    token = await access_token(db, "us_diego")
    response = await as_owner.post(URL, json=body, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 409
    assert len((await db.scalars(select(SyncReceipt))).all()) == 1


async def test_retention_and_retry_horizon(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = week_body()
    assert (await as_owner.post(URL, json=body)).status_code == 200
    now = datetime.now(UTC)
    await db.execute(update(SyncReceipt).values(created_at=now - timedelta(days=91)))
    assert await run_prune_receipts(db, now) == 1
    request = body["request"]
    assert isinstance(request, dict)
    request["created_at"] = (now - timedelta(days=91)).isoformat()
    response = await as_owner.post(URL, json=body)
    assert response.status_code == 409
    assert response.json()["error"] == "upload_expired"
    assert (await db.scalars(select(SyncReceipt))).first() is None


async def test_future_operation_is_rejected(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    body = week_body()
    request = body["request"]
    assert isinstance(request, dict)
    request["created_at"] = (datetime.now(UTC) + timedelta(minutes=6)).isoformat()
    response = await as_owner.post(URL, json=body)
    assert response.status_code == 422
    assert (await db.scalars(select(SyncReceipt))).first() is None
