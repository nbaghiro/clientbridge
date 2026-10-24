from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import key

SLUG = "birchbark"
ST_OWNER = "st_owner"
ST_DIEGO = "st_diego"
ST_PRIYA = "st_priya"
CL_AMELIE = "cl_amelie"
MONDAY = "2027-03-01T18:00:00Z"
TUESDAY = "2027-03-02T18:00:00Z"
WEDNESDAY = "2027-03-03T18:00:00Z"


async def _service(db: AsyncSession, *staff: str, kind: str = "service") -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind=kind,
        name="Hand scissor",
        price_cents=9000,
        currency="CAD",
        duration_min=60,
        online_bookable=True,
        staff_ids=sorted(staff),
    )
    db.add(item)
    await db.flush()
    return item.id


async def _book(api: httpx.AsyncClient, item: str, staff: str, starts: str) -> httpx.Response:
    return await api.post(
        "/v1/bookings",
        json={
            "client_id": CL_AMELIE,
            "item_id": item,
            "staff_id": staff,
            "starts_at": starts,
            "notify": False,
        },
    )


def _public(item: str, staff: str, starts: str) -> dict[str, object]:
    return {
        "item_id": item,
        "staff_id": staff,
        "starts_at": starts,
        "client": {"name": "Web Booker", "email": "web-staff@example.com"},
    }


async def _slot_staff(db: AsyncSession, booking_id: str) -> str:
    row = await db.scalar(
        select(Slot.staff_id)
        .join(Booking, Booking.slot_id == Slot.id)
        .where(Booking.id == booking_id)
        .execution_options(populate_existing=True)
    )
    assert row is not None
    return row


async def test_owner_names_who_offers_a_service_and_connect_lists_only_them(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(
        "/v1/items",
        json={
            "kind": "service",
            "name": "Colour",
            "price_cents": 12000,
            "duration_min": 90,
            "staff_ids": [ST_PRIYA, ST_DIEGO, ST_PRIYA],
        },
    )
    assert res.status_code == 201, res.text
    item_id = res.json()["id"]
    assert res.json()["staff_ids"] == [ST_DIEGO, ST_PRIYA]
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    colour = next(s for s in page["services"] if s["id"] == item_id)
    assert colour["staff_ids"] == [ST_DIEGO, ST_PRIYA]
    everyone = {s["id"] for s in page["staff"]}
    assert ST_OWNER in everyone

    cleared = await as_owner.patch(f"/v1/items/{item_id}", json={"staff_ids": []})
    assert cleared.status_code == 200 and cleared.json()["staff_ids"] == []
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    colour = next(s for s in page["services"] if s["id"] == item_id)
    assert set(colour["staff_ids"]) == everyone


async def test_a_listed_member_books_the_service_on_both_sides(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_DIEGO)
    staff = await _book(as_owner, item, ST_DIEGO, TUESDAY)
    assert staff.status_code == 201, staff.text
    online = await as_owner.post(f"/book/{SLUG}", json=_public(item, "any", WEDNESDAY))
    assert online.status_code == 200, online.text
    booking = await db.get(Booking, online.json()["booking_id"])
    assert booking is not None and booking.staff_id == ST_DIEGO


async def test_unknown_removed_and_foreign_members_are_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    foreign = await factory.staff(business=other)
    gone = await factory.staff(business=await _birchbark(db), role="staff")
    gone.status = "removed"
    await db.flush()
    for staff_id in ("st_nope", foreign.id, gone.id):
        res = await as_owner.post(
            "/v1/items",
            json={"kind": "service", "name": "X", "duration_min": 30, "staff_ids": [staff_id]},
        )
        assert res.status_code == 404, staff_id
    assert await db.scalar(select(Item.id).where(Item.name == "X")) is None


async def test_only_services_and_classes_name_their_staff(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items", json={"kind": "product", "name": "Shampoo", "staff_ids": [ST_PRIYA]}
    )
    assert res.status_code == 422
    made = await as_owner.post(
        "/v1/items",
        json={"kind": "class", "name": "Puppy class", "duration_min": 60, "capacity": 6},
    )
    patched = await as_owner.patch(f"/v1/items/{made.json()['id']}", json={"staff_ids": [ST_OWNER]})
    assert patched.status_code == 200 and patched.json()["staff_ids"] == [ST_OWNER]
    to_product = await as_owner.patch(f"/v1/items/{made.json()['id']}", json={"kind": "product"})
    assert to_product.status_code == 422


async def test_staff_cannot_change_who_offers_a_service(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_PRIYA)
    res = await as_staff.patch(f"/v1/items/{item}", json={"staff_ids": [ST_DIEGO]})
    assert res.status_code == 403
    row = await db.get(Item, item, populate_existing=True)
    assert row is not None and row.staff_ids == [ST_PRIYA]


async def test_staff_booking_with_a_member_who_does_not_offer_it_is_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_PRIYA)
    res = await _book(as_owner, item, ST_OWNER, TUESDAY)
    assert res.status_code == 422
    assert res.json()["error"] == "service_not_offered"
    series = await as_owner.post(
        "/v1/recurrences",
        json={
            "client_id": CL_AMELIE,
            "item_id": item,
            "staff_id": ST_OWNER,
            "starts_at": TUESDAY,
            "frequency": "week",
            "interval": 1,
            "count": 2,
            "confirmation": "none",
        },
    )
    assert series.status_code == 422 and series.json()["error"] == "service_not_offered"
    assert await db.scalar(select(Slot.id).where(Slot.item_id == item)) is None


