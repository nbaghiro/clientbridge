from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Recurrence, Slot
from clientbridge.services.bookings import expand_occurrences
from tests.conftest import BIZ, Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import enable_payments, key, settle

VANCOUVER = ZoneInfo("America/Vancouver")
ST_OWNER = "st_owner"
ST_DIEGO = "st_diego"
ST_PRIYA = "st_priya"
CL_AMELIE = "cl_amelie"


async def _item(db: AsyncSession, *, deposit: bool = False) -> str:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="service",
        name="Series Groom",
        price_cents=8000,
        currency="CAD",
        duration_min=60,
        deposit_type="fixed" if deposit else "none",
        deposit_value=2000 if deposit else None,
    )
    db.add(item)
    await db.flush()
    return item.id


async def _series(
    api: httpx.AsyncClient, db: AsyncSession, *, staff: str = ST_PRIYA, **extra: object
) -> dict[str, object]:
    body: dict[str, object] = {
        "client_id": CL_AMELIE,
        "item_id": await _item(db),
        "staff_id": staff,
        "starts_at": "2027-03-01T18:00:00Z",
        "frequency": "week",
        "interval": 1,
        "count": 4,
        "confirmation": "none",
        **extra,
    }
    res = await api.post("/v1/recurrences", json=body)
    assert res.status_code == 201, res.text
    out: dict[str, object] = res.json()
    return out


async def _starts(db: AsyncSession, recurrence_id: str) -> list[tuple[datetime, str, str]]:
    rows = await db.execute(
        select(Slot.starts_at, Slot.staff_id, Booking.status)
        .join(Booking, Booking.slot_id == Slot.id)
        .where(Slot.recurrence_id == recurrence_id)
        .order_by(Slot.starts_at)
        .execution_options(populate_existing=True)
    )
    return [(r[0], r[1], r[2]) for r in rows.all()]


def test_monthly_by_weekday_keeps_the_nth_weekday() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 9),  # 2nd Tuesday
        frequency="month",
        interval=1,
        byday=None,
        count=3,
        until=None,
        monthly_by="weekday",
    )
    assert out == [date(2027, 3, 9), date(2027, 4, 13), date(2027, 5, 11)]
    fifth = expand_occurrences(
        start_date=date(2027, 3, 30),  # 5th Tuesday, absent in April
        frequency="month",
        interval=1,
        byday=None,
        count=2,
        until=None,
        monthly_by="weekday",
    )
    assert fifth == [date(2027, 3, 30), date(2027, 4, 27)]


