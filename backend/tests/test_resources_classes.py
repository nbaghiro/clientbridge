import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Recurrence, Resource, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import client_id, key, new_client, ok

DIEGO, OWNER = "st_diego", "st_owner"
FIRST = "2027-03-02T18:00:00Z"
WEDNESDAY = "2027-03-03T18:00:00Z"


async def _studio(db: AsyncSession) -> str:
    room = Resource(id=new_id("resource"), business_id=BIZ, name="Studio")
    db.add(room)
    await db.flush()
    return room.id


async def _class(db: AsyncSession, pool: list[str], *, sessions: int | None = None) -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="class",
        name="Yoga",
        price_cents=2000,
        currency="CAD",
        duration_min=60,
        capacity=4,
        session_count=sessions,
        online_bookable=True,
        resource_ids=pool,
    )
    db.add(item)
    await db.flush()
    return item.id


async def _seat(
    api: httpx.AsyncClient, client: str, item: str, staff: str, starts: str = FIRST
) -> httpx.Response:
    return await api.post(
        "/v1/bookings",
        json={
            "client_id": client,
            "item_id": item,
            "staff_id": staff,
            "starts_at": starts,
            "notify": False,
        },
    )


async def test_a_class_session_holds_one_room_for_every_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    studio = await _studio(db)
    yoga = await _class(db, [studio])
    first = ok(await _seat(as_owner, await client_id(db), yoga, OWNER), 201).json()
    assert first["resource_id"] == studio
    other = await new_client(db)
    joined = ok(await _seat(as_owner, other, yoga, OWNER), 201).json()
    assert joined["slot_id"] == first["slot_id"] and joined["resource_id"] == studio
    held = await db.scalar(select(func.count(Slot.id)).where(Slot.resource_id == studio))
    assert held == 1


async def test_two_classes_cant_share_the_studio_at_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    studio = await _studio(db)
    yoga, pilates = await _class(db, [studio]), await _class(db, [studio])
    ok(await _seat(as_owner, await client_id(db), yoga, OWNER), 201)
    clash = await _seat(as_owner, await client_id(db), pilates, DIEGO)
    assert clash.status_code == 409 and clash.json()["error"] == "no_resource"


async def test_a_program_takes_the_room_every_day_or_none(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    studio = await _studio(db)
    camp = await _class(db, [studio], sessions=3)
    other = await _class(db, [studio])
    ok(await _seat(as_owner, await client_id(db), other, DIEGO, WEDNESDAY), 201)
    body = {
        "item_id": camp,
        "staff_id": OWNER,
        "starts_at": FIRST,
        "byday": ["TU", "WE", "TH"],
        "count": 3,
    }
    refused = await as_owner.post("/v1/programs", json=body, headers=key())
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"] == "schedule_conflict"
    assert refused.json()["detail"]["problem"] == "resource"
    assert refused.json()["detail"]["starts_at"].startswith("2027-03-03")
    made = await db.scalar(select(func.count(Recurrence.id)).where(Recurrence.item_id == camp))
    assert made == 0
    body["starts_at"] = "2027-03-09T18:00:00Z"
    created = ok(await as_owner.post("/v1/programs", json=body, headers=key()), 201).json()
    assert {s["resource_id"] for s in created["sessions"]} == {studio}


async def test_a_program_moved_to_another_instructor_keeps_its_room(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    studio = await _studio(db)
    camp = await _class(db, [studio], sessions=2)
    business = await factory.business()
    leaving = await factory.staff(business=business, role="staff")
    leaving.business_id = BIZ
    await db.flush()
    created = ok(
        await as_owner.post(
            "/v1/programs",
            json={
                "item_id": camp,
                "staff_id": leaving.id,
                "starts_at": FIRST,
                "byday": ["TU", "WE"],
                "count": 2,
            },
            headers=key(),
        ),
        201,
    ).json()
    ok(
        await as_owner.post(
            f"/v1/staff/{leaving.id}/remove",
            json={"future": "reassign", "reassign_to": OWNER},
            headers=key(),
        )
    )
    rows = (
        await db.execute(
            select(Slot.staff_id, Slot.resource_id)
            .where(Slot.recurrence_id == created["id"])
            .execution_options(populate_existing=True)
        )
    ).all()
    assert {tuple(r) for r in rows} == {(OWNER, studio)}
    assert (
        await db.scalar(select(func.count(Booking.id)).where(Booking.staff_id == leaving.id)) == 0
    )