async def test_connect_refuses_and_hides_a_member_who_does_not_offer_it(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_DIEGO)
    params = {"item_id": item, "staff_id": ST_OWNER, "date": "2027-03-02"}
    slots = await api.get(f"/book/{SLUG}/slots", params=params)
    assert slots.status_code == 422 and slots.json()["error"] == "service_not_offered"
    days = await api.get(
        f"/book/{SLUG}/days",
        params={"item_id": item, "staff_id": ST_OWNER, "from": "2027-03-02", "days": 3},
    )
    assert days.status_code == 422
    anyone = await api.get(f"/book/{SLUG}/slots", params={**params, "staff_id": "any"})
    assert anyone.status_code == 200
    assert {s["staff_id"] for s in anyone.json()["slots"]} == {ST_DIEGO}
    openings = await api.get(f"/book/{SLUG}/next-openings", params={"item_ids": [item]})
    assert openings.status_code == 200, openings.text
    found = {s["staff_id"] for x in openings.json()["services"] for s in x["slots"]}
    assert found == {ST_DIEGO}
    book = await api.post(f"/book/{SLUG}", json=_public(item, ST_OWNER, TUESDAY))
    assert book.status_code == 422 and book.json()["error"] == "service_not_offered"


async def test_any_staff_never_lands_on_a_member_who_does_not_offer_it(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_DIEGO)
    await _book_direct(db, item, ST_DIEGO, TUESDAY)
    res = await api.post(f"/book/{SLUG}", json=_public(item, "any", TUESDAY))
    assert res.status_code == 409, res.text  # the owner is free then, but doesn't offer it
    assert res.json()["error"] == "slot_unavailable"


async def test_moving_a_visit_to_a_member_who_does_not_offer_it_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_PRIYA)
    booked = await _book(as_owner, item, ST_PRIYA, MONDAY)
    bid = booked.json()["id"]
    check = await as_owner.post(f"/v1/bookings/{bid}/check", json={"staff_id": ST_OWNER})
    assert check.json()["problem"] == "not_offered"
    moved = await as_owner.patch(
        f"/v1/bookings/{bid}", json={"staff_id": ST_OWNER, "starts_at": TUESDAY}
    )
    assert moved.status_code == 422 and moved.json()["error"] == "service_not_offered"
    assert await _slot_staff(db, bid) == ST_PRIYA


