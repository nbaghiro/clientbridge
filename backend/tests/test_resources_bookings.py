import asyncio
from collections.abc import Sequence
from datetime import datetime

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Resource, Slot
from clientbridge.schemas.bookings import BookingCreate, BookingOut
from clientbridge.services import resources
from clientbridge.services.bookings import BookingService
from clientbridge.services.resources import lock_resources
from tests.conftest import BIZ, OWNER_USER, Factory, FakePaymentGateway
from tests.helpers import client_id, delete_bookings, key, ok

SLUG = "birchbark"
DIEGO, OWNER = "st_diego", "st_owner"
DAY = "2027-03-02"
TEN, ELEVEN, NOON = "2027-03-02T18:00:00Z", "2027-03-02T19:00:00Z", "2027-03-02T20:00:00Z"


async def _rooms(db: AsyncSession, *names: str, active: bool = True) -> list[str]:
    made = [Resource(id=new_id("resource"), business_id=BIZ, name=n, active=active) for n in names]
    db.add_all(made)
    await db.flush()
    return [r.id for r in made]


async def _service(db: AsyncSession, pool: Sequence[str], *, after: int = 0) -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="service",
        name="Massage",
        price_cents=9000,
        currency="CAD",
        duration_min=60,
        buffer_after_min=after,
        online_bookable=True,
        resource_ids=sorted(pool),
    )
    db.add(item)
    await db.flush()
    return item.id


async def _book(
    api: httpx.AsyncClient,
    db: AsyncSession,
    item: str,
    staff: str,
    starts: str,
    resource: str | None = None,
) -> httpx.Response:
    body: dict[str, object] = {
        "client_id": await client_id(db),
        "item_id": item,
        "staff_id": staff,
        "starts_at": starts,
        "notify": False,
    }
    if resource is not None:
        body["resource_id"] = resource
    return await api.post("/v1/bookings", json=body)


async def _held(db: AsyncSession, booking_id: str) -> str | None:
    return await db.scalar(
        select(Slot.resource_id)
        .join(Booking, Booking.slot_id == Slot.id)
        .where(Booking.id == booking_id)
        .execution_options(populate_existing=True)
    )


