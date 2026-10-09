from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.scheduling import Hours
from tests.conftest import BIZ


def week_body(revision: int = 0) -> dict[str, object]:
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
            {"weekday": day, "available": day < 5, "start_time": "09:00", "end_time": "17:00"}
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
    assert response.json() == {"revision": before["revision"] + 1}
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
