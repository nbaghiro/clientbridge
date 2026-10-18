"""Subjects on a client (pets, students, properties): add, edit, remove."""

import httpx
import pytest
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


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "/v1/subjects"), ("PATCH", "/v1/subjects/sj_rex"), ("DELETE", "/v1/subjects/sj_rex")],
)
async def test_requires_auth_401(unauth: httpx.AsyncClient, method: str, path: str) -> None:
    body = {"client_id": "cl_grace", "name": "X"}
    res = await unauth.request(method, path, json=None if method == "DELETE" else body)
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
            "INSERT INTO subjects (id, business_id, client_id, name, attributes)"
            " VALUES ('sj_foreign', :b, :c, 'Theirs', '{}')"
        ),
        {"b": other.id, "c": foreign.id},
    )
    res = await as_owner.patch("/v1/subjects/sj_foreign", json={"name": "Y"})
    assert res.status_code == 404
    assert (await as_owner.delete("/v1/subjects/sj_foreign")).status_code == 404


async def _kind(owner: httpx.AsyncClient, kind: str | None) -> None:
    res = await owner.patch("/v1/business", json={"subject": kind})
    assert res.status_code == 200, res.text


@pytest.mark.parametrize(
    ("kind", "attributes"),
    [
        ("student", {"birthday": "2015-09-01", "grade": "Grade 4", "school": "Oak Bay"}),
        ("property", {"address": "12 Pine St", "rooms": 3, "access": "Lockbox 4411"}),
    ],
)
async def test_each_kind_stores_its_own_details(
    as_owner: httpx.AsyncClient, kind: str, attributes: dict[str, object]
) -> None:
    await _kind(as_owner, kind)
    cid = await _client(as_owner)
    res = await as_owner.post(
        "/v1/subjects", json={"client_id": cid, "name": "Main", "attributes": attributes}
    )
    assert res.status_code == 201, res.text
    assert res.json()["attributes"] == attributes


@pytest.mark.parametrize(
    ("kind", "attributes"),
    [("student", {"birthday": "soon"}), ("property", {"rooms": -1}), ("property", {"rooms": "x"})],
)
async def test_invalid_details_for_the_kind_422(
    as_owner: httpx.AsyncClient, kind: str, attributes: dict[str, object]
) -> None:
    await _kind(as_owner, kind)
    cid = await _client(as_owner)
    res = await as_owner.post(
        "/v1/subjects", json={"client_id": cid, "name": "X", "attributes": attributes}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_request"


async def test_a_business_without_subjects_cannot_add_one_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _kind(as_owner, None)
    cid = await _client(as_owner)
    res = await as_owner.post("/v1/subjects", json={"client_id": cid, "name": "Rex"})
    assert res.status_code == 409
    assert res.json()["error"] == "no_subjects"
    res = await as_owner.post("/v1/clients", json={"name": "Nova", "subject": {"name": "Rex"}})
    assert res.status_code == 409
    assert res.json()["error"] == "no_subjects"
    nova = await db.scalar(text("SELECT count(*) FROM clients WHERE name = 'Nova'"))
    assert nova == 0


async def test_changing_the_kind_keeps_existing_subjects_and_details(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(as_owner)
    pet = (
        await as_owner.post(
            "/v1/subjects",
            json={"client_id": cid, "name": "Luna", "attributes": {"breed": "Collie"}},
        )
    ).json()
    await _kind(as_owner, "property")
    res = await as_owner.patch(
        f"/v1/subjects/{pet['id']}",
        json={"attributes": {"breed": "Collie", "address": "4 Elm Rd", "rooms": None}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["attributes"] == {"breed": "Collie", "address": "4 Elm Rd"}

    await _kind(as_owner, None)
    res = await as_owner.patch(
        f"/v1/subjects/{pet['id']}", json={"name": "Cottage", "attributes": {"rooms": 9000}}
    )
    assert res.status_code == 200, res.text
    assert res.json()["attributes"] == {"rooms": 9000}
    assert (await as_owner.delete(f"/v1/subjects/{pet['id']}")).status_code == 204
    kept = await db.scalar(text("SELECT count(*) FROM subjects WHERE id = :i"), {"i": pet["id"]})
    assert kept == 1
