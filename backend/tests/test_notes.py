"""Notes on a client or a pet: write, pin, edit, delete, and who may change them."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.security import issue_access_token
from tests.conftest import STAFF_USER, Factory


async def _note(api: httpx.AsyncClient, body: str = "x") -> str:
    res = await api.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": "cl_grace", "body": body}
    )
    return str(res.json()["id"])


async def test_note_lifecycle(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/notes",
        json={
            "parent_type": "client",
            "parent_id": "cl_grace",
            "body": " Likes mornings ",
            "pinned": True,
        },
    )
    assert res.status_code == 201, res.text
    note = res.json()
    assert note["body"] == "Likes mornings"
    assert note["pinned"] is True
    assert note["created_by"] == "us_dev"

    res = await as_owner.patch(
        f"/v1/notes/{note['id']}", json={"pinned": False, "body": "Mornings"}
    )
    assert res.json()["pinned"] is False
    assert res.json()["body"] == "Mornings"
    assert (await as_owner.delete(f"/v1/notes/{note['id']}")).status_code == 204
    assert (await as_owner.delete(f"/v1/notes/{note['id']}")).status_code == 404


async def test_note_on_a_pet(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/notes", json={"parent_type": "subject", "parent_id": "sj_rex", "body": "Muzzle"}
    )
    assert res.status_code == 201, res.text


async def test_unknown_parent_404(as_owner: httpx.AsyncClient) -> None:
    for parent_type, parent_id in (("client", "cl_nope"), ("subject", "sj_nope")):
        res = await as_owner.post(
            "/v1/notes", json={"parent_type": parent_type, "parent_id": parent_id, "body": "x"}
        )
        assert res.status_code == 404


async def test_blank_body_and_booking_parent_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": "cl_grace", "body": ""}
    )
    assert res.status_code == 422
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "booking", "parent_id": "bk_001", "body": "x"}
    )
    assert res.status_code == 422


async def test_staff_change_only_their_own_notes_403(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    theirs = await _note(as_owner)
    mine = await _note(as_owner)
    await db.execute(text("UPDATE notes SET created_by = 'us_diego' WHERE id = :i"), {"i": mine})
    as_owner.headers["Authorization"] = f"Bearer {issue_access_token(STAFF_USER)}"
    assert (await as_owner.patch(f"/v1/notes/{mine}", json={"pinned": True})).status_code == 200
    assert (await as_owner.patch(f"/v1/notes/{theirs}", json={"pinned": True})).status_code == 403
    assert (await as_owner.delete(f"/v1/notes/{theirs}")).status_code == 403


async def test_foreign_note_404_by_scoping(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": foreign.id, "body": "x"}
    )
    assert res.status_code == 404
    await db.execute(
        text(
            "INSERT INTO notes (id, business_id, parent_type, parent_id, body)"
            " VALUES ('nt_foreign', :b, 'client', :c, 'theirs')"
        ),
        {"b": other.id, "c": foreign.id},
    )
    assert (await as_owner.patch("/v1/notes/nt_foreign", json={"body": "y"})).status_code == 404
    assert (await as_owner.delete("/v1/notes/nt_foreign")).status_code == 404