async def test_each_booking_takes_the_first_free_room_until_none_is_left(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    first = ok(await _book(as_owner, db, item, DIEGO, TEN), 201)
    assert first.json()["resource_id"] == room
    second = await _book(as_owner, db, item, OWNER, TEN)
    assert second.status_code == 409 and second.json()["error"] == "no_resource"
    later = ok(await _book(as_owner, db, item, OWNER, ELEVEN), 201)
    assert later.json()["resource_id"] == room


async def test_staff_can_pick_a_room_from_the_pool(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    one, two = await _rooms(db, "Room 1", "Room 2")
    (outside,) = await _rooms(db, "Office")
    item = await _service(db, [one, two])
    picked = ok(await _book(as_owner, db, item, DIEGO, TEN, two), 201)
    assert picked.json()["resource_id"] == two
    busy = await _book(as_owner, db, item, OWNER, TEN, two)
    assert busy.status_code == 409 and busy.json()["error"] == "resource_busy"
    stray = await _book(as_owner, db, item, OWNER, TEN, outside)
    assert stray.status_code == 422 and stray.json()["error"] == "resource_not_in_pool"
    auto = ok(await _book(as_owner, db, item, OWNER, TEN), 201)
    assert auto.json()["resource_id"] == one


async def test_a_retired_room_is_offered_for_nothing_new(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (old,) = await _rooms(db, "Old room", active=False)
    (new,) = await _rooms(db, "New room")
    item = await _service(db, [old, new])
    booked = ok(await _book(as_owner, db, item, DIEGO, TEN), 201)
    assert booked.json()["resource_id"] == new
    refused = await _book(as_owner, db, item, OWNER, TEN, old)
    assert refused.status_code == 422


async def test_a_service_with_no_pool_books_as_before(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, [])
    booked = ok(await _book(as_owner, db, item, DIEGO, TEN), 201)
    assert booked.json()["resource_id"] is None
    other = ok(await _book(as_owner, db, item, OWNER, TEN), 201)
    assert other.json()["resource_id"] is None


def _starts(res: httpx.Response) -> set[str]:
    return {s["starts_at"].replace("+00:00", "Z") for s in res.json()["slots"]}


async def test_connect_offers_only_times_with_a_free_room(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    ok(await _book(as_owner, db, item, DIEGO, TEN), 201)
    params = {"item_id": item, "staff_id": OWNER, "date": DAY}
    offered = _starts(ok(await as_owner.get(f"/book/{SLUG}/slots", params=params)))
    assert TEN not in offered and ELEVEN in offered
    days = ok(
        await as_owner.get(
            f"/book/{SLUG}/days", params={"item_id": item, "staff_id": OWNER, "from": DAY}
        )
    ).json()["days"]
    assert days[0]["count"] == len(offered)
    online = await as_owner.post(
        f"/book/{SLUG}",
        json={
            "item_id": item,
            "staff_id": "any",
            "starts_at": TEN,
            "client": {"name": "Web Booker", "phone": "+16045550156"},
        },
    )
    assert online.status_code == 409


async def test_a_rooms_buffer_keeps_the_next_visit_off_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room], after=15)
    ok(await _book(as_owner, db, item, DIEGO, TEN), 201)
    params = {"item_id": item, "staff_id": OWNER, "date": DAY}
    assert ELEVEN not in _starts(ok(await as_owner.get(f"/book/{SLUG}/slots", params=params)))
    refused = await _book(as_owner, db, item, OWNER, ELEVEN)
    assert refused.status_code == 409 and refused.json()["error"] == "no_resource"


async def test_a_move_keeps_its_room_switches_to_a_free_one_or_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    one, two = await _rooms(db, "Room 1", "Room 2")
    item = await _service(db, [one, two])
    visit = ok(await _book(as_owner, db, item, DIEGO, TEN, two), 201).json()["id"]
    ok(await _book(as_owner, db, item, OWNER, NOON, two), 201)
    ok(await as_owner.patch(f"/v1/bookings/{visit}", json={"starts_at": ELEVEN, "notify": False}))
    assert await _held(db, visit) == two
    ok(await as_owner.patch(f"/v1/bookings/{visit}", json={"starts_at": NOON, "notify": False}))
    assert await _held(db, visit) == one
    ok(await _book(as_owner, db, item, OWNER, TEN, two), 201)
    ok(await _book(as_owner, db, item, "st_priya", TEN, one), 201)
    back = await as_owner.patch(f"/v1/bookings/{visit}", json={"starts_at": TEN, "notify": False})
    assert back.status_code == 409 and back.json()["error"] == "no_resource"
    assert await _held(db, visit) == one


async def test_staff_switch_a_visit_to_another_free_room(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    one, two = await _rooms(db, "Room 1", "Room 2")
    item = await _service(db, [one, two])
    visit = ok(await _book(as_owner, db, item, DIEGO, TEN), 201).json()["id"]
    check = ok(await as_owner.post(f"/v1/bookings/{visit}/check", json={"resource_id": two}))
    assert check.json()["ok"] is True and check.json()["resource_id"] == two
    moved = ok(await as_owner.patch(f"/v1/bookings/{visit}", json={"resource_id": two}))
    assert moved.json()["resource_id"] == two and moved.json()["starts_at"].startswith(DAY)
    ok(await _book(as_owner, db, item, OWNER, TEN, one), 201)
    taken = ok(await as_owner.post(f"/v1/bookings/{visit}/check", json={"resource_id": one}))
    assert taken.json()["problem"] == "resource" and taken.json()["free_resource_ids"] == [two]
    refused = await as_owner.patch(f"/v1/bookings/{visit}", json={"resource_id": one})
    assert refused.status_code == 409 and refused.json()["error"] == "resource_busy"


async def test_the_check_reports_a_time_with_no_free_room(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    visit = ok(await _book(as_owner, db, item, DIEGO, TEN), 201).json()["id"]
    ok(await _book(as_owner, db, item, OWNER, NOON), 201)
    free = ok(await as_owner.post(f"/v1/bookings/{visit}/check", json={"starts_at": ELEVEN}))
    assert free.json() == {
        "ok": True,
        "problem": None,
        "reason": None,
        "message": None,
        "resource_id": room,
        "free_resource_ids": [room],
    }
    busy = ok(await as_owner.post(f"/v1/bookings/{visit}/check", json={"starts_at": NOON}))
    assert busy.json()["ok"] is False and busy.json()["problem"] == "resource"
    assert busy.json()["free_resource_ids"] == []


async def test_an_addon_cant_lengthen_a_visit_into_the_next_rooms_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    wrap = new_id("item")
    db.add(Item(id=wrap, business_id=BIZ, kind="product", name="Wrap", duration_min=30))
    await db.flush()
    visit = ok(await _book(as_owner, db, item, DIEGO, TEN), 201).json()["id"]
    ok(await _book(as_owner, db, item, OWNER, ELEVEN), 201)
    refused = await as_owner.post(
        f"/v1/bookings/{visit}/addons", json={"item_id": wrap}, headers=key()
    )
    assert refused.status_code == 409 and refused.json()["error"] == "no_resource"
    (spare,) = await _rooms(db, "Room 2")
    pool = await db.get(Item, item)
    assert pool is not None
    pool.resource_ids = sorted([room, spare])
    await db.flush()
    lengthened = ok(
        await as_owner.post(f"/v1/bookings/{visit}/addons", json={"item_id": wrap}, headers=key()),
        201,
    )
    assert lengthened.json()["resource_id"] == spare


async def test_a_clients_move_follows_the_room_rules(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    visit = ok(await _book(as_owner, db, item, DIEGO, TEN), 201).json()["id"]
    ok(await _book(as_owner, db, item, OWNER, NOON), 201)
    booking = await db.get(Booking, visit)
    assert booking is not None and booking.manage_token is not None
    manage = f"/manage/{booking.manage_token}"
    offered = _starts(ok(await as_owner.get(f"{manage}/slots", params={"date": DAY})))
    assert ELEVEN in offered and NOON not in offered
    refused = await as_owner.post(f"{manage}/reschedule", json={"starts_at": NOON}, headers=key())
    assert refused.status_code == 409
    ok(await as_owner.post(f"{manage}/reschedule", json={"starts_at": ELEVEN}, headers=key()))
    assert await _held(db, visit) == room


async def test_a_series_change_carries_rooms_and_skips_a_visit_with_none(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    series = ok(
        await as_owner.post(
            "/v1/recurrences",
            json={
                "client_id": await client_id(db),
                "item_id": item,
                "staff_id": DIEGO,
                "starts_at": TEN,
                "frequency": "week",
                "interval": 1,
                "count": 2,
                "confirmation": "none",
            },
        ),
        201,
    ).json()
    first, second = (o["booking_id"] for o in series["occurrences"])
    assert await _held(db, first) == room and await _held(db, second) == room
    ok(await _book(as_owner, db, item, OWNER, "2027-03-09T20:00:00Z"), 201)
    changed = ok(
        await as_owner.patch(
            f"/v1/recurrences/{series['id']}", json={"scope": "all", "time": "13:00"}
        )
    ).json()
    assert changed["moved"] == [first]
    assert [s["booking_id"] for s in changed["skipped"]] == [second]
    assert await _held(db, first) == room


async def test_a_visit_reassigned_on_removal_keeps_its_room(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    business = await factory.business()
    leaving = await factory.staff(business=business, role="staff")
    leaving.business_id = BIZ
    await db.flush()
    visit = ok(await _book(as_owner, db, item, leaving.id, TEN), 201).json()["id"]
    ok(
        await as_owner.post(
            f"/v1/staff/{leaving.id}/remove",
            json={"future": "reassign", "reassign_to": OWNER},
            headers=key(),
        )
    )
    moved = await db.get(Booking, visit)
    assert moved is not None and moved.staff_id == OWNER
    assert await _held(db, visit) == room


async def test_the_overlap_constraint_backstops_a_missed_room_check(
    as_owner: httpx.AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    (room,) = await _rooms(db, "Room 1")
    item = await _service(db, [room])
    ok(await _book(as_owner, db, item, DIEGO, TEN), 201)

    async def everything_free(
        _db: AsyncSession, _biz: str, ids: Sequence[str], *_: object
    ) -> list[str]:
        return list(ids)

    monkeypatch.setattr(resources, "resource_free", everything_free)
    raced = await _book(as_owner, db, item, OWNER, TEN)
    assert raced.status_code == 409 and raced.json()["error"] == "resource_busy"


async def test_two_bookings_racing_for_one_room_leave_one_winner(db: AsyncSession) -> None:
    principal = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id=OWNER, role="owner")
    room_id, item_id = new_id("resource"), new_id("item")
    booked: list[str] = []
    async with SessionLocal() as setup:
        setup.add(Resource(id=room_id, business_id=BIZ, name="Race room"))
        setup.add(
            Item(
                id=item_id,
                business_id=BIZ,
                kind="service",
                name="Race massage",
                duration_min=60,
                resource_ids=[room_id],
            )
        )
        await setup.commit()
    client = await client_id(db)

    async def book(staff: str) -> BookingOut | Conflict:
        async with SessionLocal() as session:
            service = BookingService(session, principal, FakePaymentGateway())
            try:
                out = await service.create(
                    BookingCreate(
                        client_id=client,
                        item_id=item_id,
                        staff_id=staff,
                        starts_at=datetime.fromisoformat(TEN),
                        notify=False,
                    ),
                    None,
                )
            except Conflict as exc:
                return exc
            booked.append(out.id)
            return out

    try:
        async with SessionLocal() as holder:
            # holding the room's lock lets both bookings pass their own member's checks first
            await lock_resources(holder, BIZ, room_id)
            racing = asyncio.gather(book(DIEGO), book(OWNER))
            await asyncio.sleep(0.3)
            await holder.commit()
            results = await racing
        assert sorted(type(r).__name__ for r in results) == ["BookingOut", "Conflict"]
        refused = next(r for r in results if isinstance(r, Conflict))
        assert refused.code == "no_resource"
    finally:
        async with SessionLocal() as cleanup:
            await delete_bookings(cleanup, booked)
            await cleanup.execute(delete(Item).where(Item.id == item_id))
            await cleanup.execute(delete(Resource).where(Resource.id == room_id))
            await cleanup.commit()


async def test_a_service_whose_rooms_are_all_turned_off_books_nothing_new(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    (room,) = await _rooms(db, "Room 1", active=False)
    item = await _service(db, [room])
    refused = await _book(as_owner, db, item, DIEGO, TEN)
    assert refused.status_code == 409 and refused.json()["error"] == "no_resource"
    params = {"item_id": item, "staff_id": OWNER, "date": DAY}
    assert _starts(ok(await as_owner.get(f"/book/{SLUG}/slots", params=params))) == set()
