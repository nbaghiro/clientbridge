from datetime import timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Resource, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import key, ok


async def _room(db: AsyncSession, name: str, business_id: str = BIZ) -> Resource:
    room = Resource(id=new_id("resource"), business_id=business_id, name=name)
    db.add(room)
    await db.flush()
    return room


async def test_an_owner_adds_renames_and_retires_a_room(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    made = ok(await as_owner.post("/v1/resources", json={"name": " Bath bay "}, headers=key()), 201)
    room = made.json()
    assert room["name"] == "Bath bay" and room["active"] is True and room["upcoming"] == 0

    renamed = ok(await as_owner.patch(f"/v1/resources/{room['id']}", json={"name": "Tub room"}))
    assert renamed.json()["name"] == "Tub room"

    retired = ok(await as_owner.patch(f"/v1/resources/{room['id']}", json={"active": False}))
    assert retired.json()["active"] is False
    listed = ok(await as_owner.get("/v1/resources")).json()
    assert [r["name"] for r in listed if r["id"] == room["id"]] == ["Tub room"]
    actions = await db.scalars(
        select(Audit.action).where(Audit.entity_id == room["id"]).order_by(Audit.created_at)
    )
    assert list(actions) == ["resource.create", "resource.update", "resource.update"]


async def test_retiring_a_room_keeps_its_visits_and_counts_them(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    room = await _room(db, "Studio")
    start = clock.now() + timedelta(days=200)
    for offset in (0, 1):
        db.add(
            Slot(
                id=new_id("slot"),
                business_id=BIZ,
                item_id="it_groom_sm",
                staff_id="st_diego",
                resource_id=room.id,
                starts_at=start + timedelta(days=offset),
                ends_at=start + timedelta(days=offset, hours=1),
                capacity=1,
                status="scheduled",
            )
        )
    db.add(
        Slot(
            id=new_id("slot"),
            business_id=BIZ,
            item_id="it_groom_sm",
            staff_id="st_diego",
            resource_id=room.id,
            starts_at=clock.now() - timedelta(days=400),
            ends_at=clock.now() - timedelta(days=400) + timedelta(hours=1),
            capacity=1,
            status="completed",
        )
    )
    await db.flush()
    res = ok(await as_owner.patch(f"/v1/resources/{room.id}", json={"active": False}))
    assert res.json()["upcoming"] == 2
    held = await db.scalar(
        select(func.count(Slot.id)).where(Slot.resource_id == room.id, Slot.status == "scheduled")
    )
    assert held == 2


async def test_two_resources_cant_share_a_name_in_any_case(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _room(db, "Room 1")
    other = await factory.business()
    await _room(db, "Room 2", other.id)
    taken = await as_owner.post("/v1/resources", json={"name": "room 1"})
    assert taken.status_code == 409 and taken.json()["error"] == "resource_name_taken"
    elsewhere = ok(await as_owner.post("/v1/resources", json={"name": "Room 2"}), 201)
    renamed = await as_owner.patch(
        f"/v1/resources/{elsewhere.json()['id']}", json={"name": "ROOM 1"}
    )
    assert renamed.status_code == 409 and renamed.json()["error"] == "resource_name_taken"


async def test_staff_read_rooms_but_only_managers_change_them(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    room = await _room(db, "Room 1")
    listed = ok(await as_staff.get("/v1/resources")).json()
    assert room.id in {r["id"] for r in listed}
    assert (await as_staff.post("/v1/resources", json={"name": "Room 9"})).status_code == 403
    patched = await as_staff.patch(f"/v1/resources/{room.id}", json={"active": False})
    assert patched.status_code == 403
    await db.refresh(room)
    assert room.active is True


async def test_another_business_rooms_are_invisible(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    theirs = await _room(db, "Their room", other.id)
    res = await as_owner.patch(f"/v1/resources/{theirs.id}", json={"name": "Mine"})
    assert res.status_code == 404
    listed = ok(await as_owner.get("/v1/resources")).json()
    assert theirs.id not in {r["id"] for r in listed}
    await db.refresh(theirs)
    assert theirs.name == "Their room"


async def test_a_replayed_create_returns_the_first_room(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    first = ok(
        await as_owner.post("/v1/resources", json={"name": "Kennel 4"}, headers=headers), 201
    )
    again = ok(
        await as_owner.post("/v1/resources", json={"name": "Kennel 4"}, headers=headers), 201
    )
    assert again.json() == first.json()
    count = await db.scalar(
        select(func.count(Resource.id)).where(
            Resource.business_id == BIZ, Resource.name == "Kennel 4"
        )
    )
    assert count == 1
    reused = await as_owner.post("/v1/resources", json={"name": "Kennel 5"}, headers=headers)
    assert reused.status_code == 422


async def test_a_blank_name_is_refused(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/resources", json={"name": ""})).status_code == 422


async def test_a_name_of_only_spaces_is_refused(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/resources", json={"name": "   "})).status_code == 422
