"""Public media: business logos and item images only, uploaded by an owner or admin."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import BIZ, Factory, FakeFileStorage


async def _image(
    api: httpx.AsyncClient, parent_type: str, parent_id: str, kind: str
) -> httpx.Response:
    return await api.post(
        "/v1/files",
        json={
            "parent_type": parent_type,
            "parent_id": parent_id,
            "kind": kind,
            "content_type": "image/png",
        },
    )


async def test_item_image_redirects_to_storage_and_shows_on_the_booking_page(
    as_owner: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    res = await _image(as_owner, "item", "it_bath", "image")
    assert res.status_code == 201, res.text
    file = res.json()["file"]
    media = await as_owner.get(f"/media/{file['id']}", follow_redirects=False)
    assert media.status_code == 302
    assert media.headers["location"] == f"https://files.test/{file['s3_key']}"
    page = (await as_owner.get("/book/birchbark/services")).json()
    bath = next(s for s in page["services"] if s["id"] == "it_bath")
    assert bath["image_url"].endswith(f"/media/{file['id']}")


async def test_uploaded_logo_becomes_the_public_logo(as_owner: httpx.AsyncClient) -> None:
    file_id = (await _image(as_owner, "business", BIZ, "logo")).json()["file"]["id"]
    res = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": file_id}})
    assert res.status_code == 200, res.text
    page = (await as_owner.get("/book/birchbark/services")).json()
    assert page["brand"]["logo_url"].endswith(f"/media/{file_id}")


async def test_logo_must_be_an_uploaded_logo_404(as_owner: httpx.AsyncClient) -> None:
    item_image = (await _image(as_owner, "item", "it_bath", "image")).json()["file"]["id"]
    res = await as_owner.patch("/v1/business", json={"brand": {"logo_file_id": item_image}})
    assert res.status_code == 404


async def test_staff_cannot_set_public_images_403(as_staff: httpx.AsyncClient) -> None:
    assert (await _image(as_staff, "item", "it_bath", "image")).status_code == 403


async def test_public_image_for_another_business_item_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    other = await Factory(db).business()
    res = await _image(as_owner, "business", other.id, "logo")
    assert res.status_code == 404
    assert (await _image(as_owner, "item", "it_missing", "image")).status_code == 404


async def test_client_files_are_never_served_publicly(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient
) -> None:
    file_id = (await _image(as_owner, "subject", "sj_bella", "photo")).json()["file"]["id"]
    assert (await unauth.get(f"/media/{file_id}", follow_redirects=False)).status_code == 404
    assert (await unauth.get("/media/fl_nope", follow_redirects=False)).status_code == 404
