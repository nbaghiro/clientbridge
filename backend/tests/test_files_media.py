"""Public media: business logos and item images only, uploaded by an owner or admin."""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.platform import File
from clientbridge.services.files import MAX_FILE_BYTES, media_url
from tests.conftest import BIZ, Factory, FakeFileStorage


async def _image(
    api: httpx.AsyncClient,
    storage: FakeFileStorage,
    parent_type: str,
    parent_id: str,
    purpose: str,
) -> httpx.Response:
    """Create an image, put its bytes in storage and confirm it, as the apps do."""
    created = await api.post(
        "/v1/files",
        json={
            "parent_type": parent_type,
            "parent_id": parent_id,
            "purpose": purpose,
            "content_type": "image/png",
        },
    )
    if created.status_code == 201:
        storage.stored[created.json()["file"]["s3_key"]] = 1
        done = await api.post(f"/v1/files/{created.json()['file']['id']}/complete")
        assert done.status_code == 200, done.text
    return created


async def test_item_image_redirects_to_storage_and_shows_on_the_booking_page(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    res = await _image(as_owner, storage, "item", "it_bath", "image")
    assert res.status_code == 201, res.text
    file = res.json()["file"]
    media = await as_owner.get(f"/media/{file['id']}", follow_redirects=False)
    assert media.status_code == 302
    assert media.headers["location"] == f"https://files.test/{file['s3_key']}"
    page = (await as_owner.get("/book/birchbark/services")).json()
    bath = next(s for s in page["services"] if s["id"] == "it_bath")
    assert bath["image_url"].endswith(f"/media/{file['id']}")


async def test_uploaded_logo_becomes_the_public_logo(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    file_id = (await _image(as_owner, storage, "business", BIZ, "logo")).json()["file"]["id"]
    res = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": file_id}})
    assert res.status_code == 200, res.text
    page = (await as_owner.get("/book/birchbark/services")).json()
    assert page["brand"]["logo_url"].endswith(f"/media/{file_id}")


async def test_logo_must_be_an_uploaded_logo_404(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    item_image = (await _image(as_owner, storage, "item", "it_bath", "image")).json()["file"]["id"]
    res = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": item_image}})
    assert res.status_code == 404
    private_file = (await _image(as_owner, storage, "subject", "sj_bella", "photo")).json()["file"][
        "id"
    ]
    rejected = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": private_file}})
    assert rejected.status_code == 404


async def test_staff_cannot_set_public_images_403(
    as_staff: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    assert (await _image(as_staff, storage, "item", "it_bath", "image")).status_code == 403


async def test_public_image_for_another_business_item_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    other = await Factory(db).business()
    res = await _image(as_owner, storage, "business", other.id, "logo")
    assert res.status_code == 404
    assert (await _image(as_owner, storage, "item", "it_missing", "image")).status_code == 404


async def test_client_files_are_never_served_publicly(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    file_id = (await _image(as_owner, storage, "subject", "sj_bella", "photo")).json()["file"]["id"]
    assert (await unauth.get(f"/media/{file_id}", follow_redirects=False)).status_code == 404
    assert (await unauth.get("/media/fl_nope", follow_redirects=False)).status_code == 404


async def test_cover_upload_is_public_and_used_by_customer_pages(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    uploaded = await _image(as_owner, storage, "business", BIZ, "image")
    assert uploaded.status_code == 201
    file_id = uploaded.json()["file"]["id"]
    for _ in range(2):
        changed = await as_owner.patch("/v1/business", json={"brand": {"cover_file_id": file_id}})
        assert changed.status_code == 200, changed.text
    assert (await unauth.get(f"/media/{file_id}", follow_redirects=False)).status_code == 302
    for path in ("/book/birchbark/services", "/book/birchbark/profile"):
        assert (await unauth.get(path)).json()["brand"]["cover_url"] == media_url(file_id)
    profile = (await unauth.get("/book/birchbark/profile")).json()
    assert profile["cover_url"] == media_url(file_id)
    removed = await as_owner.patch("/v1/business", json={"brand": {"cover_file_id": None}})
    assert removed.status_code == 200
    assert "cover_file_id" not in removed.json()["brand"]
    assert (await unauth.get("/book/birchbark/services")).json()["brand"]["cover_url"] is None


async def test_cover_must_be_an_uploaded_cover_of_this_business_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    logo = (await _image(as_owner, storage, "business", BIZ, "logo")).json()["file"]["id"]
    item_image = (await _image(as_owner, storage, "item", "it_bath", "image")).json()["file"]["id"]
    private_file = (await _image(as_owner, storage, "subject", "sj_bella", "photo")).json()["file"][
        "id"
    ]
    pending = await as_owner.post(
        "/v1/files",
        json={
            "parent_type": "business",
            "parent_id": BIZ,
            "purpose": "image",
            "content_type": "image/png",
        },
    )
    other = await Factory(db).business()
    db.add(
        File(
            id="fl_elsewhere",
            business_id=other.id,
            parent_type="business",
            parent_id=other.id,
            purpose="image",
            s3_key=f"{other.id}/fl_elsewhere",
            content_type="image/png",
            uploaded_at=clock.now(),
        )
    )
    await db.flush()
    for file_id in (logo, item_image, private_file, pending.json()["file"]["id"], "fl_elsewhere"):
        res = await as_owner.patch("/v1/business", json={"brand": {"cover_file_id": file_id}})
        assert res.status_code == 404, file_id


async def test_cover_upload_requires_public_image_permissions(
    as_staff: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    assert (await _image(as_staff, storage, "business", BIZ, "image")).status_code == 403


async def test_cover_upload_cannot_target_another_business(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    other = await Factory(db).business()
    assert (await _image(as_owner, storage, "business", other.id, "image")).status_code == 404


def _logo(content_type: str | None, size: int | None = None) -> dict[str, object]:
    return {
        "parent_type": "business",
        "parent_id": BIZ,
        "purpose": "logo",
        "content_type": content_type,
        "size": size,
    }


@pytest.mark.parametrize("content_type", ["image/png", "image/jpeg", "image/webp"])
async def test_a_raster_picture_is_accepted(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage, content_type: str
) -> None:
    created = await as_owner.post("/v1/files", json=_logo(content_type, 1024))
    assert created.status_code == 201, created.text
    file = created.json()["file"]
    storage.stored[file["s3_key"]] = 1024
    done = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert done.status_code == 200, done.text


@pytest.mark.parametrize(
    "content_type",
    ["image/svg+xml", "text/html", "application/pdf", "application/octet-stream", "", None],
)
async def test_anything_else_is_refused_before_a_link_is_minted(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage, content_type: str | None
) -> None:
    res = await as_owner.post("/v1/files", json=_logo(content_type, 1024))
    assert res.status_code == 422
    assert res.json()["error"] == "file_type_unsupported"
    assert storage.uploads == []


@pytest.mark.parametrize(
    ("declared", "start", "actual"),
    [
        ("image/webp", b"\xff\xd8\xff\xe0", "image/jpeg"),
        ("image/png", b"RIFF\x00\x00\x00\x00WEBP", "image/webp"),
        ("image/jpeg", b"\x89PNG\r\n\x1a\n", "image/png"),
    ],
)
async def test_a_real_picture_takes_the_type_of_its_bytes(
    as_owner: httpx.AsyncClient,
    unauth: httpx.AsyncClient,
    storage: FakeFileStorage,
    declared: str,
    start: bytes,
    actual: str,
) -> None:
    file = (await as_owner.post("/v1/files", json=_logo(declared))).json()["file"]
    storage.stored[file["s3_key"]] = 1024
    storage.starts[file["s3_key"]] = start
    done = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert done.status_code == 200, done.text
    assert done.json()["content_type"] == actual
    assert (await unauth.get(f"/media/{file['id']}", follow_redirects=False)).status_code == 302


@pytest.mark.parametrize(
    ("content_type", "start"),
    [
        ("image/png", b"<!doctype html>"),
        ("image/jpeg", b"<svg xmlns="),
        ("image/webp", b"RIFF\x00\x00\x00\x00WAVE"),
        ("image/png", b""),
    ],
)
async def test_bytes_that_are_not_a_picture_stay_pending(
    as_owner: httpx.AsyncClient,
    unauth: httpx.AsyncClient,
    storage: FakeFileStorage,
    content_type: str,
    start: bytes,
) -> None:
    file = (await as_owner.post("/v1/files", json=_logo(content_type))).json()["file"]
    storage.stored[file["s3_key"]] = 1024
    storage.starts[file["s3_key"]] = start
    res = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert res.status_code == 422
    assert res.json()["error"] == "file_type_unsupported"
    assert (await unauth.get(f"/media/{file['id']}", follow_redirects=False)).status_code == 404


async def test_an_empty_picture_is_refused(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    file = (await as_owner.post("/v1/files", json=_logo("image/png", 0))).json()["file"]
    storage.stored[file["s3_key"]] = 0
    res = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert res.status_code == 422
    assert res.json()["error"] == "file_type_unsupported"


async def test_a_file_declared_over_the_limit_is_refused(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    res = await as_owner.post("/v1/files", json=_logo("image/png", MAX_FILE_BYTES + 1))
    assert res.status_code == 422
    assert res.json()["error"] == "file_too_large"
    assert storage.uploads == []
    at_limit = await as_owner.post("/v1/files", json=_logo("image/png", MAX_FILE_BYTES))
    assert at_limit.status_code == 201, at_limit.text


async def test_bytes_over_the_limit_are_refused_even_without_a_declared_size(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    file = (await as_owner.post("/v1/files", json=_logo("image/png"))).json()["file"]
    storage.stored[file["s3_key"]] = MAX_FILE_BYTES + 1
    res = await as_owner.post(f"/v1/files/{file['id']}/complete")
    assert res.status_code == 422
    assert res.json()["error"] == "file_too_large"


async def test_a_public_file_stored_with_another_type_is_not_served(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    file = File(
        id="fl_old_page",
        business_id=BIZ,
        parent_type="business",
        parent_id=BIZ,
        purpose="logo",
        s3_key=f"{BIZ}/fl_old_page",
        content_type="text/html",
        uploaded_at=clock.now(),
    )
    db.add(file)
    await db.flush()
    assert (await unauth.get("/media/fl_old_page", follow_redirects=False)).status_code == 404
