from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Resource, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import ok


async def _room(db: AsyncSession, name: str, *, business_id: str = BIZ, active: bool = True) -> str:
    room = Resource(id=new_id("resource"), business_id=business_id, name=name, active=active)
    db.add(room)
    await db.flush()
    return room.id


async def test_a_service_names_its_pool_once_each_in_order(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    second, first = await _room(db, "Room 2"), await _room(db, "Room 1")
    res = ok(
        await as_owner.post(
            "/v1/items",
            json={
                "kind": "service",
                "name": "Massage",
                "duration_min": 60,
                "resource_ids": [second, first, second],
            },
        ),
        201,
    )
    assert res.json()["resource_ids"] == sorted([first, second])
    cleared = ok(await as_owner.patch(f"/v1/items/{res.json()['id']}", json={"resource_ids": None}))
    assert cleared.json()["resource_ids"] == []


async def test_a_class_can_need_a_room_but_a_product_cant(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    studio = await _room(db, "Studio")
    made = await as_owner.post(
        "/v1/items",
        json={
            "kind": "class",
            "name": "Yoga",
            "duration_min": 60,
            "capacity": 8,
            "resource_ids": [studio],
        },
    )
    assert made.status_code == 201, made.text
    product = await as_owner.post(
        "/v1/items", json={"kind": "product", "name": "Mat", "resource_ids": [studio]}
    )
    assert product.status_code == 422
    turned = await as_owner.patch(f"/v1/items/{made.json()['id']}", json={"kind": "product"})
    assert turned.status_code == 422


async def test_unknown_retired_and_foreign_rooms_are_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    foreign = await _room(db, "Theirs", business_id=other.id)
    retired = await _room(db, "Old room", active=False)
    for resource_id in ("rs_nope", foreign, retired):
        res = await as_owner.post(
            "/v1/items",
            json={
                "kind": "service",
                "name": "Wrap",
                "duration_min": 30,
                "resource_ids": [resource_id],
            },
        )
        assert res.status_code == 404, resource_id
    assert await db.scalar(select(Item.id).where(Item.name == "Wrap")) is None


async def test_a_room_retired_later_stays_listed_and_editing_keeps_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    kept, added = await _room(db, "Room 1"), await _room(db, "Room 2")
    made = ok(
        await as_owner.post(
            "/v1/items",
            json={"kind": "service", "name": "Facial", "duration_min": 45, "resource_ids": [kept]},
        ),
        201,
    )
    room = await db.get(Resource, kept)
    assert room is not None
    room.active = False
    await db.flush()
    renamed = ok(await as_owner.patch(f"/v1/items/{made.json()['id']}", json={"name": "Facial+"}))
    assert renamed.json()["resource_ids"] == [kept]
    grown = ok(
        await as_owner.patch(f"/v1/items/{made.json()['id']}", json={"resource_ids": [kept, added]})
    )
    assert grown.json()["resource_ids"] == sorted([kept, added])


async def test_dropping_a_room_from_the_pool_leaves_booked_visits_on_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    room = await _room(db, "Room 1")
    item = ok(
        await as_owner.post(
            "/v1/items",
            json={"kind": "service", "name": "Scrub", "duration_min": 30, "resource_ids": [room]},
        ),
        201,
    ).json()["id"]
    start = clock.now() + timedelta(days=200)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item,
        staff_id="st_diego",
        resource_id=room,
        starts_at=start,
        ends_at=start + timedelta(minutes=30),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    ok(await as_owner.patch(f"/v1/items/{item}", json={"resource_ids": []}))
    await db.refresh(slot)
    assert slot.resource_id == room


async def test_only_managers_set_a_pool(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    room = await _room(db, "Room 1")
    res = await as_staff.patch("/v1/items/it_groom_sm", json={"resource_ids": [room]})
    assert res.status_code == 403
    item = await db.get(Item, "it_groom_sm")
    assert item is not None and item.resource_ids == []
