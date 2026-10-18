from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Note, Subject
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Addon, Booking, Hours
from clientbridge.services.bookings import run_reminders
from clientbridge.services.notifications import Notifier
from tests.conftest import BIZ, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.helpers import key

SLUG = "birchbark"


TUESDAY = "2026-12-01"
OPENING = "2026-12-01T16:00:00Z"  # 9 a.m. in Vancouver (UTC-7), the first open time


def _body(starts: str = OPENING, staff: str = "st_owner", **extra: object) -> dict[str, object]:
    return {
        "item_id": "it_groom_sm",
        "staff_id": staff,
        "starts_at": starts,
        "client": {"name": "Web Booker", "email": "web@example.com"},
        **extra,
    }


async def _policy(db: AsyncSession, **values: object) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(booking_policy=values))
    await db.flush()


async def test_page_carries_policy_clock_staff_and_offers(api: httpx.AsyncClient) -> None:
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert page["slug"] == SLUG
    assert page["now"] is not None
    assert page["policy"]["cancel_cutoff_hours"] == 24
    service = next(s for s in page["services"] if s["id"] == "it_groom_sm")
    assert service["category"] and service["color"]
    assert "st_owner" in service["staff_ids"]
    assert {a["id"] for a in page["addons"]} == {"it_shampoo", "it_brush"}
    assert page["review_count"] >= 0
    assert page["subject"] == "pet"


async def test_hidden_staff_and_unoffered_products_drop_off_the_page(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Staff).where(Staff.id == "st_priya").values(bookable_online=False))
    await db.execute(update(Item).where(Item.id == "it_brush").values(addon=False))
    await db.flush()
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert "st_priya" not in {s["id"] for s in page["staff"]}
    assert {a["id"] for a in page["addons"]} == {"it_shampoo"}
    res = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_groom_sm", "staff_id": "st_priya", "date": TUESDAY},
    )
    assert res.status_code == 404


async def test_anyone_slots_name_the_person(api: httpx.AsyncClient) -> None:
    res = await api.get(
        f"/book/{SLUG}/slots", params={"item_id": "it_groom_sm", "staff_id": "any", "date": TUESDAY}
    )
    assert res.status_code == 200, res.text
    slots = res.json()["slots"]
    assert slots and all(s["staff_id"] for s in slots)


