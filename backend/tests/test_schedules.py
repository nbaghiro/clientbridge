from datetime import date, datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.scheduling import Session
from clientbridge.services.schedule_service import expand_occurrences

ST_OWNER = "st_owner"
ST_PRIYA = "st_priya"  # seeded staff with no availability rows → unconfigured (all hours open)


# ── expand_occurrences (pure) ─────────────────────────────────────────────────────────────────


def test_expand_weekly_count() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 1), frequency="weekly", interval=1, byday=None, count=4, until=None
    )
    assert out == [date(2027, 3, 1), date(2027, 3, 8), date(2027, 3, 15), date(2027, 3, 22)]


def test_expand_weekly_byday() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 1),  # a Monday
        frequency="weekly",
        interval=1,
        byday=["MO", "WE"],
        count=4,
        until=None,
    )
    assert [d.weekday() for d in out] == [0, 2, 0, 2]
    assert out[0] == date(2027, 3, 1)


def test_expand_daily_interval() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 1), frequency="daily", interval=2, byday=None, count=3, until=None
    )
    assert out == [date(2027, 3, 1), date(2027, 3, 3), date(2027, 3, 5)]


def test_expand_monthly_clamps_short_months() -> None:
    out = expand_occurrences(
        start_date=date(2027, 1, 31),
        frequency="monthly",
        interval=1,
        byday=None,
        count=3,
        until=None,
    )
    assert out == [date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31)]


def test_expand_until_bounds() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 1),
        frequency="weekly",
        interval=1,
        byday=None,
        count=None,
        until=date(2027, 3, 15),
    )
    assert out == [date(2027, 3, 1), date(2027, 3, 8), date(2027, 3, 15)]


def test_expand_caps_unbounded() -> None:
    out = expand_occurrences(
        start_date=date(2027, 3, 1),
        frequency="daily",
        interval=1,
        byday=None,
        count=None,
        until=None,
    )
    assert len(out) == 60  # the hard cap


# ── POST /v1/schedules (command + expansion) ──────────────────────────────────────────────────


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


def _body(client_id: str, item_id: str, **over: object) -> dict[str, object]:
    body: dict[str, object] = {
        "client_id": client_id,
        "item_id": item_id,
        "staff_id": ST_PRIYA,
        "starts_at": "2027-03-01T10:00:00Z",
        "frequency": "weekly",
        "count": 8,
    }
    body.update(over)
    return body


async def _session_count(db: AsyncSession, schedule_id: str) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(Session).where(Session.recurrence_id == schedule_id)
        )
    ).scalar_one()


async def test_weekly_series_creates_bookings(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post("/v1/schedules", json=_body(client_id, item_id))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["created"] == 8
    assert body["skipped"] == 0
    assert len(body["occurrences"]) == 8
    # every occurrence became a session stamped with the schedule's id
    assert await _session_count(db, body["id"]) == 8
    # occurrences are one week apart
    first = datetime.fromisoformat(body["occurrences"][0]["starts_at"])
    second = datetime.fromisoformat(body["occurrences"][1]["starts_at"])
    assert (second - first).days == 7


async def test_series_skips_conflicting_occurrence(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    # pre-book the 2nd weekly slot so the series has to skip it
    pre = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": client_id,
            "item_id": item_id,
            "staff_id": ST_PRIYA,
            "starts_at": "2027-03-08T10:00:00Z",
        },
    )
    assert pre.status_code == 201, pre.text

    res = await as_owner.post("/v1/schedules", json=_body(client_id, item_id, count=3))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["created"] == 2
    assert body["skipped"] == 1
    skipped = [o for o in body["occurrences"] if o["booking_id"] is None]
    assert len(skipped) == 1
    assert skipped[0]["skipped"] is not None
    # the series row plus its two clear occurrences, not the clashing one
    assert await _session_count(db, body["id"]) == 2


async def test_unbounded_series_rejected(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, frequency="daily")
    del body["count"]  # no count and no until → must be rejected
    res = await as_owner.post("/v1/schedules", json=body)
    assert res.status_code == 422


async def test_staff_cannot_schedule_for_others(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_staff.post("/v1/schedules", json=_body(client_id, item_id, staff_id=ST_OWNER))
    assert res.status_code == 403


async def test_series_is_idempotent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    headers = {"Idempotency-Key": "sched-key-1"}
    first = await as_owner.post("/v1/schedules", json=_body(client_id, item_id), headers=headers)
    second = await as_owner.post("/v1/schedules", json=_body(client_id, item_id), headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    # the replay must not create a second series
    assert await _session_count(db, first.json()["id"]) == 8
