"""The clients REST endpoints, end-to-end against the seeded DB."""

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.messaging import Message, Thread
from tests.conftest import Factory

BIZ = "bz_birchbark"


async def test_list_is_business_scoped(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/clients", params={"limit": 5})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] > 0
    assert len(body["items"]) <= 5
    assert all(c["business_id"] == BIZ for c in body["items"])


async def test_create_get_update_delete(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Test Client", "email": "t@example.com"})
    assert res.status_code == 201, res.text
    created = res.json()
    cid = created["id"]
    assert cid.startswith("cl_")
    assert created["business_id"] == BIZ

    res = await as_owner.get(f"/v1/clients/{cid}")
    assert res.status_code == 200
    assert res.json()["name"] == "Test Client"

    res = await as_owner.patch(f"/v1/clients/{cid}", json={"name": "Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed"

    res = await as_owner.delete(f"/v1/clients/{cid}")
    assert res.status_code == 204

    # soft delete: gone from scoped reads, but the row survives with deleted_at set
    res = await as_owner.get(f"/v1/clients/{cid}")
    assert res.status_code == 404
    deleted_at = (
        await db.execute(text("SELECT deleted_at FROM clients WHERE id = :i"), {"i": cid})
    ).scalar()
    assert deleted_at is not None


async def test_get_missing_returns_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.get("/v1/clients/cl_does_not_exist")
    assert res.status_code == 404


async def test_foreign_client_404_by_scoping(as_owner: httpx.AsyncClient, factory: Factory) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    assert (await as_owner.get(f"/v1/clients/{foreign.id}")).status_code == 404
    patch = await as_owner.patch(f"/v1/clients/{foreign.id}", json={"name": "Taken"})
    assert patch.status_code == 404
    assert (await as_owner.delete(f"/v1/clients/{foreign.id}")).status_code == 404


async def test_create_with_first_pet_consent_and_channel(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(
        "/v1/clients",
        json={
            "name": "  Nora Vance ",
            "phone": "2505550190",
            "preferred_channel": "email",
            "tags": ["New ", "new", "Puppy"],
            "marketing_consent": True,
            "subject": {"name": "Pip", "attributes": {"breed": "Beagle", "weight_kg": 9}},
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Nora Vance"
    assert body["preferred_channel"] == "email"
    assert body["tags"] == ["new", "puppy"]
    pets = (
        await db.execute(
            text("SELECT name, attributes FROM subjects WHERE client_id = :c"), {"c": body["id"]}
        )
    ).all()
    assert [(p.name, p.attributes["breed"]) for p in pets] == [("Pip", "Beagle")]
    consents = (
        await db.execute(
            text("SELECT channel, status, source FROM consents WHERE client_id = :c"),
            {"c": body["id"]},
        )
    ).all()
    assert sorted(tuple(c) for c in consents) == [
        ("email", "granted", "in_person"),
        ("sms", "granted", "in_person"),
    ]


async def test_update_records_consent_only_on_change(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Ivy"})).json()["id"]
    for agreed in (True, True, False):
        res = await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": agreed})
        assert res.status_code == 200, res.text
    rows = (
        await db.execute(
            text("SELECT status FROM consents WHERE client_id = :c AND channel = 'sms'"),
            {"c": cid},
        )
    ).scalars()
    assert sorted(rows) == ["granted", "withdrawn"]


async def test_create_rejects_blank_name_and_bad_pet_422(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/clients", json={"name": ""})).status_code == 422
    res = await as_owner.post(
        "/v1/clients",
        json={"name": "Odd", "subject": {"name": "X", "attributes": {"weight_kg": -1}}},
    )
    assert res.status_code == 422


async def test_archive_and_restore(as_owner: httpx.AsyncClient) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Arch"})).json()["id"]
    res = await as_owner.post(f"/v1/clients/{cid}/archive")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "inactive"
    assert res.json()["archived_at"] is not None
    res = await as_owner.post(f"/v1/clients/{cid}/restore")
    assert res.json()["status"] == "active"
    assert res.json()["archived_at"] is None


async def test_staff_cannot_archive_or_merge_403(as_staff: httpx.AsyncClient) -> None:
    cid = (await as_staff.post("/v1/clients", json={"name": "Staff Made"})).json()["id"]
    assert (await as_staff.post(f"/v1/clients/{cid}/archive")).status_code == 403
    res = await as_staff.post("/v1/clients/archive", json={"client_ids": [cid]})
    assert res.status_code == 403
    res = await as_staff.post(f"/v1/clients/{cid}/merge", json={"from_client_id": "cl_grace"})
    assert res.status_code == 403


async def test_archive_many_is_idempotent_and_audited(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ids = [(await as_owner.post("/v1/clients", json={"name": n})).json()["id"] for n in "AB"]
    headers = {"Idempotency-Key": "archive-many-1"}
    first = await as_owner.post("/v1/clients/archive", json={"client_ids": ids}, headers=headers)
    second = await as_owner.post("/v1/clients/archive", json={"client_ids": ids}, headers=headers)
    assert first.json() == second.json() == {"count": 2}
    audits = await db.scalar(
        text("SELECT count(*) FROM audits WHERE action = 'client.archive' AND entity_id = ANY(:i)"),
        {"i": ids},
    )
    assert audits == 2


async def test_archive_many_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/clients/archive", json={"client_ids": ["cl_nope"]})
    assert res.status_code == 404


async def test_tag_many_adds_and_removes(as_staff: httpx.AsyncClient) -> None:
    a = (await as_staff.post("/v1/clients", json={"name": "A", "tags": ["old", "keep"]})).json()
    b = (await as_staff.post("/v1/clients", json={"name": "B"})).json()
    res = await as_staff.post(
        "/v1/clients/tags",
        json={"client_ids": [a["id"], b["id"]], "set": {"Puppy ": True, "old": False}},
    )
    assert res.status_code == 200, res.text
    assert (await as_staff.get(f"/v1/clients/{a['id']}")).json()["tags"] == ["keep", "puppy"]
    assert (await as_staff.get(f"/v1/clients/{b['id']}")).json()["tags"] == ["puppy"]


async def test_tag_many_needs_a_change_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/clients/tags", json={"client_ids": ["cl_grace"], "set": {}})
    assert res.status_code == 422


async def test_bulk_endpoints_scope_by_business(
    as_owner: httpx.AsyncClient, factory: Factory
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    body = {"client_ids": [foreign.id], "set": {"x": True}}
    assert (await as_owner.post("/v1/clients/tags", json=body)).status_code == 404
    res = await as_owner.post("/v1/clients/archive", json={"client_ids": [foreign.id]})
    assert res.status_code == 404
    assert (await as_owner.post(f"/v1/clients/{foreign.id}/archive")).status_code == 404
    res = await as_owner.post("/v1/clients/cl_grace/merge", json={"from_client_id": foreign.id})
    assert res.status_code == 404


async def _thread_with_message(db: AsyncSession, client_id: str) -> None:
    db.add(Thread(id=f"th_{client_id}", business_id=BIZ, client_id=client_id, channel="sms"))
    await db.flush()
    db.add(
        Message(
            id=f"msg_{client_id}",
            business_id=BIZ,
            thread_id=f"th_{client_id}",
            direction="in",
            channel="sms",
            body="hello",
            status="delivered",
        )
    )
    await db.flush()


async def test_merge_moves_records_and_threads(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    kept = (await as_owner.post("/v1/clients", json={"name": "Kept", "tags": ["a"]})).json()["id"]
    gone = (
        await as_owner.post(
            "/v1/clients",
            json={"name": "Gone", "phone": "2505550111", "tags": ["b"], "subject": {"name": "Rex"}},
        )
    ).json()["id"]
    await as_owner.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": gone, "body": "Hi"}
    )
    await _thread_with_message(db, kept)
    await _thread_with_message(db, gone)
    headers = {"Idempotency-Key": "merge-1"}
    res = await as_owner.post(
        f"/v1/clients/{kept}/merge",
        json={"from_client_id": gone, "fields": {"name": "other"}},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["name"], body["phone"], body["tags"]) == ("Gone", "2505550111", ["a", "b"])
    replay = await as_owner.post(
        f"/v1/clients/{kept}/merge", json={"from_client_id": gone}, headers=headers
    )
    assert replay.json() == body
    pets = await db.scalar(text("SELECT count(*) FROM subjects WHERE client_id = :k"), {"k": kept})
    assert pets == 1
    threads = (
        await db.execute(
            text("SELECT DISTINCT thread_id FROM messages WHERE id = ANY(:i)"),
            {"i": [f"msg_{kept}", f"msg_{gone}"]},
        )
    ).scalars()
    assert list(threads) == [f"th_{kept}"]
    assert await db.scalar(text("SELECT parent_id FROM notes WHERE body = 'Hi'")) == kept
    assert (await as_owner.get(f"/v1/clients/{gone}")).status_code == 404


async def test_merge_refuses_self_money_and_saved_methods_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    kept = (await as_owner.post("/v1/clients", json={"name": "K"})).json()["id"]
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": kept})
    assert res.status_code == 409
    paid = await db.scalar(
        text("SELECT owner_id FROM accounts WHERE owner_type = 'client' LIMIT 1")
    )
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": paid})
    assert res.status_code == 409
    gone = (await as_owner.post("/v1/clients", json={"name": "G"})).json()["id"]
    await db.execute(
        text(
            "INSERT INTO payment_methods"
            " (id, business_id, client_id, method, status, preferred, mandate_status)"
            " VALUES ('pm_merge_test', :b, :c, 'card', 'active', false, 'none')"
        ),
        {"b": BIZ, "c": gone},
    )
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": gone})
    assert res.status_code == 409
