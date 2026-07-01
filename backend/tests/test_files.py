import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.crm import Client
from clientbridge.models.platform import File
from tests.conftest import Factory, FakeFileStorage

BIZ = "bz_birchbark"


async def _a_client(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _a_file(db: AsyncSession, *, business_id: str = BIZ) -> File:
    file = File(
        id=new_id("file"),
        business_id=business_id,
        parent_type="client",
        parent_id="cl_x",
        kind="attachment",
        s3_key=f"{business_id}/{new_id('file')}",
        content_type="image/png",
        size=1234,
    )
    db.add(file)
    await db.flush()
    return file


async def test_create_returns_presigned_upload_url(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    cid = await _a_client(db)
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
    cid = await _a_client(db)
    res = await as_owner.post("/v1/files", json={"parent_type": "client", "parent_id": cid})
    assert res.status_code == 201, res.text
    key = res.json()["file"]["s3_key"]
    assert (key, "application/octet-stream") in storage.uploads


async def test_any_member_can_create(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _a_client(db)
    res = await as_staff.post("/v1/files", json={"parent_type": "client", "parent_id": cid})
    assert res.status_code == 201, res.text


async def test_download_url(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    file = await _a_file(db)
    res = await as_owner.get(f"/v1/files/{file.id}/url")
    assert res.status_code == 200, res.text
    assert res.json()["url"] == f"https://files.test/{file.s3_key}"
    assert file.s3_key in storage.downloads


async def test_download_unknown_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.get("/v1/files/fl_nope/url")).status_code == 404


async def test_download_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Files")
    file = await _a_file(db, business_id=other.id)
    assert (await as_owner.get(f"/v1/files/{file.id}/url")).status_code == 404


async def test_create_requires_auth(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/files", json={"parent_type": "client", "parent_id": "cl_x"})
    assert res.status_code == 401
