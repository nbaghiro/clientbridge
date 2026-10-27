import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.clients import Client
from clientbridge.models.platform import File
from tests.conftest import BIZ, OWNER_USER, STAFF_USER, Factory, FakeFileStorage


def _photo(parent_type: str, parent_id: str, **extra: object) -> dict[str, object]:
    return {
        "parent_type": parent_type,
        "parent_id": parent_id,
        "purpose": "photo",
        "content_type": "image/jpeg",
        "size": 4096,
        **extra,
    }


async def _upload(
    api: httpx.AsyncClient, storage: FakeFileStorage, parent_type: str, parent_id: str
) -> dict[str, str]:
    created = await api.post("/v1/files", json=_photo(parent_type, parent_id))
    assert created.status_code == 201, created.text
    file = created.json()["file"]
    storage.stored[file["s3_key"]] = 4096
    done = await api.post(f"/v1/files/{file['id']}/complete")
    assert done.status_code == 200, done.text
    return file


async def _photos(db: AsyncSession, parent_id: str) -> list[str]:
    rows = await db.scalars(
        select(File.id).where(File.parent_id == parent_id, File.purpose == "photo")
    )
    return list(rows.all())


async def test_staff_set_a_client_photo_and_read_it_back(
    as_staff: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    file = await _upload(as_staff, storage, "client", "cl_amelie")
    assert file["parent_type"] == "client" and file["parent_id"] == "cl_amelie"
    link = await as_staff.get(f"/v1/files/{file['id']}/link")
    assert link.status_code == 200, link.text
    assert link.json()["url"] == f"https://files.test/{file['s3_key']}"
    assert await _photos(db, "cl_amelie") == [file["id"]]


async def test_a_new_photo_replaces_the_old_one_and_its_bytes(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    first = await _upload(as_owner, storage, "client", "cl_amelie")
    pending = await as_owner.post("/v1/files", json=_photo("client", "cl_amelie"))
    assert set(await _photos(db, "cl_amelie")) == {first["id"], pending.json()["file"]["id"]}
    second = pending.json()["file"]
    storage.stored[second["s3_key"]] = 4096
    assert (await as_owner.post(f"/v1/files/{second['id']}/complete")).status_code == 200
    assert await _photos(db, "cl_amelie") == [second["id"]]
    assert storage.deleted == [first["s3_key"]]
    assert (await as_owner.get(f"/v1/files/{first['id']}/link")).status_code == 404
    again = await as_owner.post(f"/v1/files/{second['id']}/complete")
    assert again.status_code == 200 and await _photos(db, "cl_amelie") == [second["id"]]


async def test_removing_a_photo_clears_it_and_repeats_as_a_no_op(
    as_staff: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    file = await _upload(as_staff, storage, "client", "cl_amelie")
    res = await as_staff.delete("/v1/files/photos/client/cl_amelie")
    assert res.status_code == 204, res.text
    assert await _photos(db, "cl_amelie") == []
    assert storage.deleted == [file["s3_key"]]
    assert (await as_staff.delete("/v1/files/photos/client/cl_amelie")).status_code == 204
    assert storage.deleted == [file["s3_key"]]


async def test_removal_with_one_key_replays_and_rejects_a_different_parent(
    as_owner: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    await _upload(as_owner, storage, "client", "cl_amelie")
    headers = {"Idempotency-Key": "clear-once"}
    first = await as_owner.delete("/v1/files/photos/client/cl_amelie", headers=headers)
    await _upload(as_owner, storage, "client", "cl_amelie")
    again = await as_owner.delete("/v1/files/photos/client/cl_amelie", headers=headers)
    assert first.status_code == again.status_code == 204
    assert len(await _photos(db, "cl_amelie")) == 1
    other = await as_owner.delete(f"/v1/files/photos/user/{OWNER_USER}", headers=headers)
    assert other.status_code == 422
    assert other.json()["error"] == "idempotency_key_reused"


async def test_creating_the_same_photo_twice_with_one_key_returns_one_file(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = {"Idempotency-Key": "client-photo-once"}
    first = await as_staff.post("/v1/files", json=_photo("client", "cl_amelie"), headers=headers)
    again = await as_staff.post("/v1/files", json=_photo("client", "cl_amelie"), headers=headers)
    assert first.status_code == again.status_code == 201
    assert first.json()["file"]["id"] == again.json()["file"]["id"]
    assert await _photos(db, "cl_amelie") == [first.json()["file"]["id"]]


async def test_members_set_their_own_photo_and_managers_set_anyones(
    as_staff: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    storage: FakeFileStorage,
) -> None:
    own = await _upload(as_staff, storage, "user", STAFF_USER)
    assert await _photos(db, STAFF_USER) == [own["id"]]
    assert (await as_staff.get(f"/v1/files/{own['id']}/link")).status_code == 200
    managed = await _upload(as_owner, storage, "user", STAFF_USER)
    assert await _photos(db, STAFF_USER) == [managed["id"]]
    assert (await as_owner.delete(f"/v1/files/photos/user/{STAFF_USER}")).status_code == 204
    assert await _photos(db, STAFF_USER) == []


async def test_staff_cannot_set_or_clear_another_members_photo_403(
    as_staff: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    before = await _photos(db, OWNER_USER)
    res = await as_staff.post("/v1/files", json=_photo("user", OWNER_USER))
    assert res.status_code == 403
    assert (await as_staff.delete(f"/v1/files/photos/user/{OWNER_USER}")).status_code == 403
    db.add(
        File(
            id="fl_owner_pending",
            business_id=BIZ,
            parent_type="user",
            parent_id=OWNER_USER,
            purpose="photo",
            s3_key=f"{BIZ}/fl_owner_pending",
        )
    )
    await db.flush()
    storage.stored[f"{BIZ}/fl_owner_pending"] = 1
    assert (await as_staff.post("/v1/files/fl_owner_pending/complete")).status_code == 403
    assert await _photos(db, OWNER_USER) == [*before, "fl_owner_pending"]
    assert storage.deleted == []


@pytest.mark.parametrize(
    "extra",
    [{"purpose": "attachment"}, {"purpose": None}, {"content_type": "application/pdf"}],
)
async def test_a_person_takes_only_an_image_photo_422(
    as_owner: httpx.AsyncClient, extra: dict[str, object]
) -> None:
    for parent_type, parent_id in (("client", "cl_amelie"), ("user", OWNER_USER)):
        res = await as_owner.post("/v1/files", json=_photo(parent_type, parent_id, **extra))
        assert res.status_code == 422
        assert res.json()["error"] == "invalid_request"


async def test_only_people_photos_are_cleared_this_way_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.delete("/v1/files/photos/item/it_bath")
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_request"


async def test_unknown_deleted_or_foreign_client_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    assert (
        await as_owner.post("/v1/files", json=_photo("client", "cl_missing"))
    ).status_code == 404
    gone = await db.get(Client, "cl_olivia")
    assert gone is not None
    gone.deleted_at = clock.now()
    await db.flush()
    assert (await as_owner.post("/v1/files", json=_photo("client", "cl_olivia"))).status_code == 404
    rival = await factory.client(business=await factory.business(name="Rival Co"))
    assert (await as_owner.post("/v1/files", json=_photo("client", rival.id))).status_code == 404
    assert (await as_owner.delete(f"/v1/files/photos/client/{rival.id}")).status_code == 404
    assert await _photos(db, rival.id) == []


async def test_users_outside_this_team_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    loner = await factory.user(email="loner@example.test")
    rival = await factory.business(name="Rival Co")
    elsewhere = await factory.user(email="elsewhere@example.test")
    await factory.staff(business=rival, user=elsewhere)
    for user in (loner, elsewhere):
        res = await as_owner.post("/v1/files", json=_photo("user", user.id))
        assert res.status_code == 404
        assert (await as_owner.delete(f"/v1/files/photos/user/{user.id}")).status_code == 404
        assert await _photos(db, user.id) == []


async def test_another_businesss_photo_is_not_linked_or_cleared_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    rival = await factory.business(name="Rival Co")
    client = await factory.client(business=rival)
    db.add(
        File(
            id="fl_rival_face",
            business_id=rival.id,
            parent_type="client",
            parent_id=client.id,
            purpose="photo",
            s3_key=f"{rival.id}/fl_rival_face",
            uploaded_at=clock.now(),
        )
    )
    await db.flush()
    assert (await as_owner.get("/v1/files/fl_rival_face/link")).status_code == 404
    assert (await as_owner.post("/v1/files/fl_rival_face/complete")).status_code == 404
    assert await _photos(db, client.id) == ["fl_rival_face"]


async def test_connect_shows_only_profile_members_photos_and_never_clients(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    diego = await _upload(as_owner, storage, "user", STAFF_USER)
    alex = await _upload(as_owner, storage, "user", "us_admin")
    client = await _upload(as_owner, storage, "client", "cl_amelie")
    unauth.headers.clear()
    profile = (await unauth.get("/book/birchbark/profile")).json()
    shown = {s["id"]: s["photo_url"] for s in profile["staff"]}
    assert shown["st_diego"].endswith(f"/media/{diego['id']}")
    assert "st_admin" not in shown
    page = (await unauth.get("/book/birchbark/services")).json()
    assert next(s for s in page["staff"] if s["id"] == "st_diego")["photo_url"] == shown["st_diego"]
    media = await unauth.get(f"/media/{diego['id']}", follow_redirects=False)
    assert media.status_code == 302
    assert media.headers["location"] == f"https://files.test/{diego['s3_key']}"
    for hidden in (alex, client):
        assert (await unauth.get(f"/media/{hidden['id']}")).status_code == 404


async def test_a_member_left_off_the_profile_has_no_public_photo(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, storage: FakeFileStorage
) -> None:
    diego = await _upload(as_owner, storage, "user", STAFF_USER)
    res = await as_owner.patch("/v1/business", json={"brand": {"public_staff_ids": ["st_owner"]}})
    assert res.status_code == 200, res.text
    unauth.headers.clear()
    page = (await unauth.get("/book/birchbark/services")).json()
    assert next(s for s in page["staff"] if s["id"] == "st_diego")["photo_url"] is None
    assert (await unauth.get(f"/media/{diego['id']}")).status_code == 404