async def test_create_skips_and_shifts_named_dates(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = await _series(
        as_owner,
        db,
        exceptions=[
            {"date": "2027-03-08", "action": "skip"},
            {"date": "2027-03-15", "action": "shift", "starts_at": "2027-03-15T20:00:00Z"},
        ],
    )
    occurrences = body["occurrences"]
    assert isinstance(occurrences, list)
    assert body["created"] == 3 and body["skipped"] == 1
    assert occurrences[1]["booking_id"] is None
    starts = await _starts(db, str(body["id"]))
    assert [s[0] for s in starts] == [
        datetime(2027, 3, 1, 18, tzinfo=UTC),
        datetime(2027, 3, 15, 20, tzinfo=UTC),
        datetime(2027, 3, 22, 18, tzinfo=UTC),
    ]


async def test_a_shift_needs_its_new_time(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.post(
        "/v1/recurrences",
        json={
            "client_id": CL_AMELIE,
            "item_id": await _item(db),
            "staff_id": ST_PRIYA,
            "starts_at": "2027-03-01T18:00:00Z",
            "frequency": "week",
            "count": 2,
            "exceptions": [{"date": "2027-03-08", "action": "shift"}],
        },
    )
    assert res.status_code == 422


async def test_series_confirmation_is_one_message(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender
) -> None:
    await _series(as_owner, db, confirmation="series")
    assert len(email.sent) == 1
    assert email.sent[0].body.count("at ") == 4
    assert len(sms.sent) == 1


async def test_each_confirmation_is_one_message_per_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _series(as_owner, db, confirmation="each", count=3)
    assert len(email.sent) == 3


async def test_change_all_moves_weekday_time_and_member(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    body = await _series(as_owner, db)
    rid = str(body["id"])
    res = await as_owner.patch(
        f"/v1/recurrences/{rid}",
        json={"scope": "all", "weekday": 2, "time": "13:00", "staff_id": ST_OWNER},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["moved"]) == 4 and res.json()["skipped"] == []
    starts = await _starts(db, rid)
    local = [s[0].astimezone(VANCOUVER) for s in starts]
    assert {(t.weekday(), t.hour) for t in local} == {(2, 13)}
    assert {s[1] for s in starts} == {ST_OWNER}
    recurrence = await db.get(Recurrence, rid, populate_existing=True)
    assert recurrence is not None
    assert recurrence.staff_id == ST_OWNER and recurrence.byday == ["WE"]
    assert len(email.sent) == 1
    audit = await db.execute(select(Audit.action).where(Audit.entity_id == rid))
    assert "recurrence.change" in audit.scalars().all()


async def test_change_following_leaves_earlier_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = str((await _series(as_owner, db))["id"])
    res = await as_owner.patch(
        f"/v1/recurrences/{rid}",
        json={"scope": "following", "from": "2027-03-15", "time": "14:00", "notify": False},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["moved"]) == 2
    starts = await _starts(db, rid)
    assert starts[0][0] == datetime(2027, 3, 1, 18, tzinfo=UTC)
    assert starts[1][0] == datetime(2027, 3, 8, 18, tzinfo=UTC)
    assert starts[2][0] != datetime(2027, 3, 15, 18, tzinfo=UTC)


async def test_change_one_and_report_a_clash(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    rid = str((await _series(as_owner, db))["id"])
    blocker = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": CL_AMELIE,
            "item_id": await _item(db),
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-08T18:00:00Z",
        },
    )
    assert blocker.status_code == 201
    res = await as_owner.patch(
        f"/v1/recurrences/{rid}",
        json={"scope": "one", "from": "2027-03-08", "staff_id": ST_OWNER, "notify": False},
    )
    assert res.status_code == 200, res.text
    assert res.json()["moved"] == []
    assert res.json()["skipped"][0]["skipped"] == "that staff member is already booked at that time"
    recurrence = await db.get(Recurrence, rid, populate_existing=True)
    assert recurrence is not None and recurrence.staff_id == ST_PRIYA


async def test_change_needs_something_to_change(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = str((await _series(as_owner, db))["id"])
    res = await as_owner.patch(f"/v1/recurrences/{rid}", json={"scope": "all"})
    assert res.status_code == 422
    following = await as_owner.patch(
        f"/v1/recurrences/{rid}", json={"scope": "following", "time": "10:00"}
    )
    assert following.status_code == 422
    bad_time = await as_owner.patch(
        f"/v1/recurrences/{rid}", json={"scope": "all", "time": "25:00"}
    )
    assert bad_time.status_code == 422


async def test_change_on_a_date_without_a_visit_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = str((await _series(as_owner, db))["id"])
    res = await as_owner.patch(
        f"/v1/recurrences/{rid}", json={"scope": "one", "from": "2027-03-09", "time": "10:00"}
    )
    assert res.status_code == 404
    assert (
        await as_owner.patch("/v1/recurrences/sch_missing", json={"scope": "all", "time": "10:00"})
    ).status_code == 404


async def test_cancel_from_a_date_ends_the_series(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    rid = str((await _series(as_owner, db))["id"])
    res = await as_owner.post(f"/v1/recurrences/{rid}/cancel", json={"from": "2027-03-15"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "ended"
    assert len(res.json()["canceled"]) == 2
    statuses = [s[2] for s in await _starts(db, rid)]
    assert statuses == ["confirmed", "confirmed", "canceled", "canceled"]
    recurrence = await db.get(Recurrence, rid, populate_existing=True)
    assert recurrence is not None and recurrence.until == date(2027, 3, 14)
    assert len(email.sent) == 1


async def test_cancel_everything_refunds_paid_deposits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    res = await as_owner.post(
        "/v1/recurrences",
        json={
            "client_id": CL_AMELIE,
            "item_id": await _item(db, deposit=True),
            "staff_id": ST_PRIYA,
            "starts_at": "2027-03-01T18:00:00Z",
            "frequency": "week",
            "count": 2,
            "confirmation": "none",
        },
    )
    first = res.json()["occurrences"][0]["booking_id"]
    paid = await as_owner.post(f"/v1/bookings/{first}/deposit?payment_method_id=default")
    assert paid.status_code == 200, paid.text
    await settle(as_owner, db, paid.json()["payment_id"])
    rid = res.json()["id"]
    cancel = await as_owner.post(f"/v1/recurrences/{rid}/cancel", json={"notify": False})
    assert cancel.status_code == 200, cancel.text
    assert cancel.json() | {"canceled": []} == {
        "id": rid,
        "status": "canceled",
        "canceled": [],
        "refunded_cents": 2000,
    }
    booking = await db.get(Booking, first, populate_existing=True)
    assert booking is not None and booking.deposit_status == "refunded"
    again = await as_owner.post(f"/v1/recurrences/{rid}/cancel", json={})
    assert again.status_code == 409


async def test_staff_cannot_change_or_cancel_anothers_series(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    recurrence = Recurrence(
        id=new_id("recurrence"),
        business_id=BIZ,
        item_id=await _item(db),
        staff_id=ST_OWNER,
        client_id=CL_AMELIE,
        frequency="week",
        interval=1,
        start_date=date(2027, 3, 1),
        status="active",
    )
    db.add(recurrence)
    await db.flush()
    change = await as_staff.patch(
        f"/v1/recurrences/{recurrence.id}", json={"scope": "all", "time": "10:00"}
    )
    assert change.status_code == 403
    cancel = await as_staff.post(f"/v1/recurrences/{recurrence.id}/cancel", json={})
    assert cancel.status_code == 403


async def test_staff_cannot_hand_their_series_to_someone_else(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = str((await _series(as_staff, db, staff=ST_DIEGO, starts_at="2027-03-02T18:00:00Z"))["id"])
    res = await as_staff.patch(
        f"/v1/recurrences/{rid}", json={"scope": "all", "staff_id": ST_OWNER}
    )
    assert res.status_code == 403


async def test_unauth_cannot_change_a_series(unauth: httpx.AsyncClient) -> None:
    res = await unauth.patch("/v1/recurrences/sch_x", json={"scope": "all", "time": "10:00"})
    assert res.status_code == 401
    assert (await unauth.post("/v1/recurrences/sch_x/cancel", json={})).status_code == 401


async def test_another_business_series_404(
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
    recurrence = Recurrence(
        id=new_id("recurrence"),
        business_id=other.id,
        item_id=item.id,
        staff_id=owner.id,
        client_id=client.id,
        frequency="week",
        interval=1,
        start_date=date(2027, 3, 1),
        status="active",
    )
    db.add(recurrence)
    await db.flush()
    change = await as_owner.patch(
        f"/v1/recurrences/{recurrence.id}", json={"scope": "all", "time": "10:00"}
    )
    assert change.status_code == 404
    assert (
        await as_owner.post(f"/v1/recurrences/{recurrence.id}/cancel", json={})
    ).status_code == 404


async def test_create_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    body = {
        "client_id": CL_AMELIE,
        "item_id": await _item(db),
        "staff_id": ST_PRIYA,
        "starts_at": "2027-03-01T18:00:00Z",
        "frequency": "week",
        "count": 2,
    }
    headers = key()
    first = await as_owner.post("/v1/recurrences", json=body, headers=headers)
    again = await as_owner.post("/v1/recurrences", json=body, headers=headers)
    assert first.json()["id"] == again.json()["id"]
    rows = await db.execute(select(Recurrence.id).where(Recurrence.id == first.json()["id"]))
    assert len(rows.scalars().all()) == 1
