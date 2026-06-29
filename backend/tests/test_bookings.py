from datetime import UTC, date, datetime, time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.scheduling import Availability, Session
from tests.conftest import BIZ, Factory

ST_OWNER = "st_owner"
ST_PRIYA = "st_priya"  # seeded staff with no availability rows → unconfigured


async def _client_and_item(db: AsyncSession) -> tuple[str, str]:
    client_id = (await db.execute(select(Client.id).limit(1))).scalars().first()
    item_id = (
        (
            await db.execute(
                select(Item.id)
                .where(Item.kind == "service", Item.duration_min.isnot(None))
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    assert client_id and item_id
    return client_id, item_id


def _body(client_id: str, item_id: str, starts: str, staff: str = ST_OWNER) -> dict[str, str]:
    return {"client_id": client_id, "item_id": item_id, "staff_id": staff, "starts_at": starts}


async def test_create_booking(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-01T10:00:00Z")
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "confirmed"
    assert body["staff_id"] == ST_OWNER
    assert body["ends_at"] > body["starts_at"]


async def test_double_book_conflicts(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-02T10:00:00Z")
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 409


async def test_cancel_frees_the_slot(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-03T10:00:00Z")
    bid = (await as_owner.post("/v1/bookings", json=body)).json()["id"]
    canceled = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201


async def test_reschedule_moves_session(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    created = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-04T10:00:00Z")
    )
    bid = created.json()["id"]
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-03-04T14:00:00Z"})
    assert moved.status_code == 200
    assert moved.json()["starts_at"].startswith("2027-03-04T14:00")


async def test_staff_cannot_book_another_staff(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_staff.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-05T10:00:00Z", ST_OWNER)
    )
    assert res.status_code == 403


async def test_unauth_cannot_book(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await unauth.post("/v1/bookings", json=_body(client_id, item_id, "2027-03-06T10:00:00Z"))
    assert res.status_code == 401


async def test_unknown_client_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    _, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body("cl_nope", item_id, "2027-03-07T10:00:00Z")
    )
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-08T10:00:00Z")
    headers = {"Idempotency-Key": "bk-test-1"}
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    second = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_nope", "2027-04-04T10:00:00Z")
    )
    assert res.status_code == 404


async def test_unknown_staff_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-04-05T10:00:00Z", "st_nope")
    )
    assert res.status_code == 404


async def test_cannot_book_another_business_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    foreign = await factory.client(business=other)
    await db.flush()
    _, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(foreign.id, item_id, "2027-04-03T10:00:00Z")
    )
    assert res.status_code == 404


async def test_reschedule_into_conflict_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-04-01T10:00:00Z")
    )
    await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-01T14:00:00Z"))
    moved = await as_owner.patch(
        f"/v1/bookings/{first.json()['id']}", json={"starts_at": "2027-04-01T14:00:00Z"}
    )
    assert moved.status_code == 409


async def test_double_cancel_is_idempotent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    bid = (
        await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-04-02T10:00:00Z"))
    ).json()["id"]
    first = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    second = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "canceled"


async def test_zero_duration_item_is_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    product = Item(
        id=new_id("item"),
        business_id="bz_birchbark",
        kind="product",
        name="Shampoo",
        price_cents=1500,
        currency="CAD",
        duration_min=None,
    )
    db.add(product)
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, product.id, "2027-04-06T10:00:00Z")
    )
    assert res.status_code == 422


async def test_inactive_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    retired = Item(
        id=new_id("item"),
        business_id="bz_birchbark",
        kind="service",
        name="Retired Service",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
        active=False,
    )
    db.add(retired)
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, retired.id, "2027-05-01T10:00:00Z")
    )
    assert res.status_code == 404


async def test_cannot_modify_terminal_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    bid = (
        await as_owner.post("/v1/bookings", json=_body(client_id, item_id, "2027-05-02T10:00:00Z"))
    ).json()["id"]
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-05-02T14:00:00Z"})
    assert moved.status_code == 409


