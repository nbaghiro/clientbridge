import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.platform import File
from tests.conftest import FakeFileStorage
from tests.helpers import client_id

BIZ = "bz_birchbark"


async def test_create_returns_presigned_upload_url(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    cid = await client_id(db)
    res = await as_owner.post(
        "/v1/files",
        json={"parent_type": "client", "parent_id": cid, "content_type": "image/png", "size": 42},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["file"]["s3_key"].startswith(f"{BIZ}/")
    assert body["upload_url"] == f"https://files.test/{body['file']['s3_key']}"
    assert (body["file"]["s3_key"], "image/png") in storage.uploads
    row = (await db.execute(select(File).where(File.id == body["file"]["id"]))).scalar_one()
    assert row.business_id == BIZ and row.size == 42


async def test_create_defaults_content_type(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    cid = await client_id(db)
    res = await as_owner.post("/v1/files", json={"parent_type": "client", "parent_id": cid})
    assert res.status_code == 201, res.text
    key = res.json()["file"]["s3_key"]
    assert (key, "application/octet-stream") in storage.uploads


async def test_any_member_can_create(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_staff.post("/v1/files", json={"parent_type": "client", "parent_id": cid})
    assert res.status_code == 201, res.text


async def test_create_requires_auth(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/files", json={"parent_type": "client", "parent_id": "cl_x"})
    assert res.status_code == 401
