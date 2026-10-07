import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Resource
from tests.conftest import Factory
from tests.helpers import client_id, key


async def test_owner_adds_a_station(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post("/v1/resources", json={"name": "  Table C ", "capacity": 4})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Table C"
    assert body["category"] == "station" and body["capacity"] == 1  # a station holds one visit
    row = await db.get(Resource, body["id"])
    assert row is not None and row.active
    audit = await db.execute(select(Audit.action).where(Audit.entity_id == body["id"]))
    assert audit.scalar_one() == "resource.create"


async def test_owner_adds_a_room_with_capacity(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/resources", json={"name": "Training room", "category": "room", "capacity": 8}
    )
    assert res.json()["capacity"] == 8


async def test_switching_off_keeps_bookings_and_blocks_new_ones(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.patch("/v1/resources/rs_station_a", json={"active": False})
    assert res.status_code == 200, res.text
    assert res.json()["active"] is False
    booked = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": "it_bath",
            "staff_id": "st_priya",
            "starts_at": "2027-03-01T18:00:00Z",
            "resource_id": "rs_station_a",
        },
    )
    assert booked.status_code == 409


async def test_rename_and_change_type(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch(
        "/v1/resources/rs_bath", json={"name": "Tub 1", "category": "station", "capacity": 5}
    )
    assert res.json()["name"] == "Tub 1"
    assert res.json()["capacity"] == 1


async def test_name_must_be_unique(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/resources", json={"name": "bath bay"})
    assert res.status_code == 409
    rename = await as_owner.patch("/v1/resources/rs_station_a", json={"name": "BATH BAY"})
    assert rename.status_code == 409
    same = await as_owner.patch("/v1/resources/rs_bath", json={"name": "Bath Bay"})
    assert same.status_code == 200


async def test_name_is_required(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/resources", json={"name": ""})).status_code == 422


async def test_staff_cannot_manage_resources(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/resources", json={"name": "Table D"})).status_code == 403
    assert (
        await as_staff.patch("/v1/resources/rs_bath", json={"active": False})
    ).status_code == 403


async def test_unauth_cannot_manage_resources(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.post("/v1/resources", json={"name": "Table D"})).status_code == 401


async def test_unknown_and_other_business_resource_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    db.add(Resource(id="rs_rival", business_id=other.id, name="Rival table", category="station"))
    await db.flush()
    assert (
        await as_owner.patch("/v1/resources/rs_rival", json={"active": False})
    ).status_code == 404
    assert (
        await as_owner.patch("/v1/resources/rs_missing", json={"active": False})
    ).status_code == 404


async def test_create_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    first = await as_owner.post("/v1/resources", json={"name": "Table E"}, headers=headers)
    again = await as_owner.post("/v1/resources", json={"name": "Table E"}, headers=headers)
    assert first.json()["id"] == again.json()["id"]
    rows = await db.execute(select(Resource.id).where(Resource.name == "Table E"))
    assert len(rows.scalars().all()) == 1
