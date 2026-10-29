from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.bookings import booked_count, run_reminders
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    Factory,
    FakeEmailSender,
    FakePushSender,
    FakeSmsSender,
)
from tests.helpers import begin, queued_subjects, replied_stop

CLIENTS = ["cl_amelie", "cl_marcus", "cl_yuki", "cl_liam"]


async def _class(
    db: AsyncSession,
    *,
    staff: str = "st_owner",
    capacity: int = 2,
    day: int = 6,
    year: int = 2027,
    business_id: str = BIZ,
    item_id: str = "it_puppy",
) -> str:
    slot = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item_id,
        staff_id=staff,
        starts_at=datetime(year, 3, day, 18, tzinfo=UTC),
        ends_at=datetime(year, 3, day, 19, tzinfo=UTC),
        capacity=capacity,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    return slot.id


async def _add(api: httpx.AsyncClient, slot_id: str, client: str) -> dict[str, object]:
    res = await api.post(f"/v1/classes/{slot_id}/roster", json={"client_id": client})
    assert res.status_code == 201, res.text
    body: dict[str, object] = res.json()
    return body


async def test_full_class_puts_the_next_client_on_the_waitlist(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db)
    assert (await _add(as_owner, sid, CLIENTS[0]))["status"] == "confirmed"
    assert (await _add(as_owner, sid, CLIENTS[1]))["status"] == "confirmed"
    third = await _add(as_owner, sid, CLIENTS[2])
    fourth = await _add(as_owner, sid, CLIENTS[3])
    assert third["status"] == "waitlisted" and third["waitlist_position"] == 1
    assert fourth["waitlist_position"] == 2
    assert await booked_count(db, sid) == 2


