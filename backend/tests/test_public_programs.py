from datetime import timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.bookings import booked_count, run_reap_unpaid_bookings
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    FakeEmailSender,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
)
from tests.helpers import enable_payments, key
from tests.test_programs import FIRST, days, enrol, program_item, schedule

SLUG = "birchbark"


async def _program(api: httpx.AsyncClient, db: AsyncSession, *, deposit: bool = False) -> str:
    made = await schedule(api, await program_item(db, deposit=deposit))
    return str(made["item_id"])


async def _no_approval(db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(booking_policy={"lead_hours": 0})
    )
    await db.flush()


def _body(item_id: str, name: str = "Rosa Diaz", **extra: object) -> dict[str, object]:
    return {
        "item_id": item_id,
        "staff_id": "any",
        "starts_at": FIRST,
        "client": {"name": name, "email": f"{name.split()[0].lower()}@clients.ca"},
        "subject_name": "Biscuit",
        **extra,
    }


async def _book(api: httpx.AsyncClient, body: dict[str, object]) -> dict[str, object]:
    res = await api.post(f"/book/{SLUG}", json=body, headers=key())
    assert res.status_code == 200, res.text
    out: dict[str, object] = res.json()
    return out


def _ids(body: dict[str, object]) -> list[str]:
    found = body["booking_ids"]
    assert isinstance(found, list)
    return [str(x) for x in found]