async def test_a_series_cannot_move_to_a_member_who_does_not_offer_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_PRIYA)
    series = await as_owner.post(
        "/v1/recurrences",
        json={
            "client_id": CL_AMELIE,
            "item_id": item,
            "staff_id": ST_PRIYA,
            "starts_at": MONDAY,
            "frequency": "week",
            "interval": 1,
            "count": 2,
            "confirmation": "none",
        },
    )
    assert series.status_code == 201, series.text
    rid = series.json()["id"]
    res = await as_owner.patch(
        f"/v1/recurrences/{rid}", json={"scope": "all", "staff_id": ST_OWNER}
    )
    assert res.status_code == 422 and res.json()["error"] == "service_not_offered"


async def test_removing_a_member_hands_visits_only_to_someone_who_offers_them(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    business = await _birchbark(db)
    first = await factory.staff(business=business, role="staff")
    second = await factory.staff(business=business, role="staff")
    item = await _service(db, first.id, second.id, ST_DIEGO)
    kept = (await _book(as_owner, item, first.id, TUESDAY)).json()["id"]
    named = await as_owner.post(
        f"/v1/staff/{first.id}/remove", json={"future": "reassign", "reassign_to": ST_OWNER}
    )
    assert named.status_code == 200, named.text
    assert named.json()["moved"] == []
    assert named.json()["left"][0]["problem"] == "not_offered"
    assert await _slot_staff(db, kept) == first.id
    moved = (await _book(as_owner, item, second.id, TUESDAY)).json()["id"]
    anyone = await as_owner.post(
        f"/v1/staff/{second.id}/remove", json={"future": "reassign", "reassign_to": "any"}
    )
    assert anyone.status_code == 200, anyone.text
    assert anyone.json()["moved"] == [moved]
    assert await _slot_staff(db, moved) == ST_DIEGO


async def test_a_member_removed_later_stays_listed_and_the_item_still_saves(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    member = await factory.staff(business=await _birchbark(db), role="staff")
    item = await _service(db, member.id, ST_PRIYA)
    member.status = "removed"
    await db.flush()
    res = await as_owner.patch(f"/v1/items/{item}", json={"name": "Hand scissor, long coat"})
    assert res.status_code == 200, res.text
    assert res.json()["staff_ids"] == sorted([member.id, ST_PRIYA])
    page = (await as_owner.get(f"/book/{SLUG}/services")).json()
    listed = next(s for s in page["services"] if s["id"] == item)
    assert listed["staff_ids"] == [ST_PRIYA]
    again = await as_owner.patch(f"/v1/items/{item}", json={"staff_ids": [ST_PRIYA, ST_PRIYA]})
    assert again.json()["staff_ids"] == [ST_PRIYA]


async def test_a_visit_kept_by_a_member_who_no_longer_offers_it_can_still_be_resized(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db)
    bid = (await _book(as_owner, item, ST_OWNER, TUESDAY)).json()["id"]
    row = await db.get(Item, item)
    assert row is not None
    row.staff_ids = [ST_PRIYA]
    await db.flush()
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"ends_at": "2027-03-02T19:30:00Z"})
    assert res.status_code == 200, res.text
    assert await _slot_staff(db, bid) == ST_OWNER


async def test_a_replayed_booking_returns_the_first_answer(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    item = await _service(db, ST_PRIYA)
    headers = key()
    body = {
        "client_id": CL_AMELIE,
        "item_id": item,
        "staff_id": ST_PRIYA,
        "starts_at": MONDAY,
        "notify": False,
    }
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201, first.text
    row = await db.get(Item, item)
    assert row is not None
    row.staff_ids = [ST_DIEGO]
    await db.flush()
    again = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    refused = await as_owner.post("/v1/bookings", json=body, headers=key())
    assert refused.status_code == 422


async def _birchbark(db: AsyncSession) -> Business:
    business = await db.get(Business, BIZ)
    assert business is not None
    return business


async def _book_direct(db: AsyncSession, item: str, staff: str, starts: str) -> str:
    at = datetime.fromisoformat(starts.replace("Z", "+00:00")).astimezone(UTC)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item,
        staff_id=staff,
        starts_at=at,
        ends_at=at + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=at,
        staff_id=staff,
        client_id=CL_AMELIE,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking.id