async def test_check_in_undo_and_no_show(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    sid = await _class(db)
    bid = (await _add(as_owner, sid, CLIENTS[0]))["booking_id"]
    url = f"/v1/classes/{sid}/roster/{bid}"
    here = await as_owner.patch(url, json={"action": "check_in"})
    assert here.json()["checked_in_at"] is not None
    undone = await as_owner.patch(url, json={"action": "undo"})
    assert undone.json()["checked_in_at"] is None
    await begin(db, str(bid))
    missed = await as_owner.patch(url, json={"action": "no_show"})
    assert missed.json()["status"] == "no_show"
    back = await as_owner.patch(url, json={"action": "undo"})
    assert back.json()["status"] == "confirmed"
    nothing = await as_owner.patch(url, json={"action": "undo"})
    assert nothing.status_code == 409


async def test_promote_gives_an_open_seat_and_tells_the_client(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    waiting = (await _add(as_owner, sid, CLIENTS[2]))["booking_id"]
    full = await as_owner.patch(f"/v1/classes/{sid}/roster/{waiting}", json={"action": "promote"})
    assert full.status_code == 409 and full.json()["error"] == "class_full"
    slot = await db.get(Slot, sid)
    assert slot is not None
    slot.capacity = 3
    await db.flush()
    res = await as_owner.patch(f"/v1/classes/{sid}/roster/{waiting}", json={"action": "promote"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed"
    [notice] = await queued_subjects(db, f"seat:{sid}:{waiting}")
    assert notice.startswith("A seat opened up in Puppy Socialization (group) with")
    assert "so you're booked" in notice
    booking = await db.get(Booking, str(waiting), populate_existing=True)
    assert booking is not None and booking.manage_token is not None


async def test_waitlisted_clients_get_no_reminder(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=2)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    waiting = (await _add(as_owner, sid, CLIENTS[2]))["booking_id"]
    email, sms, push = FakeEmailSender(), FakeSmsSender(), FakePushSender()
    await run_reminders(db, Notifier(email, sms, push), datetime(2027, 3, 6, 6, tzinfo=UTC))
    row = await db.get(Booking, str(waiting), populate_existing=True)
    assert row is not None and row.reminded_at is None


async def test_message_goes_to_everyone_booked(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=2)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    await _add(as_owner, sid, CLIENTS[2])
    res = await as_owner.post(f"/v1/classes/{sid}/message", json={"body": "Bring a toy"})
    assert res.status_code == 200, res.text
    assert res.json()["sent"] == 2
    rows = await db.execute(select(Message.id).where(Message.body == "Bring a toy"))
    assert len(rows.scalars().all()) == 2


async def test_message_skips_and_does_not_count_a_client_who_replied_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=2)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    await replied_stop(db, CLIENTS[1])
    res = await as_owner.post(f"/v1/classes/{sid}/message", json={"body": "Bring a toy"})
    assert res.status_code == 200, res.text
    assert res.json()["sent"] == 1
    rows = await db.execute(
        select(Thread.client_id)
        .join(Message, Message.thread_id == Thread.id)
        .where(Message.body == "Bring a toy")
    )
    assert rows.scalars().all() == [CLIENTS[0]]


async def test_message_texts_a_shared_number_once_and_counts_everyone_on_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=2)
    await db.execute(update(Client).where(Client.id == CLIENTS[1]).values(phone="+12505550180"))
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    res = await as_owner.post(f"/v1/classes/{sid}/message", json={"body": "Bring a toy"})
    assert res.status_code == 200, res.text
    assert res.json()["sent"] == 2
    rows = await db.execute(
        select(Thread.client_id)
        .join(Message, Message.thread_id == Thread.id)
        .where(Message.body == "Bring a toy")
    )
    assert rows.scalars().all() == [min(CLIENTS[0], CLIENTS[1])]


async def test_a_repeated_class_message_texts_each_client_once(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=2)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    headers = {"Idempotency-Key": "class-msg-1"}
    url = f"/v1/classes/{sid}/message"
    first = await as_owner.post(url, json={"body": "Bring a toy"}, headers=headers)
    second = await as_owner.post(url, json={"body": "Bring a toy"}, headers=headers)
    assert first.json() == second.json() == {"sent": 2}
    rows = await db.execute(select(Message.id).where(Message.body == "Bring a toy"))
    assert len(rows.scalars().all()) == 2


async def test_a_class_message_key_reused_on_another_class_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    first = await _class(db, capacity=2)
    second = await _class(db, capacity=2, day=7)
    await _add(as_owner, first, CLIENTS[0])
    await _add(as_owner, second, CLIENTS[1])
    headers = {"Idempotency-Key": "class-msg-2"}
    sent = await as_owner.post(f"/v1/classes/{first}/message", json={"body": "Hi"}, headers=headers)
    assert sent.status_code == 200, sent.text
    other = await as_owner.post(
        f"/v1/classes/{second}/message", json={"body": "Hi"}, headers=headers
    )
    assert other.status_code == 422 and other.json()["error"] == "idempotency_key_reused"


@pytest.mark.parametrize("body", ["", "   ", "x" * 1001])
async def test_an_empty_or_oversized_class_message_is_422(
    as_owner: httpx.AsyncClient, db: AsyncSession, body: str
) -> None:
    sid = await _class(db, capacity=2)
    await _add(as_owner, sid, CLIENTS[0])
    res = await as_owner.post(f"/v1/classes/{sid}/message", json={"body": body})
    assert res.status_code == 422
    assert (await db.execute(select(Message.id).where(Message.body == body))).first() is None


async def test_client_already_on_the_roster_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db)
    await _add(as_owner, sid, CLIENTS[0])
    again = await as_owner.post(f"/v1/classes/{sid}/roster", json={"client_id": CLIENTS[0]})
    assert again.status_code == 409


async def test_not_a_class_or_wrong_states_are_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    single = await _class(db, capacity=1)
    res = await as_owner.post(f"/v1/classes/{single}/roster", json={"client_id": CLIENTS[0]})
    assert res.status_code == 409
    sid = await _class(db, capacity=2, day=7)
    await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    waiting = (await _add(as_owner, sid, CLIENTS[2]))["booking_id"]
    url = f"/v1/classes/{sid}/roster/{waiting}"
    assert (await as_owner.patch(url, json={"action": "check_in"})).status_code == 409
    assert (await as_owner.patch(url, json={"action": "no_show"})).status_code == 409
    confirmed = (
        (
            await db.execute(
                select(Booking.id).where(Booking.slot_id == sid, Booking.status == "confirmed")
            )
        )
        .scalars()
        .first()
    )
    promote = await as_owner.patch(
        f"/v1/classes/{sid}/roster/{confirmed}", json={"action": "promote"}
    )
    assert promote.status_code == 409
    bad = await as_owner.patch(url, json={"action": "dance"})
    assert bad.status_code == 422


async def test_pet_must_belong_to_the_client(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    sid = await _class(db)
    res = await as_owner.post(
        f"/v1/classes/{sid}/roster", json={"client_id": "cl_amelie", "subject_id": "sj_rex"}
    )
    assert res.status_code == 404
    ok = await as_owner.post(
        f"/v1/classes/{sid}/roster", json={"client_id": "cl_amelie", "subject_id": "sj_bella"}
    )
    assert ok.status_code == 201


async def test_staff_runs_only_their_own_classes(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    mine = await _class(db, staff="st_diego")
    assert (await _add(as_staff, mine, CLIENTS[0]))["status"] == "confirmed"
    theirs = await _class(db, staff="st_owner", day=7)
    res = await as_staff.post(f"/v1/classes/{theirs}/roster", json={"client_id": CLIENTS[0]})
    assert res.status_code == 403
    msg = await as_staff.post(f"/v1/classes/{theirs}/message", json={"body": "hi"})
    assert msg.status_code == 403


async def test_unknown_and_other_business_class_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    assert (
        await as_owner.post("/v1/classes/ses_missing/roster", json={"client_id": CLIENTS[0]})
    ).status_code == 404
    sid = await _class(db)
    assert (
        await as_owner.patch(f"/v1/classes/{sid}/roster/bk_missing", json={"action": "undo"})
    ).status_code == 404
    other = await factory.business(name="Rival Co")
    rival_client = await factory.client(business=other)
    res = await as_owner.post(f"/v1/classes/{sid}/roster", json={"client_id": rival_client.id})
    assert res.status_code == 404


async def test_check_in_twice_keeps_the_first_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db)
    bid = (await _add(as_owner, sid, CLIENTS[0]))["booking_id"]
    url = f"/v1/classes/{sid}/roster/{bid}"
    first = (await as_owner.patch(url, json={"action": "check_in"})).json()["checked_in_at"]
    again = (await as_owner.patch(url, json={"action": "check_in"})).json()["checked_in_at"]
    assert first == again


async def _rival_class(db: AsyncSession, factory: Factory) -> str:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival class",
        price_cents=3000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    return await _class(db, staff=owner.id, business_id=other.id, item_id=item.id)


async def test_class_that_already_happened_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, year=2020)
    res = await as_owner.post(f"/v1/classes/{sid}/roster", json={"client_id": CLIENTS[0]})
    assert res.status_code == 409
    assert res.json()["message"] == "that class has already happened"


async def test_another_business_class_slot_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    sid = await _rival_class(db, factory)
    add = await as_owner.post(f"/v1/classes/{sid}/roster", json={"client_id": CLIENTS[0]})
    assert add.status_code == 404
    act = await as_owner.patch(f"/v1/classes/{sid}/roster/bk_x", json={"action": "undo"})
    assert act.status_code == 404
    msg = await as_owner.post(f"/v1/classes/{sid}/message", json={"body": "hi"})
    assert msg.status_code == 404


async def test_staff_cannot_change_another_members_roster(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, staff="st_owner")
    slot = await db.get(Slot, sid)
    assert slot is not None
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=sid,
        starts_at=slot.starts_at,
        staff_id="st_owner",
        client_id=CLIENTS[0],
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    res = await as_staff.patch(
        f"/v1/classes/{sid}/roster/{booking.id}", json={"action": "check_in"}
    )
    assert res.status_code == 403


async def test_message_to_an_unknown_or_single_slot_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    missing = await as_owner.post("/v1/classes/ses_missing/message", json={"body": "hi"})
    assert missing.status_code == 404
    single = await _class(db, capacity=1)
    res = await as_owner.post(f"/v1/classes/{single}/message", json={"body": "hi"})
    assert res.status_code == 409


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/v1/classes/ses_x/roster", {"client_id": "cl_amelie"}),
        ("PATCH", "/v1/classes/ses_x/roster/bk_x", {"action": "check_in"}),
        ("POST", "/v1/classes/ses_x/message", {"body": "hi"}),
    ],
)
async def test_unauth_cannot_run_a_class(
    unauth: httpx.AsyncClient, method: str, path: str, body: dict[str, str]
) -> None:
    assert (await unauth.request(method, path, json=body)).status_code == 401