async def test_the_page_names_a_programs_days(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    page = (await unauth.get(f"/book/{SLUG}/services")).json()
    service = next(s for s in page["services"] if s["id"] == item_id)
    assert service["session_count"] == 3
    groom = next(s for s in page["services"] if s["id"] == "it_groom_sm")
    assert groom["session_count"] is None


async def test_a_program_lists_its_start_dates_with_one_price(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    res = await unauth.get(f"/book/{SLUG}/programs", params={"item_id": item_id, "staff_id": "any"})
    assert res.status_code == 200, res.text
    [run] = res.json()["programs"]
    assert run["starts_at"] == FIRST and run["seats_left"] == 2
    assert len(run["days"]) == 3
    slots = await unauth.get(
        f"/book/{SLUG}/slots", params={"item_id": item_id, "staff_id": "any", "date": FIRST[:10]}
    )
    assert slots.json()["slots"] == []


async def test_a_run_with_a_full_day_is_not_offered(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    made = await schedule(as_owner, await program_item(db))
    await enrol(as_owner, str(made["id"]), "cl_amelie")
    thursday = (await days(db, str(made["id"]))).pop()
    db.add(
        Booking(
            id=new_id("booking"),
            business_id=BIZ,
            slot_id=thursday.id,
            starts_at=thursday.starts_at,
            staff_id="st_owner",
            client_id="cl_yuki",
            status="confirmed",
            source="manual",
        )
    )
    await db.flush()
    res = await unauth.get(
        f"/book/{SLUG}/programs", params={"item_id": str(made["item_id"]), "staff_id": "any"}
    )
    assert res.json()["programs"] == []


async def test_enrolling_online_books_every_day(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    unauth: httpx.AsyncClient,
    email: FakeEmailSender,
) -> None:
    item_id = await _program(as_owner, db, deposit=True)
    await _no_approval(db)
    out = await _book(unauth, _body(item_id))
    assert out["status"] == "confirmed" and out["deposit_cents"] == 5000
    booked = _ids(out)
    rows = list(await db.scalars(select(Booking).where(Booking.id.in_(booked))))
    assert sorted(b.price_cents for b in rows) == [0, 0, 30000]
    assert {b.source for b in rows} == {"online"}
    assert email.sent[-1].subject.startswith("Your visits are booked")


async def test_a_new_client_asks_to_enrol_when_the_business_approves_them(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    out = await _book(unauth, _body(item_id))
    rows = list(await db.scalars(select(Booking).where(Booking.id.in_(_ids(out)))))
    assert {b.status for b in rows} == {"pending"}


async def test_siblings_enrol_online_in_one_run(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    await _no_approval(db)
    await _book(unauth, _body(item_id))
    await _book(unauth, _body(item_id, subject_name="Pickle"))
    sessions = await db.scalars(select(Slot).where(Slot.item_id == item_id))
    taken = [await booked_count(db, s.id) for s in sessions]
    assert taken == [2, 2, 2]


async def test_an_online_enrolment_replays_on_its_key(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    await _no_approval(db)
    headers = key()
    first = await unauth.post(f"/book/{SLUG}", json=_body(item_id), headers=headers)
    again = await unauth.post(f"/book/{SLUG}", json=_body(item_id), headers=headers)
    assert first.status_code == again.status_code == 200
    assert first.json()["booking_ids"] == again.json()["booking_ids"]


async def test_the_manage_link_cancels_the_whole_enrolment(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    unauth: httpx.AsyncClient,
    email: FakeEmailSender,
) -> None:
    item_id = await _program(as_owner, db)
    await _no_approval(db)
    booked = _ids(await _book(unauth, _body(item_id)))
    wednesday = await db.get(Booking, booked[1])
    assert wednesday is not None and wednesday.manage_token is not None
    view = (await unauth.get(f"/manage/{wednesday.manage_token}")).json()
    assert view["program_days"] == 3 and view["can_cancel"] is True
    res = await unauth.post(f"/manage/{wednesday.manage_token}/cancel", headers=key())
    assert res.status_code == 200, res.text
    rows = list(
        await db.scalars(
            select(Booking).where(Booking.id.in_(booked)).execution_options(populate_existing=True)
        )
    )
    assert {b.status for b in rows} == {"canceled"}
    assert email.sent[-1].subject.startswith("Your visits were canceled")


async def test_a_run_is_booked_only_from_its_first_day(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    body = _body(item_id, starts_at="2027-03-03T18:00:00Z")
    res = await unauth.post(f"/book/{SLUG}", json=body, headers=key())
    assert res.status_code == 409 and res.json()["error"] == "slot_unavailable"


async def test_a_program_day_has_no_waitlist(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    res = await unauth.post(f"/book/{SLUG}/waitlist", json=_body(item_id), headers=key())
    assert res.status_code == 422 and res.json()["error"] == "no_waitlist"


async def test_an_unpaid_online_deposit_releases_every_day(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db, deposit=True)
    await _no_approval(db)
    await enable_payments(db)
    booked = _ids(await _book(unauth, _body(item_id)))
    await db.execute(
        update(Booking)
        .where(Booking.id.in_(booked))
        .values(created_at=clock.now() - timedelta(hours=1))
    )
    notifier = Notifier(FakeEmailSender(), FakeSmsSender(), FakePushSender())
    assert await run_reap_unpaid_bookings(db, FakePaymentGateway(), notifier, clock.now()) >= 1
    rows = list(
        await db.scalars(
            select(Booking).where(Booking.id.in_(booked)).execution_options(populate_existing=True)
        )
    )
    assert {b.status for b in rows} == {"canceled"}


async def test_the_manage_link_cannot_cancel_inside_the_first_days_cutoff(
    as_owner: httpx.AsyncClient, db: AsyncSession, unauth: httpx.AsyncClient
) -> None:
    item_id = await _program(as_owner, db)
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(booking_policy={"lead_hours": 0, "cancel_cutoff_hours": 24})
    )
    await db.flush()
    booked = _ids(await _book(unauth, _body(item_id)))
    rows = list(await db.scalars(select(Booking).where(Booking.id.in_(booked))))
    first = min(rows, key=lambda b: b.starts_at)
    clock.travel(first.starts_at - timedelta(hours=2))
    third = max(rows, key=lambda b: b.starts_at)
    assert third.manage_token is not None
    res = await unauth.post(f"/manage/{third.manage_token}/cancel", headers=key())
    assert res.status_code == 409 and res.json()["error"] == "change_blocked"
