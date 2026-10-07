from datetime import UTC, date, datetime, time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Hours
from clientbridge.services.bookings import open_slots
from tests.conftest import BIZ, Factory
from tests.helpers import client_id, key

ST_OWNER = "st_owner"
ST_DIEGO = "st_diego"
ST_PRIYA = "st_priya"


def _away(
    staff: str | None, start: str, end: str, reason: str = "Vet appointment"
) -> dict[str, object]:
    return {"staff_id": staff, "starts_at": start, "ends_at": end, "reason": reason}


async def _service(db: AsyncSession) -> str:
    row = (
        await db.execute(
            select(Item.id).where(
                Item.business_id == BIZ, Item.kind == "service", Item.duration_min == 60
            )
        )
    ).scalars()
    item = row.first()
    assert item is not None
    return item


async def _book(api: httpx.AsyncClient, db: AsyncSession, staff: str, starts: str) -> str:
    res = await api.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": await _service(db),
            "staff_id": staff,
            "starts_at": starts,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


async def test_staff_adds_their_own_time_off(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_staff.post(
        "/v1/time-off", json=_away(ST_DIEGO, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["staff_id"] == ST_DIEGO
    assert body["reason"] == "Vet appointment"
    row = await db.get(Hours, body["id"])
    assert row is not None and row.basis == "exception" and not row.available
    audit = await db.execute(select(Audit.action).where(Audit.entity_id == body["id"]))
    assert audit.scalar_one() == "time_off.create"


async def test_time_off_lists_the_visits_it_leaves_uncovered(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inside = await _book(as_owner, db, ST_PRIYA, "2027-03-01T18:00:00Z")
    await _book(as_owner, db, ST_PRIYA, "2027-03-01T22:00:00Z")
    res = await as_owner.post(
        "/v1/time-off", json=_away(ST_PRIYA, "2027-03-01T17:00:00Z", "2027-03-01T20:00:00Z")
    )
    assert res.status_code == 201, res.text
    assert res.json()["affected"] == [inside]


async def test_owner_closes_the_business(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    booked = await _book(as_owner, db, ST_PRIYA, "2027-03-08T18:00:00Z")
    res = await as_owner.post(
        "/v1/time-off",
        json=_away(None, "2027-03-08T08:00:00Z", "2027-03-09T08:00:00Z", "Thanksgiving"),
    )
    assert res.status_code == 201, res.text
    assert res.json()["staff_id"] is None
    assert res.json()["affected"] == [booked]
    audit = await db.execute(select(Audit.action).where(Audit.entity_id == res.json()["id"]))
    assert audit.scalar_one() == "closure.create"


async def test_time_off_blocks_new_bookings_and_open_times(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await as_owner.post(
        "/v1/time-off", json=_away(ST_PRIYA, "2027-03-01T17:00:00Z", "2027-03-01T20:00:00Z")
    )
    res = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": await _service(db),
            "staff_id": ST_PRIYA,
            "starts_at": "2027-03-01T18:00:00Z",
        },
    )
    assert res.status_code == 409
    assert res.json()["message"] == "that staff member is away then"
    item = await db.get(Item, await _service(db))
    assert item is not None
    db.add(
        Hours(
            id="av_test_mon",
            business_id=BIZ,
            staff_id=ST_PRIYA,
            basis="recurring",
            weekday=0,
            start_time=time(9),
            end_time=time(13),
            available=True,
        )
    )
    await db.flush()
    starts = await open_slots(db, BIZ, item, ST_PRIYA, date(2027, 3, 1))
    assert starts, "the morning outside the time off stays open"
    for start in starts:
        assert not (
            datetime(2027, 3, 1, 16, tzinfo=UTC) < start < datetime(2027, 3, 1, 20, tzinfo=UTC)
        )


async def test_closure_blocks_every_member(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await as_owner.post(
        "/v1/time-off", json=_away(None, "2027-03-08T08:00:00Z", "2027-03-09T08:00:00Z", "Closed")
    )
    for staff in (ST_OWNER, ST_PRIYA):
        res = await as_owner.post(
            "/v1/bookings/check",
            json={
                "item_id": await _service(db),
                "staff_id": staff,
                "starts_at": "2027-03-08T18:00:00Z",
            },
        )
        assert res.status_code == 200
        assert res.json() == {
            "ok": False,
            "problem": "closed",
            "reason": "Closed",
            "message": "the business is closed then",
        }


async def test_owner_removes_time_off(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    created = await as_owner.post(
        "/v1/time-off", json=_away(ST_DIEGO, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    hid = created.json()["id"]
    res = await as_owner.delete(f"/v1/time-off/{hid}")
    assert res.status_code == 200
    assert await db.get(Hours, hid, populate_existing=True) is None


async def test_staff_cannot_add_time_off_for_someone_else(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_staff.post(
        "/v1/time-off", json=_away(ST_OWNER, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    assert res.status_code == 403
    rows = await db.execute(select(Hours.id).where(Hours.basis == "exception"))
    assert rows.first() is None


async def test_staff_cannot_close_the_business(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post(
        "/v1/time-off", json=_away(None, "2027-03-08T08:00:00Z", "2027-03-09T08:00:00Z")
    )
    assert res.status_code == 403


async def test_staff_cannot_remove_a_closure(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    db.add(
        Hours(
            id="av_closed",
            business_id=BIZ,
            staff_id=None,
            basis="exception",
            starts_at=datetime(2027, 3, 8, 8, tzinfo=UTC),
            ends_at=datetime(2027, 3, 9, 8, tzinfo=UTC),
            reason="Closed",
            available=False,
        )
    )
    await db.flush()
    res = await as_staff.delete("/v1/time-off/av_closed")
    assert res.status_code == 403
    assert await db.get(Hours, "av_closed") is not None


async def test_unauth_cannot_add_time_off(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post(
        "/v1/time-off", json=_away(ST_OWNER, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    assert res.status_code == 401


async def test_time_off_must_end_after_it_starts(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/time-off", json=_away(ST_OWNER, "2027-03-02T22:00:00Z", "2027-03-02T20:00:00Z")
    )
    assert res.status_code == 422
    long = await as_owner.post(
        "/v1/time-off", json=_away(ST_OWNER, "2027-03-02T20:00:00Z", "2028-04-02T20:00:00Z")
    )
    assert long.status_code == 422


async def test_time_off_needs_a_reason(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/time-off", json=_away(ST_OWNER, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z", "")
    )
    assert res.status_code == 422


async def test_unknown_member_or_entry_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/time-off", json=_away("st_missing", "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    assert res.status_code == 404
    assert (await as_owner.delete("/v1/time-off/av_missing")).status_code == 404


async def test_recurring_hours_are_not_removed_as_time_off(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.delete("/v1/time-off/av_st_owner_1")
    assert res.status_code == 404


async def test_another_business_time_off_is_invisible(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    rival = await factory.staff(business=other, user=await factory.user(), role="owner")
    row = Hours(
        id="av_rival_off",
        business_id=other.id,
        staff_id=rival.id,
        basis="exception",
        starts_at=datetime(2027, 3, 2, 20, tzinfo=UTC),
        ends_at=datetime(2027, 3, 2, 22, tzinfo=UTC),
        reason="Away",
        available=False,
    )
    db.add(row)
    await db.flush()
    assert (await as_owner.delete("/v1/time-off/av_rival_off")).status_code == 404
    cross = await as_owner.post(
        "/v1/time-off", json=_away(rival.id, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    )
    assert cross.status_code == 404


async def test_time_off_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    headers = key()
    body = _away(ST_OWNER, "2027-03-02T20:00:00Z", "2027-03-02T22:00:00Z")
    first = await as_owner.post("/v1/time-off", json=body, headers=headers)
    again = await as_owner.post("/v1/time-off", json=body, headers=headers)
    assert first.status_code == 201 and again.status_code == 201
    assert first.json()["id"] == again.json()["id"]
    rows = await db.execute(select(Hours.id).where(Hours.basis == "exception"))
    assert len(rows.scalars().all()) == 1


async def test_sync_cannot_write_time_off(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_staff.post(
        "/sync/upload",
        json={
            "ops": [
                {
                    "op": "PUT",
                    "type": "hours",
                    "id": "av_sync_off",
                    "data": {
                        "business_id": BIZ,
                        "staff_id": ST_DIEGO,
                        "basis": "exception",
                        "starts_at": "2027-03-02T20:00:00Z",
                        "ends_at": "2027-03-02T22:00:00Z",
                        "available": 0,
                    },
                }
            ]
        },
    )
    assert res.status_code == 403
    assert await db.get(Hours, "av_sync_off") is None
