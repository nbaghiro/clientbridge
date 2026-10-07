"""Pets and other subjects on a client: add, edit, remove."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import Factory


async def _client(api: httpx.AsyncClient) -> str:
    return str((await api.post("/v1/clients", json={"name": "Pet Owner"})).json()["id"])


async def test_add_edit_and_remove_a_pet(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(as_staff)
    res = await as_staff.post(
        "/v1/subjects",
        json={
            "client_id": cid,
            "name": " Luna ",
            "attributes": {"species": "dog", "birthday": "2021-03-04", "vaccinated": True},
        },
    )
    assert res.status_code == 201, res.text
    pet = res.json()
    assert pet["name"] == "Luna"
    assert pet["attributes"] == {"species": "dog", "birthday": "2021-03-04", "vaccinated": True}

    res = await as_staff.patch(
        f"/v1/subjects/{pet['id']}", json={"attributes": {"temperament": "anxious"}}
    )
    assert res.status_code == 200, res.text
    assert res.json()["attributes"] == {"temperament": "anxious"}
    assert res.json()["name"] == "Luna"

    assert (await as_staff.delete(f"/v1/subjects/{pet['id']}")).status_code == 204
    gone = await db.scalar(text("SELECT deleted_at FROM subjects WHERE id = :i"), {"i": pet["id"]})
    assert gone is not None
    res = await as_staff.patch(f"/v1/subjects/{pet['id']}", json={"name": "X"})
    assert res.status_code == 404


async def test_invalid_attributes_422(as_owner: httpx.AsyncClient) -> None:
    cid = await _client(as_owner)
    for attrs in ({"birthday": "not-a-date"}, {"sex": "other"}, {"weight_kg": 500}):
        res = await as_owner.post(
            "/v1/subjects", json={"client_id": cid, "name": "X", "attributes": attrs}
        )
        assert res.status_code == 422, attrs


async def test_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/subjects", json={"client_id": "cl_nope", "name": "X"})
    assert res.status_code == 404


async def test_requires_auth_401(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/subjects", json={"client_id": "cl_grace", "name": "X"})
    assert res.status_code == 401


async def test_foreign_subject_404_by_scoping(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    res = await as_owner.post("/v1/subjects", json={"client_id": foreign.id, "name": "X"})
    assert res.status_code == 404
    await db.execute(
        text(
            "INSERT INTO subjects (id, business_id, client_id, kind, name, attributes)"
            " VALUES ('sj_foreign', :b, :c, 'pet', 'Theirs', '{}')"
        ),
        {"b": other.id, "c": foreign.id},
    )
    res = await as_owner.patch("/v1/subjects/sj_foreign", json={"name": "Y"})
    assert res.status_code == 404
    assert (await as_owner.delete("/v1/subjects/sj_foreign")).status_code == 404
