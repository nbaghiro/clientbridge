"""Notes on a client, a pet or a visit: write, pin, edit, delete, and who may change them."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import STAFF_USER, Factory, FakeIdentityProvider, session_token


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


async def test_blank_body_and_unknown_parent_type_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "client", "parent_id": "cl_grace", "body": ""}
    )
    assert res.status_code == 422
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "invoice", "parent_id": "in_001", "body": "x"}
    )
    assert res.status_code == 422


async def test_note_on_a_booking(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_staff.post(
        "/v1/notes",
        json={"parent_type": "booking", "parent_id": "bk_001", "body": " Gate code 4412 "},
    )
    assert res.status_code == 201, res.text
    note = res.json()
    assert (note["parent_type"], note["parent_id"], note["body"]) == (
        "booking",
        "bk_001",
        "Gate code 4412",
    )
    stored = await db.execute(
        text("SELECT parent_type FROM notes WHERE id = :i"), {"i": note["id"]}
    )
    assert stored.scalar_one() == "booking"
    res = await as_staff.patch(f"/v1/notes/{note['id']}", json={"pinned": True})
    assert res.status_code == 200
    assert (await as_staff.delete(f"/v1/notes/{note['id']}")).status_code == 204


async def test_note_on_an_unknown_or_deleted_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"parent_type": "booking", "parent_id": "bk_nope", "body": "x"}
    res = await as_owner.post("/v1/notes", json=body)
    assert res.status_code == 404
    assert res.json()["error"] == "not_found"
    await db.execute(text("UPDATE bookings SET deleted_at = now() WHERE id = 'bk_001'"))
    res = await as_owner.post("/v1/notes", json=body | {"parent_id": "bk_001"})
    assert res.status_code == 404


async def test_note_on_a_foreign_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    staff = await factory.staff(business=other)
    item = Item(id=new_id("item"), business_id=other.id, kind="service", name="Private service")
    db.add(item)
    await db.flush()
    start = datetime(2027, 3, 2, 18, tzinfo=UTC)
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=staff.id,
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        starts_at=start,
        staff_id=staff.id,
        client_id=client.id,
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "booking", "parent_id": booking.id, "body": "x"}
    )
    assert res.status_code == 404
    count = await db.execute(
        text("SELECT COUNT(*) FROM notes WHERE parent_id = :b"), {"b": booking.id}
    )
    assert count.scalar_one() == 0


async def test_staff_change_only_their_own_booking_notes_403(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "booking", "parent_id": "bk_001", "body": "Owner's"}
    )
    theirs = res.json()["id"]
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
    assert (await as_owner.patch(f"/v1/notes/{theirs}", json={"body": "y"})).status_code == 403
    assert (await as_owner.delete(f"/v1/notes/{theirs}")).status_code == 403


async def test_staff_change_only_their_own_notes_403(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    theirs = await _note(as_owner)
    mine = await _note(as_owner)
    await db.execute(text("UPDATE notes SET created_by = 'us_diego' WHERE id = :i"), {"i": mine})
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, STAFF_USER)
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


async def test_note_on_a_foreign_pet_404(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business()
    foreign = await factory.client(business=other)
    await db.execute(
        text(
            "INSERT INTO subjects (id, business_id, client_id, name, attributes)"
            " VALUES ('sj_foreign_note', :b, :c, 'Theirs', '{}')"
        ),
        {"b": other.id, "c": foreign.id},
    )
    res = await as_owner.post(
        "/v1/notes", json={"parent_type": "subject", "parent_id": "sj_foreign_note", "body": "x"}
    )
    assert res.status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "/v1/notes"), ("PATCH", "/v1/notes/nt_x"), ("DELETE", "/v1/notes/nt_x")],
)
async def test_requires_auth_401(unauth: httpx.AsyncClient, method: str, path: str) -> None:
    body = {"parent_type": "client", "parent_id": "cl_grace", "body": "x"}
    res = await unauth.request(method, path, json=None if method == "DELETE" else body)
    assert res.status_code == 401