async def test_patch_cannot_give_a_waitlisted_client_a_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db)
    for client in CLIENTS[:2]:
        await _add(as_owner, sid, client)
    waiting = await _add(as_owner, sid, CLIENTS[2])
    url = f"/v1/bookings/{waiting['booking_id']}"
    res = await as_owner.patch(url, json={"status": "confirmed"})
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "class_seat"
    assert await booked_count(db, sid) == 2


async def test_one_attendee_cannot_move_or_resize_the_session(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=6)
    first = await _add(as_owner, sid, CLIENTS[0])
    await _add(as_owner, sid, CLIENTS[1])
    url = f"/v1/bookings/{first['booking_id']}"
    for change in ({"starts_at": "2027-03-06T20:00:00Z"}, {"ends_at": "2027-03-06T19:30:00Z"}):
        check = await as_owner.post(f"{url}/check", json=change)
        assert check.json()["problem"] == "class"
        res = await as_owner.patch(url, json=change)
        assert res.status_code == 409, res.text
        assert res.json()["error"] == "class_move"
    slot = await db.get(Slot, sid, populate_existing=True)
    assert slot is not None and slot.starts_at == datetime(2027, 3, 6, 18, tzinfo=UTC)


async def test_completing_one_attendee_leaves_the_session_open(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sid = await _class(db, capacity=6)
    first = await _add(as_owner, sid, CLIENTS[0])
    second = await _add(as_owner, sid, CLIENTS[1])
    third = await _add(as_owner, sid, CLIENTS[2])
    await begin(db, str(first["booking_id"]))
    await as_owner.patch(f"/v1/bookings/{first['booking_id']}", json={"status": "completed"})
    slot = await db.get(Slot, sid, populate_existing=True)
    assert slot is not None and slot.status == "scheduled"
    for done in (second, third):
        await as_owner.patch(f"/v1/bookings/{done['booking_id']}", json={"status": "completed"})
    slot = await db.get(Slot, sid, populate_existing=True)
    assert slot is not None and slot.status == "completed"
