import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.business import Staff
from clientbridge.models.platform import Audit, SyncReceipt
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.schemas.bookings import BookingCreate
from clientbridge.schemas.hours import HoursWeekBody
from clientbridge.services.bookings import BookingService
from clientbridge.services.hours import HoursService
from tests.conftest import BIZ, OWNER_USER, FakePaymentGateway
from tests.helpers import client_id

OWNER = Principal(user_id=OWNER_USER, business_id=BIZ, staff_id="st_owner", role="owner")


def week_body(revision: int = 0, closed: tuple[int, ...] = (5, 6)) -> dict[str, object]:
    return {
        "request": {
            "version": 2,
            "device_id": str(uuid4()),
            "operation_id": str(uuid4()),
            "business_id": BIZ,
            "created_at": datetime.now(UTC).isoformat(),
        },
        "expected_revision": revision,
        "days": [
            {
                "weekday": day,
                "available": day not in closed,
                "start_time": "09:00",
                "end_time": "17:00",
            }
            for day in range(7)
        ],
    }


async def test_week_replay_conflict_and_stable_rows(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    url = "/v1/hours/st_diego/week"
    before = (await as_owner.get(url)).json()
    body = week_body(before["revision"])
    original = list(
        await db.scalars(
            select(Hours.id).where(Hours.staff_id == "st_diego", Hours.basis == "recurring")
        )
    )
    response = await as_owner.post(url, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == before["revision"] + 1
    replay = await as_owner.post(url, json=body)
    assert replay.json() == response.json()
    ids = list(
        await db.scalars(
            select(Hours.id).where(Hours.staff_id == "st_diego", Hours.basis == "recurring")
        )
    )
    assert len(ids) == 7
    assert set(original) <= set(ids)
    stale = await as_owner.post(url, json=week_body(before["revision"]))
    assert stale.status_code == 409
    assert stale.json()["error"] == "hours_revision_conflict"
    changed = {**body, "expected_revision": before["revision"] + 1}
    assert (await as_owner.post(url, json=changed)).status_code == 409


async def test_week_is_self_or_manager_and_tenant_scoped(as_owner: httpx.AsyncClient) -> None:
    response = await as_owner.post("/v1/hours/st_nonexistent/week", json=week_body())
    assert response.status_code == 404
    body = week_body()
    request = body["request"]
    assert isinstance(request, dict)
    request["business_id"] = "bz_foreign"
    assert (await as_owner.post("/v1/hours/st_diego/week", json=body)).status_code == 403


async def test_staff_can_only_edit_their_week(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/hours/st_diego/week")).status_code == 200
    assert (await as_staff.post("/v1/hours/st_owner/week", json=week_body())).status_code == 403
    assert (await as_staff.post("/v1/hours/st_diego/week", json=week_body())).status_code == 200


async def test_week_rejects_missing_duplicate_and_invalid_days(as_owner: httpx.AsyncClient) -> None:
    body = week_body()
    days = body["days"]
    assert isinstance(days, list)
    for replacement in (days[:-1], [days[0]] * 7, [{**days[0], "start_time": "18:00"}, *days[1:]]):
        response = await as_owner.post(
            "/v1/hours/st_diego/week", json={**body, "days": replacement}
        )
        assert response.status_code == 422, response.text


async def test_split_week_is_not_silently_flattened(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    row = await db.scalar(
        select(Hours).where(Hours.staff_id == "st_diego", Hours.basis == "recurring").limit(1)
    )
    assert row is not None
    db.add(
        Hours(
            id="av_split_guard",
            business_id=BIZ,
            staff_id="st_diego",
            basis="recurring",
            weekday=row.weekday,
            start_time=row.start_time,
            end_time=row.end_time,
            available=True,
        )
    )
    await db.flush()
    before = (await as_owner.get("/v1/hours/st_diego/week")).json()
    response = await as_owner.post("/v1/hours/st_diego/week", json=week_body(before["revision"]))
    assert response.status_code == 409
    assert response.json()["error"] == "hours_split_week"


@pytest.mark.parametrize("same_operation", [False, True])
async def test_concurrent_empty_week_edits_have_one_winner(
    db: AsyncSession, same_operation: bool
) -> None:
    import asyncio

    from sqlalchemy import delete

    from clientbridge.core.db import SessionLocal
    from clientbridge.core.deps import Principal
    from clientbridge.core.errors import Conflict
    from clientbridge.core.ids import new_id
    from clientbridge.models.business import Staff
    from clientbridge.models.platform import Audit, SyncReceipt
    from clientbridge.schemas.hours import HoursWeekBody
    from clientbridge.services.hours import HoursService

    staff_id = new_id("staff")
    principal = Principal(user_id="us_dev", business_id=BIZ, staff_id="st_owner", role="owner")
    bodies = [HoursWeekBody.model_validate(week_body()), HoursWeekBody.model_validate(week_body())]
    if same_operation:
        bodies[1] = bodies[0]
    async with SessionLocal() as setup:
        setup.add(Staff(id=staff_id, business_id=BIZ, role="staff", status="active"))
        await setup.commit()

    async def replace(body: HoursWeekBody) -> int | Conflict:
        async with SessionLocal() as session:
            try:
                return (await HoursService(session, principal).replace(staff_id, body)).revision
            except Conflict as error:
                return error

    try:
        results = await asyncio.gather(*(replace(body) for body in bodies))
        assert sum(result == 1 for result in results) == (2 if same_operation else 1)
        assert sum(isinstance(result, Conflict) for result in results) == (
            0 if same_operation else 1
        )
        async with SessionLocal() as check:
            rows = list(await check.scalars(select(Hours).where(Hours.staff_id == staff_id)))
            assert len(rows) == 7
            assert len({row.weekday for row in rows}) == 7
    finally:
        async with SessionLocal() as cleanup:
            await cleanup.execute(
                delete(SyncReceipt).where(
                    SyncReceipt.operation_id.in_(
                        [str(body.request.operation_id) for body in bodies]
                    )
                )
            )
            await cleanup.execute(delete(Audit).where(Audit.entity_id == staff_id))
            await cleanup.execute(delete(Hours).where(Hours.staff_id == staff_id))
            await cleanup.execute(delete(Staff).where(Staff.id == staff_id))
            await cleanup.commit()


async def test_week_body_is_bounded(as_owner: httpx.AsyncClient) -> None:
    response = await as_owner.post("/v1/hours/st_diego/week", content=b" " * (256 * 1024 + 1))
    assert response.status_code == 413


async def test_direct_crud_endpoint_is_absent(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/sync/upload", json={"ops": []})).status_code == 404


async def _visit(api: httpx.AsyncClient, db: AsyncSession, staff: str, starts: str) -> str:
    res = await api.post(
        "/v1/bookings",
        json={
            "client_id": await client_id(db),
            "item_id": "it_groom_sm",
            "staff_id": staff,
            "starts_at": starts,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


async def test_week_reports_the_visits_it_strands(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    tuesday = await _visit(as_owner, db, "st_diego", "2027-03-02T18:00:00Z")
    late = await _visit(as_owner, db, "st_diego", "2027-03-03T22:00:00Z")
    inside = await _visit(as_owner, db, "st_diego", "2027-03-04T18:00:00Z")
    canceled = await _visit(as_owner, db, "st_diego", "2027-03-09T18:00:00Z")
    assert (
        await as_owner.patch(f"/v1/bookings/{canceled}", json={"status": "canceled"})
    ).status_code == 200
    other = await _visit(as_owner, db, "st_priya", "2027-03-02T18:00:00Z")
    url = "/v1/hours/st_diego/week"
    body = week_body((await as_owner.get(url)).json()["revision"], closed=(1,))
    days = body["days"]
    assert isinstance(days, list)
    days[2] = {**days[2], "end_time": "14:00"}
    response = await as_owner.post(url, json=body)
    assert response.status_code == 200, response.text
    stranded = response.json()["stranded"]
    assert stranded.index(tuesday) < stranded.index(late)
    assert not {inside, canceled, other} & set(stranded)
    replay = await as_owner.post(url, json=body)
    assert replay.json() == response.json()


async def test_week_does_not_strand_visits_already_past(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    visit = await _visit(as_owner, db, "st_diego", "2027-03-02T18:00:00Z")
    booking = await db.get(Booking, visit)
    assert booking is not None
    slot = await db.get(Slot, booking.slot_id)
    assert slot is not None
    past = datetime.now(UTC) - timedelta(days=7)
    slot.starts_at, slot.ends_at = past, past + timedelta(minutes=75)
    booking.starts_at = past
    await db.flush()
    url = "/v1/hours/st_diego/week"
    body = week_body((await as_owner.get(url)).json()["revision"], closed=tuple(range(7)))
    response = await as_owner.post(url, json=body)
    assert response.status_code == 200, response.text
    assert visit not in response.json()["stranded"]


async def test_a_booking_racing_an_hours_change_is_refused_or_stranded(db: AsyncSession) -> None:
    client = await client_id(db)
    members: list[str] = []
    bodies: list[HoursWeekBody] = []
    booked: list[str] = []

    async def book(staff_id: str, ready: asyncio.Barrier) -> str | Conflict:
        async with SessionLocal() as session:
            service = BookingService(session, OWNER, FakePaymentGateway())
            await ready.wait()
            try:
                out = await service.create(
                    BookingCreate(
                        client_id=client,
                        item_id="it_groom_sm",
                        staff_id=staff_id,
                        starts_at=datetime(2027, 5, 4, 16, tzinfo=UTC),
                    ),
                    None,
                )
            except Conflict as exc:
                return exc
            booked.append(out.id)
            return out.id

    async def close(staff_id: str, ready: asyncio.Barrier, lag: float) -> list[str]:
        body = HoursWeekBody.model_validate(week_body(closed=tuple(range(7))))
        bodies.append(body)
        async with SessionLocal() as session:
            service = HoursService(session, OWNER)
            await ready.wait()
            await asyncio.sleep(lag)
            return (await service.replace(staff_id, body)).stranded

    try:
        # the lag sweeps the week change across the booking's check-then-write window
        for lag in (0, 0.002, 0.005, 0.01, 0.02):
            staff_id = new_id("staff")
            members.append(staff_id)
            async with SessionLocal() as setup:
                setup.add(Staff(id=staff_id, business_id=BIZ, role="staff", status="active"))
                await setup.commit()
            ready = asyncio.Barrier(2)
            result, stranded = await asyncio.gather(
                book(staff_id, ready), close(staff_id, ready, lag), return_exceptions=True
            )
            if isinstance(stranded, BaseException):
                raise stranded
            assert isinstance(result, Conflict) or stranded == [result], lag
    finally:
        async with SessionLocal() as cleanup:
            slots = list(
                await cleanup.scalars(select(Booking.slot_id).where(Booking.id.in_(booked)))
            )
            await cleanup.execute(delete(Booking).where(Booking.id.in_(booked)))
            await cleanup.execute(delete(Slot).where(Slot.id.in_(slots)))
            await cleanup.execute(
                delete(SyncReceipt).where(
                    SyncReceipt.operation_id.in_([str(b.request.operation_id) for b in bodies])
                )
            )
            await cleanup.execute(delete(Audit).where(Audit.entity_id.in_(members + booked)))
            await cleanup.execute(delete(Hours).where(Hours.staff_id.in_(members)))
            await cleanup.execute(delete(Staff).where(Staff.id.in_(members)))
            await cleanup.commit()