async def test_days_count_openings_and_name_closures(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    db.add(
        Hours(
            id="av_closed_wed",
            business_id=BIZ,
            staff_id=None,
            basis="exception",
            starts_at=datetime(2026, 12, 2, 7, tzinfo=UTC),
            ends_at=datetime(2026, 12, 3, 7, tzinfo=UTC),
            reason="Staff training",
            available=False,
        )
    )
    await db.flush()
    res = await api.get(
        f"/book/{SLUG}/days",
        params={"item_id": "it_groom_sm", "staff_id": "st_owner", "from": TUESDAY, "days": 3},
    )
    assert res.status_code == 200, res.text
    days = res.json()["days"]
    assert [d["date"] for d in days] == ["2026-12-01", "2026-12-02", "2026-12-03"]
    assert days[0]["count"] > 0 and not days[0]["closed"]
    assert days[1] == {
        "date": "2026-12-02",
        "count": 0,
        "closed": True,
        "reason": "Staff training",
    }


async def test_lead_time_and_horizon_bound_open_times_and_booking(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _policy(db, lead_hours=48, horizon_days=7)
    await db.commit()
    far = await api.post(f"/book/{SLUG}", json=_body())
    assert far.status_code == 409
    soon = (clock.now() + timedelta(hours=1)).isoformat()
    assert (await api.post(f"/book/{SLUG}", json=_body(soon))).status_code == 409
    res = await api.get(
        f"/book/{SLUG}/slots", params={"item_id": "it_groom_sm", "staff_id": "any", "date": TUESDAY}
    )
    assert res.json()["slots"] == []


async def test_booking_keeps_subject_note_and_returns_a_manage_link(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    res = await api.post(
        f"/book/{SLUG}",
        json=_body(staff="any", subject_name=" Biscuit ", note="Nervous with dryers"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["manage_token"] and body["status"] == "confirmed"
    booking = await db.get(Booking, body["booking_id"])
    assert booking is not None and booking.subject_id is not None
    pet = await db.get(Subject, booking.subject_id)
    assert pet is not None and pet.name == "Biscuit"
    note = (await db.execute(select(Note.body).where(Note.parent_id == booking.id))).scalar_one()
    assert note == "Nervous with dryers"
    assert f"/m/{body['manage_token']}" in email.sent[-1].body
    view = (await api.get(f"/manage/{body['manage_token']}")).json()
    assert view["subject"] == "pet" and view["subject_name"] == "Biscuit"


async def test_new_clients_wait_for_approval_when_asked(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _policy(db, approve_new_clients=True)
    res = await api.post(f"/book/{SLUG}", json=_body())
    assert res.json()["status"] == "pending"


async def test_addons_must_be_offered_with_the_service(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == "it_brush").values(addon_for=["it_cat"]))
    await db.flush()
    refused = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_brush", "quantity": 1}])
    )
    assert refused.status_code == 404
    ok = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_shampoo", "quantity": 2}])
    )
    assert ok.status_code == 200, ok.text
    rows = await db.execute(
        select(Addon.quantity).where(Addon.booking_id == ok.json()["booking_id"])
    )
    assert rows.scalars().all() == [2]


async def test_booking_replays_on_the_same_key(api: httpx.AsyncClient, db: AsyncSession) -> None:
    headers = key()
    first = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    again = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    assert first.status_code == 200 and again.status_code == 200
    assert first.json()["booking_id"] == again.json()["booking_id"]
    rows = await db.execute(select(Booking.id).where(Booking.source == "online"))
    assert first.json()["booking_id"] in rows.scalars().all()


async def test_booking_refuses_a_key_reused_for_a_different_choice(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    first = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    assert first.status_code == 200, first.text
    changed = await api.post(f"/book/{SLUG}", json=_body(note="later please"), headers=headers)
    assert changed.status_code == 422, changed.text
    assert changed.json()["error"] == "idempotency_key_reused"
    notes = await db.execute(select(Note.id).where(Note.parent_id == first.json()["booking_id"]))
    assert notes.scalars().all() == []


def _days(**params: str | int) -> dict[str, str | int]:
    return {"item_id": "it_groom_sm", "staff_id": "st_owner", "from": TUESDAY, **params}


async def test_days_refuse_unknown_slug_item_and_staff(api: httpx.AsyncClient) -> None:
    assert (await api.get("/book/no-such-page/days", params=_days())).status_code == 404
    unknown_item = await api.get(f"/book/{SLUG}/days", params=_days(item_id="it_nope"))
    assert unknown_item.status_code == 404
    unknown_staff = await api.get(f"/book/{SLUG}/days", params=_days(staff_id="st_nope"))
    assert unknown_staff.status_code == 404


async def test_days_refuse_a_service_not_bookable_online(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == "it_groom_sm").values(online_bookable=False))
    await db.flush()
    assert (await api.get(f"/book/{SLUG}/days", params=_days())).status_code == 409


async def test_days_validate_the_window(api: httpx.AsyncClient) -> None:
    for days in (0, 15):
        res = await api.get(f"/book/{SLUG}/days", params=_days(days=days))
        assert res.status_code == 422
    no_start = {"item_id": "it_groom_sm", "staff_id": "st_owner"}
    assert (await api.get(f"/book/{SLUG}/days", params=no_start)).status_code == 422


async def test_anyone_is_refused_when_every_member_is_busy(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Staff)
        .where(Staff.business_id == BIZ, Staff.id != "st_owner")
        .values(bookable_online=False)
    )
    await db.flush()
    first = await api.post(f"/book/{SLUG}", json=_body())
    assert first.status_code == 200, first.text
    assert (await api.post(f"/book/{SLUG}", json=_body(staff="any"))).status_code == 409


async def test_an_addon_over_stock_is_refused(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Item).where(Item.id == "it_shampoo").values(track_stock=True, stock_on_hand=1)
    )
    await db.flush()
    res = await api.post(
        f"/book/{SLUG}", json=_body(addons=[{"item_id": "it_shampoo", "quantity": 2}])
    )
    assert res.status_code == 409


async def test_a_short_idempotency_key_is_refused(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}", json=_body(), headers={"Idempotency-Key": "short"})
    assert res.status_code == 422


async def test_a_pending_request_is_acknowledged_then_confirmed_on_approval(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
) -> None:
    await _policy(db, approve_new_clients=True)
    res = await api.post(f"/book/{SLUG}", json=_body())
    assert res.json()["status"] == "pending"
    assert [m.subject for m in email.sent] == ["Booking request received — Birchbark Pet Studio"]
    notifier = Notifier(email, FakeSmsSender(), FakePushSender())
    day_before = datetime.fromisoformat(OPENING) - timedelta(hours=20)
    await run_reminders(db, notifier, day_before)
    booking = await db.get(Booking, res.json()["booking_id"], populate_existing=True)
    assert booking is not None and booking.reminded_at is None and booking.confirmed_at is None
    approved = await as_owner.patch(f"/v1/bookings/{booking.id}", json={"status": "confirmed"})
    assert approved.status_code == 200, approved.text
    assert email.sent[-1].subject.startswith("Booking confirmed")
    approved_at = await db.scalar(select(Booking.confirmed_at).where(Booking.id == booking.id))
    assert approved_at is not None
    sent = len(email.sent)
    await as_owner.patch(f"/v1/bookings/{booking.id}", json={"status": "confirmed"})
    assert len(email.sent) == sent


async def test_days_name_closures_on_23_and_25_hour_days(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    toronto = ZoneInfo("America/Toronto")
    await db.execute(update(Business).where(Business.id == BIZ).values(timezone=toronto.key))
    for day in (date(2026, 11, 1), date(2027, 3, 14)):
        db.add(
            Hours(
                id=f"av_closed_{day.isoformat()}",
                business_id=BIZ,
                staff_id=None,
                basis="exception",
                starts_at=datetime.combine(day, time.min, tzinfo=toronto),
                ends_at=datetime.combine(day + timedelta(days=1), time.min, tzinfo=toronto),
                reason="Daylight saving",
                available=False,
            )
        )
        await db.flush()
        res = await api.get(
            f"/book/{SLUG}/days",
            params={"item_id": "it_groom_sm", "staff_id": "st_owner", "from": day.isoformat()},
        )
        assert res.json()["days"][0]["closed"] is True, day


async def test_public_booking_records_one_audit_on_replay(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    first = await api.post(f"/book/{SLUG}", json=_body(), headers=headers)
    assert first.status_code == 200
    assert (await api.post(f"/book/{SLUG}", json=_body(), headers=headers)).status_code == 200
    rows = list(
        await db.scalars(
            select(Audit).where(
                Audit.entity_id == first.json()["booking_id"], Audit.action == "book.create"
            )
        )
    )
    assert len(rows) == 1
    assert rows[0].business_id == BIZ and rows[0].performed_by is None


async def _kind(db: AsyncSession, kind: str | None) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(subject=kind))
    await db.flush()


@pytest.mark.parametrize("kind", ["property", "site"])
async def test_a_place_booking_files_a_new_place_with_its_address(
    api: httpx.AsyncClient, db: AsyncSession, kind: str
) -> None:
    await _kind(db, kind)
    assert (await api.get(f"/book/{SLUG}/services")).json()["subject"] == kind
    body = _body(subject_name="Cottage", subject_address=" 4 Elm Rd ")
    first = await api.post(f"/book/{SLUG}", json=body, headers=key())
    assert first.status_code == 200, first.text
    booking = await db.get(Booking, first.json()["booking_id"])
    assert booking is not None and booking.subject_id is not None
    place = await db.get(Subject, booking.subject_id)
    assert place is not None and place.name == "Cottage"
    assert place.attributes == {"address": "4 Elm Rd"}


async def _booked_subject(api: httpx.AsyncClient, db: AsyncSession, **extra: object) -> Subject:
    slots = await api.get(
        f"/book/{SLUG}/slots",
        params={"item_id": "it_groom_sm", "staff_id": "st_owner", "date": TUESDAY},
    )
    starts = slots.json()["slots"][0]["starts_at"]
    res = await api.post(f"/book/{SLUG}", json={**_body(starts), **extra}, headers=key())
    assert res.status_code == 200, res.text
    booking = await db.get(Booking, res.json()["booking_id"])
    assert booking is not None and booking.subject_id is not None
    subject = await db.get(Subject, booking.subject_id)
    assert subject is not None
    return subject


@pytest.mark.parametrize("kind", ["property", "site"])
async def test_a_place_is_matched_by_name_and_address(
    api: httpx.AsyncClient, db: AsyncSession, kind: str
) -> None:
    await _kind(db, kind)
    home = await _booked_subject(api, db, subject_name="Home", subject_address="4 Elm Rd")
    other = await _booked_subject(api, db, subject_name="home", subject_address="9 Oak Ave")
    again = await _booked_subject(api, db, subject_name="Home", subject_address="  4  ELM rd ")
    assert other.id != home.id and other.client_id == home.client_id
    assert other.attributes == {"address": "9 Oak Ave"}
    assert again.id == home.id and home.attributes == {"address": "4 Elm Rd"}


async def test_a_property_without_an_address_takes_the_first_one_booked(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _kind(db, "property")
    cabin = await _booked_subject(api, db, subject_name="Cabin")
    filled = await _booked_subject(api, db, subject_name="Cabin", subject_address="1 Lake Rd")
    assert filled.id == cabin.id and cabin.attributes == {"address": "1 Lake Rd"}


async def test_a_booking_named_after_a_deleted_pet_files_a_new_one(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    gone = await _booked_subject(api, db, subject_name="Biscuit")
    gone.deleted_at = clock.now()
    await db.flush()
    fresh = await _booked_subject(api, db, subject_name="Biscuit")
    assert fresh.id != gone.id and fresh.deleted_at is None


@pytest.mark.parametrize(
    ("kind", "extra"),
    [
        (None, {"subject_name": "Rex"}),
        (None, {"subject_address": "4 Elm Rd"}),
        ("pet", {"subject_name": "Rex", "subject_address": "4 Elm Rd"}),
        ("student", {"subject_name": "Maya", "subject_address": "4 Elm Rd"}),
    ],
)
async def test_subject_fields_a_business_does_not_take_are_refused_422(
    api: httpx.AsyncClient, db: AsyncSession, kind: str | None, extra: dict[str, str]
) -> None:
    await _kind(db, kind)
    online = select(func.count()).select_from(Booking).where(Booking.source == "online")
    before = await db.scalar(online)
    res = await api.post(f"/book/{SLUG}", json=_body(**extra))
    assert res.status_code == 422
    assert res.json()["error"] == "no_subjects"
    assert await db.scalar(online) == before


async def test_a_business_without_subjects_books_only_the_client(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _kind(db, None)
    assert (await api.get(f"/book/{SLUG}/services")).json()["subject"] is None
    res = await api.post(f"/book/{SLUG}", json=_body(subject_name="  "))
    assert res.status_code == 200, res.text
    booking = await db.get(Booking, res.json()["booking_id"])
    assert booking is not None and booking.subject_id is None
    view = (await api.get(f"/manage/{res.json()['manage_token']}")).json()
    assert view["subject"] is None and view["subject_name"] is None
