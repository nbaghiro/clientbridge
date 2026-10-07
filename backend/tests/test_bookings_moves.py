from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Note
from clientbridge.models.scheduling import Addon, Booking, Slot
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import client_id

ST_OWNER = "st_owner"
ST_DIEGO = "st_diego"
ST_PRIYA = "st_priya"


async def _service(db: AsyncSession) -> str:
    item = (
        (
            await db.execute(
                select(Item.id).where(
                    Item.business_id == BIZ, Item.kind == "service", Item.duration_min == 60
                )
            )
        )
        .scalars()
        .first()
    )
    assert item is not None
    return item


async def _book(
    api: httpx.AsyncClient, db: AsyncSession, staff: str, starts: str, **extra: object
) -> str:
    res = await api.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": await _service(db),
            "staff_id": staff,
            "starts_at": starts,
            **extra,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


async def _slot(db: AsyncSession, booking_id: str) -> Slot:
    row = (
        await db.execute(
            select(Slot)
            .join(Booking, Booking.slot_id == Slot.id)
            .where(Booking.id == booking_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return row


async def test_move_to_another_member_and_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    db.add(
        Addon(
            id=new_id("addon"),
            business_id=BIZ,
            booking_id=bid,
            staff_id=ST_PRIYA,
            item_id=await _service(db),
            description="Shampoo",
            quantity=1,
            unit_amount_cents=1200,
        )
    )
    await db.flush()
    res = await as_owner.patch(
        f"/v1/bookings/{bid}", json={"starts_at": "2027-03-01T20:00:00Z", "staff_id": ST_OWNER}
    )
    assert res.status_code == 200, res.text
    assert res.json()["staff_id"] == ST_OWNER
    slot = await _slot(db, bid)
    assert slot.staff_id == ST_OWNER
    assert slot.starts_at == datetime(2027, 3, 1, 20, tzinfo=UTC)
    assert slot.ends_at == datetime(2027, 3, 1, 21, tzinfo=UTC)
    addon = (
        await db.execute(
            select(Addon.staff_id)
            .where(Addon.booking_id == bid)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert addon == ST_OWNER


async def test_resize_changes_only_the_end(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"ends_at": "2027-03-01T19:30:00Z"})
    assert res.status_code == 200, res.text
    slot = await _slot(db, bid)
    assert slot.starts_at == datetime(2027, 3, 1, 18, tzinfo=UTC)
    assert slot.ends_at == datetime(2027, 3, 1, 19, 30, tzinfo=UTC)


async def test_check_answers_without_writing(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    await _book(as_owner, db, ST_OWNER, "2027-03-01T20:00:00Z")
    free = await as_owner.post(
        f"/v1/bookings/{bid}/check", json={"starts_at": "2027-03-01T22:00:00Z"}
    )
    assert free.json() == {"ok": True, "problem": None, "reason": None, "message": None}
    clash = await as_owner.post(
        f"/v1/bookings/{bid}/check",
        json={"starts_at": "2027-03-01T20:00:00Z", "staff_id": ST_OWNER},
    )
    assert clash.json()["problem"] == "overlap"
    past = await as_owner.post(
        f"/v1/bookings/{bid}/check", json={"starts_at": "2020-03-01T20:00:00Z"}
    )
    assert past.json()["problem"] == "past"
    same = await as_owner.post(f"/v1/bookings/{bid}/check", json={})
    assert same.json()["ok"] is True
    slot = await _slot(db, bid)
    assert slot.starts_at == datetime(2027, 3, 1, 18, tzinfo=UTC)
    assert slot.staff_id == ST_PRIYA


async def test_check_names_the_time_off(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    await as_owner.post(
        "/v1/time-off",
        json={
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-01T17:00:00Z",
            "ends_at": "2027-03-01T23:00:00Z",
            "reason": "Dentist",
        },
    )
    res = await as_owner.post(f"/v1/bookings/{bid}/check", json={"staff_id": ST_OWNER})
    assert res.json()["problem"] == "time_off"
    assert res.json()["reason"] == "Dentist"
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"staff_id": ST_OWNER})
    assert moved.status_code == 409


async def test_probe_checks_a_new_visit(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    body = {"item_id": await _service(db), "staff_id": ST_PRIYA}
    busy = await as_owner.post(
        "/v1/bookings/check", json={**body, "starts_at": "2027-03-01T18:30:00Z"}
    )
    assert busy.json()["problem"] == "overlap"
    free = await as_owner.post(
        "/v1/bookings/check", json={**body, "starts_at": "2027-03-01T21:00:00Z"}
    )
    assert free.json()["ok"] is True
    past = await as_owner.post(
        "/v1/bookings/check", json={**body, "starts_at": "2020-03-01T21:00:00Z"}
    )
    assert past.json()["problem"] == "past"


async def test_move_onto_another_visit_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    await _book(as_owner, db, ST_OWNER, "2027-03-01T20:00:00Z")
    res = await as_owner.patch(
        f"/v1/bookings/{bid}", json={"starts_at": "2027-03-01T20:30:00Z", "staff_id": ST_OWNER}
    )
    assert res.status_code == 409
    assert (await _slot(db, bid)).staff_id == ST_PRIYA


async def test_move_into_the_past_is_refused(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2020-03-01T18:00:00Z"})
    assert res.status_code == 409


async def test_resize_below_five_minutes_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"ends_at": "2027-03-01T18:02:00Z"})
    assert res.status_code == 422


async def test_staff_cannot_hand_a_visit_to_someone_else(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _book(as_staff, db, ST_DIEGO, "2027-03-03T18:00:00Z")
    res = await as_staff.patch(f"/v1/bookings/{bid}", json={"staff_id": ST_OWNER})
    assert res.status_code == 403
    check = await as_staff.post(f"/v1/bookings/{bid}/check", json={"staff_id": ST_OWNER})
    assert check.status_code == 403
    assert (await _slot(db, bid)).staff_id == ST_DIEGO


async def test_staff_cannot_check_another_members_visit(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=await _service(db),
        staff_id=ST_OWNER,
        starts_at=datetime(2027, 3, 3, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, 3, 19, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    bid = new_id("booking")
    db.add(
        Booking(
            id=bid,
            business_id=BIZ,
            slot_id=slot.id,
            staff_id=ST_OWNER,
            client_id=await client_id(db),
            status="confirmed",
            source="manual",
        )
    )
    await db.flush()
    res = await as_staff.post(
        f"/v1/bookings/{bid}/check", json={"starts_at": "2027-03-03T20:00:00Z"}
    )
    assert res.status_code == 403
    probe = await as_staff.post(
        "/v1/bookings/check",
        json={
            "item_id": await _service(db),
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-03T20:00:00Z",
        },
    )
    assert probe.status_code == 403


async def test_unauth_cannot_check(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/bookings/bk_x/check", json={})
    assert res.status_code == 401


async def test_unknown_member_or_room_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    assert (
        await as_owner.patch(f"/v1/bookings/{bid}", json={"staff_id": "st_missing"})
    ).status_code == 404
    assert (
        await as_owner.patch(f"/v1/bookings/{bid}", json={"resource_id": "rs_missing"})
    ).status_code == 404
    assert (await as_owner.post("/v1/bookings/bk_missing/check", json={})).status_code == 404


async def test_closed_visit_cannot_be_moved_or_checked(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "completed"})
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"ends_at": "2027-03-01T19:30:00Z"})
    assert res.status_code == 409
    check = await as_owner.post(
        f"/v1/bookings/{bid}/check", json={"starts_at": "2027-03-02T18:00:00Z"}
    )
    assert check.status_code == 409


async def test_room_clash_is_refused(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _book(as_owner, db, ST_OWNER, "2027-03-01T18:00:00Z", resource_id="rs_bath")
    bid = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    check = await as_owner.post(f"/v1/bookings/{bid}/check", json={"resource_id": "rs_bath"})
    assert check.json()["problem"] == "resource"
    res = await as_owner.patch(f"/v1/bookings/{bid}", json={"resource_id": "rs_bath"})
    assert res.status_code == 409
    ok = await as_owner.patch(f"/v1/bookings/{bid}", json={"resource_id": "rs_station_b"})
    assert ok.status_code == 200
    assert (await _slot(db, bid)).resource_id == "rs_station_b"
    cleared = await as_owner.patch(f"/v1/bookings/{bid}", json={"resource_id": None})
    assert cleared.status_code == 200
    assert (await _slot(db, bid)).resource_id is None


async def test_class_session_is_not_handed_to_another_member(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id=ST_OWNER,
        starts_at=datetime(2027, 3, 6, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, 6, 19, tzinfo=UTC),
        capacity=6,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        staff_id=ST_OWNER,
        client_id=await client_id(db),
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    check = await as_owner.post(f"/v1/bookings/{booking.id}/check", json={"staff_id": ST_PRIYA})
    assert check.json()["problem"] == "class"
    res = await as_owner.patch(f"/v1/bookings/{booking.id}", json={"staff_id": ST_PRIYA})
    assert res.status_code == 409


async def test_another_business_visit_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=owner.id,
        starts_at=datetime(2027, 8, 4, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 4, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        staff_id=owner.id,
        client_id=client.id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(f"/v1/bookings/{booking.id}/check", json={"staff_id": ST_OWNER})
    assert res.status_code == 404
    moved = await as_owner.patch(f"/v1/bookings/{booking.id}", json={"staff_id": ST_OWNER})
    assert moved.status_code == 404
    mine = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    handed = await as_owner.patch(f"/v1/bookings/{mine}", json={"staff_id": owner.id})
    assert handed.status_code == 404


async def test_note_is_kept_and_confirmation_can_be_skipped(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender
) -> None:
    bid = await _book(
        as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z", note="  Nervous with dryers ", notify=False
    )
    note = (
        await db.execute(select(Note).where(Note.parent_type == "booking", Note.parent_id == bid))
    ).scalar_one()
    assert note.body == "Nervous with dryers"
    assert email.sent == [] and sms.sent == []
    await _book(as_owner, db, ST_PRIYA, "2027-03-01T22:00:00Z", note="  ")
    notes = await db.execute(select(Note.id).where(Note.parent_type == "booking"))
    assert len(notes.scalars().all()) == 1
