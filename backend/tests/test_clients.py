"""The clients REST endpoints, end-to-end against the seeded DB."""

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.security import issue_access_token
from clientbridge.models.messaging import Message, Thread
from tests.conftest import STAFF_USER, Factory
from tests.helpers import key

BIZ = "bz_birchbark"


async def _client(db: AsyncSession, client_id: str) -> dict[str, object]:
    row = await db.execute(
        text("SELECT name, tags, status, deleted_at FROM clients WHERE id = :i"), {"i": client_id}
    )
    return dict(row.mappings().one())


async def test_create_and_update(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Test Client", "email": "t@example.com"})
    assert res.status_code == 201, res.text
    created = res.json()
    cid = created["id"]
    assert cid.startswith("cl_")
    assert created["business_id"] == BIZ

    res = await as_owner.patch(f"/v1/clients/{cid}", json={"name": "Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed"
    assert (await _client(db, cid))["name"] == "Renamed"


async def test_update_missing_returns_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/clients/cl_does_not_exist", json={"name": "X"})
    assert res.status_code == 404


async def test_foreign_client_404_by_scoping(as_owner: httpx.AsyncClient, factory: Factory) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    patch = await as_owner.patch(f"/v1/clients/{foreign.id}", json={"name": "Taken"})
    assert patch.status_code == 404
    assert (await as_owner.post(f"/v1/clients/{foreign.id}/restore")).status_code == 404


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


async def test_tag_many_adds_and_removes(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    a = (await as_staff.post("/v1/clients", json={"name": "A", "tags": ["old", "keep"]})).json()
    b = (await as_staff.post("/v1/clients", json={"name": "B"})).json()
    res = await as_staff.post(
        "/v1/clients/tags",
        json={"client_ids": [a["id"], b["id"]], "set": {"Puppy ": True, "old": False}},
    )
    assert res.status_code == 200, res.text
    assert (await _client(db, a["id"]))["tags"] == ["keep", "puppy"]
    assert (await _client(db, b["id"]))["tags"] == ["puppy"]


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
    assert (await _client(db, gone))["deleted_at"] is not None


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


async def test_staff_cannot_restore_403(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Archived"})).json()["id"]
    assert (await as_owner.post(f"/v1/clients/{cid}/archive")).status_code == 200
    as_owner.headers["Authorization"] = f"Bearer {issue_access_token(STAFF_USER)}"
    assert (await as_owner.post(f"/v1/clients/{cid}/restore")).status_code == 403
    assert (await _client(db, cid))["status"] == "inactive"


async def test_tags_replay_on_the_same_key(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Tagged"})).json()["id"]
    headers = key()
    body = {"client_ids": [cid], "set": {"vip": True}}
    first = await as_owner.post("/v1/clients/tags", json=body, headers=headers)
    second = await as_owner.post("/v1/clients/tags", json=body, headers=headers)
    assert first.json() == second.json() == {"count": 1}
    assert await _audits(db, "client.tags", cid) == 1


async def test_archiving_an_archived_client_is_a_no_op(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Twice"})).json()["id"]
    headers = key()
    first = await as_owner.post(f"/v1/clients/{cid}/archive", headers=headers)
    replay = await as_owner.post(f"/v1/clients/{cid}/archive", headers=headers)
    assert first.status_code == replay.status_code == 200
    assert replay.json() == first.json()
    assert await _audits(db, "client.archive", cid) == 1
    again = await as_owner.post("/v1/clients/archive", json={"client_ids": [cid]})
    assert again.json() == {"count": 1}
    assert await _audits(db, "client.archive", cid) == 1


async def test_merge_into_an_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/clients/cl_nope/merge", json={"from_client_id": "cl_grace"})
    assert res.status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/v1/clients/cl_grace/restore",
        "/v1/clients/cl_grace/archive",
        "/v1/clients/tags",
        "/v1/clients/cl_grace/merge",
    ],
)
async def test_writes_need_a_session_401(unauth: httpx.AsyncClient, path: str) -> None:
    body = {"client_ids": ["cl_grace"], "set": {"x": True}, "from_client_id": "cl_grace"}
    assert (await unauth.post(path, json=body)).status_code == 401


async def _audits(db: AsyncSession, action: str, client_id: str) -> int:
    count = await db.scalar(
        text("SELECT count(*) FROM audits WHERE action = :a AND entity_id = :i"),
        {"a": action, "i": client_id},
    )
    return int(count or 0)