async def test_patch_unknown_booking_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch("/v1/bookings/bk_nope", json={"status": "canceled"})
    assert res.status_code == 404


async def test_booking_within_buffer_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # it_groom_sm is a 75-min service with a seeded 10-min after-buffer.
    client_id, _ = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert first.status_code == 201
    # 11:15 butts against the prior booking inside its 10-min after-buffer.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T11:15:00Z")
    )
    assert second.status_code == 409


async def test_booking_outside_buffer_ok(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, _ = await _client_and_item(db)
    first = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert first.status_code == 201
    # 11:25 clears the 10-min buffer after the 11:15 end.
    second = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T11:25:00Z")
    )
    assert second.status_code == 201


async def test_unconfigured_availability_allows_any_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # st_priya has no availability rows → unconfigured → even an off-hours slot is allowed.
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T20:00:00Z", ST_PRIYA)
    )
    assert res.status_code == 201


async def test_booking_within_window_ok_outside_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    db.add(
        Availability(
            id=new_id("availability"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            type="date",
            date=date(2027, 9, 15),
            start_time=time(9, 0),
            end_time=time(17, 0),
            is_available=True,
        )
    )
    await db.flush()
    inside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T12:00:00Z", ST_PRIYA)
    )
    assert inside.status_code == 201
    outside = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-15T20:00:00Z", ST_PRIYA)
    )
    assert outside.status_code == 409


async def test_availability_closure_blocks_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    db.add(
        Availability(
            id=new_id("availability"),
            business_id=BIZ,
            staff_id=ST_PRIYA,
            type="date",
            date=date(2027, 9, 16),
            is_available=False,  # all-day closure
        )
    )
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-09-16T12:00:00Z", ST_PRIYA)
    )
    assert res.status_code == 409


async def test_class_bookings_share_session_until_full(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, _ = await _client_and_item(db)
    cls = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="class",
        name="Puppy Playgroup",
        price_cents=3000,
        currency="CAD",
        duration_min=60,
        capacity=2,
    )
    db.add(cls)
    await db.flush()
    body = _body(client_id, cls.id, "2027-03-02T10:00:00Z", ST_PRIYA)
    first = await as_owner.post("/v1/bookings", json=body)
    second = await as_owner.post("/v1/bookings", json=body)
    third = await as_owner.post("/v1/bookings", json=body)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["session_id"] == second.json()["session_id"]  # one shared session
    assert third.status_code == 409  # capacity 2 exhausted
    sess = (
        await db.execute(select(Session).where(Session.id == first.json()["session_id"]))
    ).scalar_one()
    assert sess.capacity == 2
    assert sess.booked_count == 2


async def test_non_class_item_mints_single_capacity_session(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-02T09:00:00Z")
    )
    assert res.status_code == 201
    sess = (
        await db.execute(select(Session).where(Session.id == res.json()["session_id"]))
    ).scalar_one()
    assert sess.capacity == 1
    assert sess.booked_count == 1


async def test_foreign_business_session_does_not_block(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    client_id, _ = await _client_and_item(db)
    other = await factory.business(name="Rival Co")
    other_user = await factory.user()
    other_staff = await factory.staff(business=other, user=other_user, role="owner")
    other_item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=75,
    )
    db.add(other_item)
    await db.flush()
    db.add(
        Session(
            id=new_id("session"),
            business_id=other.id,
            item_id=other_item.id,
            staff_id=other_staff.id,
            starts_at=datetime(2027, 3, 2, 10, 0, tzinfo=UTC),
            ends_at=datetime(2027, 3, 2, 11, 15, tzinfo=UTC),
            capacity=1,
            booked_count=1,
            status="scheduled",
        )
    )
    await db.flush()
    # our owner books the same slot; the cross-tenant session must not block (scoped by business).
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, "it_groom_sm", "2027-03-02T10:00:00Z")
    )
    assert res.status_code == 201
