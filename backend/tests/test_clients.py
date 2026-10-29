"""The clients REST endpoints, end-to-end against the seeded DB."""

from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Message, Thread
from tests.conftest import (
    OWNER_USER,
    STAFF_USER,
    Factory,
    FakeIdentityProvider,
    FakePaymentGateway,
    session_token,
)
from tests.helpers import client_id, enable_payments, key

BIZ = "bz_birchbark"


async def _client(db: AsyncSession, client_id: str) -> dict[str, object]:
    row = await db.execute(
        text("SELECT name, tags, status, deleted_at FROM clients WHERE id = :i"), {"i": client_id}
    )
    return dict(row.mappings().one())


async def test_create_and_update(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post("/v1/clients", json={"name": "Test Client", "phone": "+16045550111"})
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


async def test_foreign_client_404_by_scoping(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    foreign_id = foreign.id
    await db.commit()
    patch = await as_owner.patch(f"/v1/clients/{foreign_id}", json={"name": "Taken"})
    assert patch.status_code == 404
    assert (await as_owner.post(f"/v1/clients/{foreign_id}/restore")).status_code == 404


async def test_create_with_first_pet_and_sms_consent(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(
        "/v1/clients",
        json={
            "name": "  Nora Vance ",
            "phone": "2505550190",
            "tags": ["New ", "new", "Puppy"],
            "marketing_consent": True,
            "subject": {"name": "Pip", "attributes": {"breed": "Beagle", "weight_kg": 9}},
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Nora Vance"
    assert body["tags"] == ["new", "puppy"]
    pets = (
        await db.execute(
            text("SELECT name, attributes FROM subjects WHERE client_id = :c"), {"c": body["id"]}
        )
    ).all()
    assert [(p.name, p.attributes["breed"]) for p in pets] == [("Pip", "Beagle")]
    consents = (
        await db.execute(
            text("SELECT status, source FROM consents WHERE client_id = :c"),
            {"c": body["id"]},
        )
    ).all()
    assert [tuple(c) for c in consents] == [("granted", "in_person")]


async def test_update_records_consent_only_on_change(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Ivy"})).json()["id"]
    for agreed in (True, True, False):
        res = await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": agreed})
        assert res.status_code == 200, res.text
    rows = (
        await db.execute(
            text("SELECT status FROM consents WHERE client_id = :c"),
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


@pytest.mark.parametrize("member", [STAFF_USER, OWNER_USER])
async def test_status_changes_only_through_archive_and_restore(
    member: str, api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    token = await session_token(identities, db, member)
    api.headers.update({"X-Session-Token": token, "X-Business-Id": BIZ})
    client = Client(id=new_id("client"), business_id=BIZ, name="Kept Active", tags=[])
    db.add(client)
    await db.flush()
    for status in ("inactive", "active"):
        res = await api.patch(f"/v1/clients/{client.id}", json={"status": status})
        assert res.status_code == 422, res.text
    row = await db.get(Client, client.id, populate_existing=True)
    assert row is not None and (row.status, row.archived_at) == ("active", None)
    created = await api.post("/v1/clients", json={"name": "Quiet", "status": "inactive"})
    assert created.status_code == 422


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


async def test_archive_many_refuses_a_key_reused_for_other_clients(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ids = [(await as_owner.post("/v1/clients", json={"name": n})).json()["id"] for n in "AB"]
    headers = {"Idempotency-Key": "archive-many-2"}
    first = await as_owner.post(
        "/v1/clients/archive", json={"client_ids": ids[:1]}, headers=headers
    )
    assert first.json() == {"count": 1}
    other = await as_owner.post(
        "/v1/clients/archive", json={"client_ids": ids[1:]}, headers=headers
    )
    assert (other.status_code, other.json()["error"]) == (422, "idempotency_key_reused")
    assert (await _client(db, ids[1]))["status"] == "active"


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
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    foreign_id = foreign.id
    thread = Thread(
        id=f"th_{foreign_id}",
        business_id=other.id,
        client_id=foreign_id,
    )
    thread_id = thread.id
    db.add(thread)
    await db.flush()
    body = {"client_ids": [foreign_id], "set": {"x": True}}
    assert (await as_owner.post("/v1/clients/tags", json=body)).status_code == 404
    res = await as_owner.post("/v1/clients/archive", json={"client_ids": [foreign_id]})
    assert res.status_code == 404
    assert (await as_owner.post(f"/v1/clients/{foreign_id}/archive")).status_code == 404
    res = await as_owner.post("/v1/clients/cl_grace/merge", json={"from_client_id": foreign_id})
    assert res.status_code == 404
    kept_thread = await db.get(Thread, thread_id, populate_existing=True)
    assert kept_thread is not None and kept_thread.client_id == foreign_id


async def _thread_with_message(db: AsyncSession, client_id: str) -> None:
    db.add(Thread(id=f"th_{client_id}", business_id=BIZ, client_id=client_id))
    await db.flush()
    db.add(
        Message(
            id=f"msg_{client_id}",
            business_id=BIZ,
            thread_id=f"th_{client_id}",
            direction="in",
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
    began = datetime(2024, 5, 1, tzinfo=UTC)
    await db.execute(update(Thread).where(Thread.id == f"th_{gone}").values(created_at=began))
    headers = {"Idempotency-Key": "merge-1"}
    res = await as_owner.post(
        f"/v1/clients/{kept}/merge",
        json={"from_client_id": gone, "fields": {"name": "other"}},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["name"], body["phone"], body["tags"]) == ("Gone", "+12505550111", ["a", "b"])
    replay = await as_owner.post(
        f"/v1/clients/{kept}/merge",
        json={"from_client_id": gone, "fields": {"name": "other"}},
        headers=headers,
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
    kept_thread = await db.get(Thread, f"th_{kept}", populate_existing=True)
    assert kept_thread is not None and kept_thread.created_at == began
    assert await db.scalar(text("SELECT parent_id FROM notes WHERE body = 'Hi'")) == kept
    assert (await _client(db, gone))["deleted_at"] is not None


async def test_merge_refuses_self_money_and_saved_methods_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    kept = (await as_owner.post("/v1/clients", json={"name": "K"})).json()["id"]
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": kept})
    assert res.status_code == 409
    paid = await db.scalar(
        text(
            "SELECT owner_id FROM accounts WHERE owner_type = 'client' AND business_id = :b LIMIT 1"
        ),
        {"b": BIZ},
    )
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": paid})
    assert res.status_code == 409
    gone = (await as_owner.post("/v1/clients", json={"name": "G"})).json()["id"]
    await db.execute(
        text(
            "INSERT INTO payment_methods"
            " (id, business_id, client_id, method, preferred, mandate_status)"
            " VALUES ('pm_merge_test', :b, :c, 'card', false, 'none')"
        ),
        {"b": BIZ, "c": gone},
    )
    res = await as_owner.post(f"/v1/clients/{kept}/merge", json={"from_client_id": gone})
    assert res.status_code == 409


async def test_staff_cannot_restore_403(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Archived"})).json()["id"]
    assert (await as_owner.post(f"/v1/clients/{cid}/archive")).status_code == 200
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
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


async def test_archive_and_restore_without_a_key_change_nothing_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = (await as_owner.post("/v1/clients", json={"name": "Twice"})).json()["id"]
    restored = await as_owner.post(f"/v1/clients/{cid}/restore")
    assert restored.status_code == 200 and restored.json()["status"] == "active"
    assert await _audits(db, "client.restore", cid) == 0
    first = (await as_owner.post(f"/v1/clients/{cid}/archive")).json()
    second = await as_owner.post(f"/v1/clients/{cid}/archive")
    assert second.status_code == 200
    assert second.json()["archived_at"] == first["archived_at"]
    assert await _audits(db, "client.archive", cid) == 1
    await as_owner.post(f"/v1/clients/{cid}/restore")
    again = await as_owner.post(f"/v1/clients/{cid}/restore")
    assert again.json()["archived_at"] is None
    assert await _audits(db, "client.restore", cid) == 1


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


async def test_create_replays_the_same_client_for_a_retried_attempt(
    as_owner: httpx.AsyncClient,
) -> None:
    headers = {"Idempotency-Key": "client-create-retry"}
    body = {"name": "Retry client", "phone": "+16045550112"}
    first = await as_owner.post("/v1/clients", json=body, headers=headers)
    assert first.status_code == 201
    replay = await as_owner.post("/v1/clients", json=body, headers=headers)
    assert replay.status_code == 201
    assert replay.json() == first.json()
    changed = await as_owner.post("/v1/clients", json=body | {"name": "Other"}, headers=headers)
    assert changed.status_code == 422


async def test_client_update_replays_without_overwriting_a_later_edit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = {"Idempotency-Key": "client-update-replay"}
    original = await as_owner.patch(
        "/v1/clients/cl_amelie", json={"name": "First edit"}, headers=headers
    )
    assert original.status_code == 200
    assert (
        await as_owner.patch("/v1/clients/cl_amelie", json={"name": "Later edit"})
    ).status_code == 200
    replayed = await as_owner.patch(
        "/v1/clients/cl_amelie", json={"name": "First edit"}, headers=headers
    )
    assert replayed.json() == original.json()
    row = await db.get(Client, "cl_amelie", populate_existing=True)
    assert row is not None and row.name == "Later edit"


async def test_public_contact_matching_refuses_two_different_clients(db: AsyncSession) -> None:
    from clientbridge.core.errors import Conflict
    from clientbridge.services.clients import find_or_create_by_contact

    first = await db.get(Client, "cl_amelie")
    second = await db.get(Client, "cl_marcus")
    assert first is not None and second is not None
    first.phone = second.phone = "+16045550111"
    await db.flush()
    with pytest.raises(Conflict, match="contact"):
        await find_or_create_by_contact(
            db, BIZ, name="Ambiguous", phone=second.phone, source="book"
        )


async def test_merge_refuses_pending_money_even_before_ledger_posting(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    from clientbridge.core.ids import new_id
    from clientbridge.models.payments import Payment
    from tests.helpers import new_client

    gone = await new_client(db)
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            client_id=gone,
            kind="payment",
            amount_cents=100,
            status="pending",
            method="card",
            provider="stripe",
        )
    )
    await db.commit()
    response = await as_owner.post(
        "/v1/clients/cl_grace/merge", json={"from_client_id": gone}, headers=key()
    )
    assert response.status_code == 409
    client = await db.get(Client, gone)
    assert client is not None and client.deleted_at is None


async def test_a_name_edit_reaches_the_stripe_customer(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_sync"))
    await db.commit()
    tags = await as_owner.patch(f"/v1/clients/{cid}", json={"tags": ["vip"]})
    assert tags.status_code == 200
    assert gateway.customer_updates == []
    renamed = await as_owner.patch(f"/v1/clients/{cid}", json={"name": "Renamed Client"})
    assert renamed.status_code == 200, renamed.text
    assert gateway.customer_updates == [("cus_sync", "Renamed Client")]
