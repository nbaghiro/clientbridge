from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.platform import File
from clientbridge.services.files import run_prune_pending_files
from tests.conftest import Factory, FakeFileStorage
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


async def _pending(api: httpx.AsyncClient, body: dict[str, object]) -> dict[str, str]:
    res = await api.post("/v1/files", json=body)
    assert res.status_code == 201, res.text
    assert res.json()["file"]["uploaded_at"] is None
    file: dict[str, str] = res.json()["file"]
    return file


async def test_complete_confirms_the_stored_bytes_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    cid = await client_id(db)
    file = await _pending(as_owner, {"parent_type": "client", "parent_id": cid, "size": 42})
    storage.stored[file["s3_key"]] = 42
    first = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert first.status_code == 200, first.text
    assert first.json()["uploaded_at"] is not None
    again = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert again.json()["uploaded_at"] == first.json()["uploaded_at"]


async def test_complete_before_the_bytes_arrive_is_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    file = await _pending(as_owner, {"parent_type": "client", "parent_id": await client_id(db)})
    res = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert res.status_code == 409 and res.json()["error"] == "upload_missing"


async def test_complete_with_another_size_is_422(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    cid = await client_id(db)
    file = await _pending(as_owner, {"parent_type": "client", "parent_id": cid, "size": 42})
    storage.stored[file["s3_key"]] = 7
    assert (await as_owner.post(f"/v1/files/{file['id']}/complete")).status_code == 422


async def test_complete_cannot_reach_another_business_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    other = await Factory(db).business()
    db.add(
        File(
            id="fl_foreign_pending",
            business_id=other.id,
            parent_type="business",
            parent_id=other.id,
            s3_key=f"{other.id}/fl_foreign_pending",
        )
    )
    await db.flush()
    assert (await as_owner.post("/v1/files/fl_foreign_pending/complete")).status_code == 404


async def test_staff_cannot_complete_a_public_image_403(
    as_staff: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    db.add(
        File(
            id="fl_pending_image",
            business_id=BIZ,
            parent_type="item",
            parent_id="it_bath",
            purpose="image",
            s3_key=f"{BIZ}/fl_pending_image",
        )
    )
    await db.flush()
    storage.stored[f"{BIZ}/fl_pending_image"] = 1
    assert (await as_staff.post("/v1/files/fl_pending_image/complete")).status_code == 403


async def test_a_pending_image_is_neither_served_nor_usable_as_a_logo(
    as_owner: httpx.AsyncClient,
) -> None:
    image = await _pending(
        as_owner, {"parent_type": "item", "parent_id": "it_bath", "purpose": "image"}
    )
    assert (await as_owner.get(f"/media/{image['id']}", follow_redirects=False)).status_code == 404
    logo = await _pending(
        as_owner, {"parent_type": "business", "parent_id": BIZ, "purpose": "logo"}
    )
    res = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": logo["id"]}})
    assert res.status_code == 404


async def test_stale_pending_uploads_are_pruned_with_their_bytes(
    db: AsyncSession, storage: FakeFileStorage
) -> None:
    now = clock.now()
    for name, created, uploaded in (
        ("fl_stale", now - timedelta(hours=25), None),
        ("fl_recent", now - timedelta(hours=1), None),
        ("fl_kept", now - timedelta(days=30), now - timedelta(days=30)),
    ):
        db.add(
            File(
                id=name,
                business_id=BIZ,
                parent_type="business",
                parent_id=BIZ,
                s3_key=f"{BIZ}/{name}",
                created_at=created,
                uploaded_at=uploaded,
            )
        )
    await db.flush()
    assert await run_prune_pending_files(db, storage, now) == 1
    remaining = set(
        await db.scalars(select(File.id).where(File.id.in_(["fl_stale", "fl_recent", "fl_kept"])))
    )
    assert remaining == {"fl_recent", "fl_kept"}
    assert storage.deleted == [f"{BIZ}/fl_stale"]
