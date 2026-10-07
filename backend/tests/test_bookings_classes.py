from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.messaging import Message
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

CLIENTS = ["cl_amelie", "cl_marcus", "cl_yuki", "cl_liam"]


async def _class(
    db: AsyncSession, *, staff: str = "st_owner", capacity: int = 2, day: int = 6
) -> str:
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_puppy",
        staff_id=staff,
        starts_at=datetime(2027, 3, day, 18, tzinfo=UTC),
        ends_at=datetime(2027, 3, day, 19, tzinfo=UTC),
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
    missed = await as_owner.patch(url, json={"action": "no_show"})
    assert missed.json()["status"] == "no_show"
    back = await as_owner.patch(url, json={"action": "undo"})
    assert back.json()["status"] == "confirmed"
    nothing = await as_owner.patch(url, json={"action": "undo"})
    assert nothing.status_code == 409


async def test_promote_gives_a_freed_seat_and_tells_the_client(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    sid = await _class(db)
    first = (await _add(as_owner, sid, CLIENTS[0]))["booking_id"]
    await _add(as_owner, sid, CLIENTS[1])
    waiting = (await _add(as_owner, sid, CLIENTS[2]))["booking_id"]
    full = await as_owner.patch(f"/v1/classes/{sid}/roster/{waiting}", json={"action": "promote"})
    assert full.status_code == 409
    await as_owner.patch(f"/v1/bookings/{first}", json={"status": "canceled"})
    sent = len(email.sent)
    res = await as_owner.patch(f"/v1/classes/{sid}/roster/{waiting}", json={"action": "promote"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed"
    assert len(email.sent) == sent + 1


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


async def test_unauth_cannot_touch_a_roster(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/classes/ses_x/roster", json={"client_id": CLIENTS[0]})
    assert res.status_code == 401


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
