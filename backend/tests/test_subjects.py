"""Subjects on a client (pets, students, properties, sites): add, edit, remove."""

import httpx
import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business, SubjectKind
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


async def _kind(db: AsyncSession, kind: SubjectKind | None) -> None:
    await db.execute(update(Business).where(Business.id == "bz_birchbark").values(subject=kind))


@pytest.mark.parametrize(
    ("kind", "attributes"),
    [
        ("student", {"birthday": "2015-09-01", "grade": "Grade 4", "school": "Oak Bay"}),
        ("property", {"address": "12 Pine St", "rooms": 3, "access": "Lockbox 4411"}),
        (
            "site",
            {
                "address": "880 Douglas St",
                "building": "retail",
                "access": "Gate code 4411",
                "pets": "None",
                "internet": "Telus fibre, router in the back office",
                "recorder_location": "Server closet",
                "equipment": [
                    {
                        "model": "4MP turret",
                        "serial": "TR-0042",
                        "location": "Front door",
                        "installed_on": "2026-04-12",
                        "warranty_until": "2028-04-12",
                    },
                    {"model": "8-channel recorder"},
                ],
            },
        ),
    ],
)
async def test_each_kind_stores_its_own_details(
    as_owner: httpx.AsyncClient, db: AsyncSession, kind: SubjectKind, attributes: dict[str, object]
) -> None:
    await _kind(db, kind)
    cid = await _client(as_owner)
    res = await as_owner.post(
        "/v1/subjects", json={"client_id": cid, "name": "Main", "attributes": attributes}
    )
    assert res.status_code == 201, res.text
    assert res.json()["attributes"] == attributes


@pytest.mark.parametrize(
    ("kind", "attributes"),
    [
        ("student", {"birthday": "soon"}),
        ("property", {"rooms": -1}),
        ("property", {"rooms": "x"}),
        ("site", {"building": "castle"}),
        ("site", {"equipment": [{"serial": "no model"}]}),
        ("site", {"equipment": [{"model": "Turret", "warranty_until": "soon"}]}),
        ("site", {"equipment": [{"model": "x" * 81}]}),
        ("site", {"equipment": [{"model": "Turret"}] * 101}),
        ("site", {"address": "x" * 201}),
        ("student", {"pickups": [{"name": ""}]}),
        ("student", {"pickups": [{"relation": "Aunt"}]}),
        ("student", {"pickups": [{"name": "x" * 81}]}),
        ("student", {"pickups": [{"name": "Rosa", "relation": "x" * 41}]}),
        ("student", {"pickups": [{"name": "Rosa", "phone": "6" * 21}]}),
        ("student", {"pickups": [{"name": "Rosa", "phone": "555-01"}]}),
        ("student", {"pickups": [{"name": "Rosa", "note": "x" * 201}]}),
        ("student", {"pickups": [{"name": "Rosa"}] * 11}),
        ("student", {"no_pickup": "x" * 501}),
    ],
)
async def test_invalid_details_for_the_kind_422(
    as_owner: httpx.AsyncClient, db: AsyncSession, kind: SubjectKind, attributes: dict[str, object]
) -> None:
    await _kind(db, kind)
    cid = await _client(as_owner)
    res = await as_owner.post(
        "/v1/subjects", json={"client_id": cid, "name": "X", "attributes": attributes}
    )
    assert res.status_code == 422
    assert res.json()["error"] == "invalid_request"


async def test_a_student_keeps_who_may_and_may_not_pick_them_up(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _kind(db, "student")
    cid = await _client(as_owner)
    longest = {
        "name": "n" * 80,
        "relation": "r" * 40,
        "phone": "+1 (613) 555-0181",
        "note": "x" * 200,
    }
    attributes = {
        "grade": "Grade 4",
        "pickups": [{"name": "Rosa Lindqvist", "relation": "Aunt"}, *[longest] * 9],
        "no_pickup": "y" * 500,
    }
    res = await as_owner.post(
        "/v1/subjects", json={"client_id": cid, "name": "Mia", "attributes": attributes}
    )
    assert res.status_code == 201, res.text
    stored = res.json()["attributes"]
    assert stored["pickups"][0] == {"name": "Rosa Lindqvist", "relation": "Aunt"}
    assert stored["pickups"][1]["phone"] == "+16135550181"
    assert len(stored["pickups"]) == 10
    assert stored["no_pickup"] == "y" * 500
    res = await as_owner.patch(
        f"/v1/subjects/{res.json()['id']}", json={"attributes": {"grade": "Grade 4"}}
    )
    assert res.json()["attributes"] == {"grade": "Grade 4"}


async def test_a_business_without_subjects_cannot_add_one_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _kind(db, None)
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
    await _kind(db, "property")
    res = await as_owner.patch(
        f"/v1/subjects/{pet['id']}",
        json={"attributes": {"breed": "Collie", "address": "4 Elm Rd", "rooms": None}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["attributes"] == {"breed": "Collie", "address": "4 Elm Rd"}

    await _kind(db, None)
    res = await as_owner.patch(
        f"/v1/subjects/{pet['id']}", json={"name": "Cottage", "attributes": {"rooms": 9000}}
    )
    assert res.status_code == 200, res.text
    assert res.json()["attributes"] == {"rooms": 9000}
    assert (await as_owner.delete(f"/v1/subjects/{pet['id']}")).status_code == 204
    kept = await db.scalar(text("SELECT count(*) FROM subjects WHERE id = :i"), {"i": pet["id"]})
    assert kept == 1
