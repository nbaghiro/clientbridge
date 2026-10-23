from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business, Staff
from clientbridge.models.scheduling import Booking, Recurrence, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import key, ok
from tests.test_programs import days, enrol, ids, program_item, schedule

SECOND_DAY = "2027-03-03T18:00:00Z"
GROOM = "it_groom_sm"


async def _member(db: AsyncSession, factory: Factory, name: str) -> str:
    business = await db.get(Business, BIZ)
    assert business is not None
    member = await factory.staff(
        business=business, user=await factory.user(name=name), role="staff"
    )
    return member.id


async def _busy(api: httpx.AsyncClient, staff: str, starts: str) -> None:
    """Book the member for a visit that overlaps the program's session at `starts`."""
    body = {
        "client_id": "cl_amelie",
        "item_id": GROOM,
        "staff_id": staff,
        "starts_at": starts,
        "notify": False,
    }
    assert (await api.post("/v1/bookings", json=body)).status_code == 201


async def _remove(api: httpx.AsyncClient, staff: str, **body: str) -> httpx.Response:
    return await api.post(f"/v1/staff/{staff}/remove", json=body)


async def _status(db: AsyncSession, staff_id: str) -> str:
    member = await db.get(Staff, staff_id, populate_existing=True)
    assert member is not None
    return member.status


async def _program(
    api: httpx.AsyncClient, db: AsyncSession, staff: str, offered_by: list[str] | None = None
) -> str:
    item = await program_item(db, staff_ids=offered_by)
    return str((await schedule(api, item, staff_id=staff))["id"])


async def _held_by(db: AsyncSession, program_id: str) -> set[str | None]:
    recurrence = await db.get(Recurrence, program_id, populate_existing=True)
    assert recurrence is not None
    return {recurrence.staff_id, *(s.staff_id for s in await days(db, program_id))}


async def _booked_staff(db: AsyncSession, booking_ids: list[str]) -> set[str | None]:
    rows = await db.scalars(
        select(Booking.staff_id)
        .where(Booking.id.in_(booking_ids))
        .execution_options(populate_existing=True)
    )
    return set(rows)


async def test_a_program_schedule_moves_whole_to_the_named_member(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    program_id = await _program(as_owner, db, leaving)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    headers = key()
    body = {"future": "reassign", "reassign_to": taking}
    res = await as_owner.post(f"/v1/staff/{leaving}/remove", json=body, headers=headers)
    out = ok(res).json()
    assert out["series_moved"] == [{"recurrence_id": program_id, "staff_id": taking}]
    assert sorted(out["moved"]) == sorted(booked) and out["left"] == []
    assert await _held_by(db, program_id) == {taking}
    assert await _booked_staff(db, booked) == {taking}
    assert await _status(db, leaving) == "removed"
    first = await db.get(Booking, booked[0], populate_existing=True)
    assert first is not None and first.invoice_id is not None
    invoice = await db.get(Invoice, first.invoice_id, populate_existing=True)
    assert invoice is not None and invoice.status == "sent"
    again = await as_owner.post(f"/v1/staff/{leaving}/remove", json=body, headers=headers)
    assert ok(again).json() == out


async def test_any_member_takes_the_schedule_only_if_free_on_every_day(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Leaving Lee")
    busy = await _member(db, factory, "Busy Bo")
    free = await _member(db, factory, "Free Fay")
    program_id = await _program(as_owner, db, leaving, offered_by=[leaving, busy, free])
    await _busy(as_owner, busy, SECOND_DAY)
    out = ok(await _remove(as_owner, leaving, future="reassign", reassign_to="any")).json()
    assert out["series_moved"] == [{"recurrence_id": program_id, "staff_id": free}]
    assert await _held_by(db, program_id) == {free}


async def test_canceling_a_removed_instructor_s_program_ends_it_and_voids_its_invoices(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Leaving Lee")
    program_id = await _program(as_owner, db, leaving)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    out = ok(await _remove(as_owner, leaving, future="cancel")).json()
    assert sorted(out["canceled"]) == sorted(booked)
    assert out["series_ended"] == [program_id]
    assert {s.status for s in await days(db, program_id)} == {"canceled"}
    first = await db.get(Booking, booked[0], populate_existing=True)
    assert first is not None and first.invoice_id is not None
    invoice = await db.get(Invoice, first.invoice_id, populate_existing=True)
    assert invoice is not None and invoice.status == "void"


async def test_a_member_who_doesn_t_teach_the_class_can_t_take_it(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    program_id = await _program(as_owner, db, leaving, offered_by=[leaving])
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.status_code == 409 and res.json()["error"] == "schedule_clash"
    assert res.json()["detail"]["problem"] == "not_offered"
    assert await _held_by(db, program_id) == {leaving}
    assert await _status(db, leaving) == "active"


async def test_a_clash_on_any_day_refuses_the_removal_and_names_the_day(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    leaving = await _member(db, factory, "Leaving Lee")
    taking = await _member(db, factory, "Taking Tam")
    program_id = await _program(as_owner, db, leaving)
    booked = ids(await enrol(as_owner, program_id, "cl_amelie"), "booking_ids")
    await _busy(as_owner, taking, SECOND_DAY)
    res = await _remove(as_owner, leaving, future="reassign", reassign_to=taking)
    assert res.status_code == 409, res.text
    body = res.json()
    assert body["error"] == "schedule_clash"
    assert body["detail"]["recurrence_id"] == program_id
    assert datetime.fromisoformat(body["detail"]["starts_at"]) == datetime.fromisoformat(SECOND_DAY)
    assert await _held_by(db, program_id) == {leaving}
    assert await _booked_staff(db, booked) == {leaving}
    assert await _status(db, leaving) == "active"
    slots = await db.scalars(select(Slot).where(Slot.recurrence_id == program_id))
    assert {s.status for s in slots} == {"scheduled"}
