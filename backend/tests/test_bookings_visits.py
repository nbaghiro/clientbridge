from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import Factory

BIZ = "bz_birchbark"
START = datetime(2023, 3, 6, 15, tzinfo=UTC)


async def _visit(db: AsyncSession, name: str, staff: str, client: str, start: datetime) -> None:
    db.add(
        Slot(
            id=f"ss_{name}",
            business_id=BIZ,
            item_id="it_bath",
            staff_id=staff,
            starts_at=start,
            ends_at=start + timedelta(hours=1),
            capacity=1,
            status="completed",
        )
    )
    await db.flush()
    db.add(
        Booking(
            id=f"bk_{name}",
            business_id=BIZ,
            slot_id=f"ss_{name}",
            starts_at=start,
            staff_id=staff,
            client_id=client,
            status="completed",
        )
    )
    await db.flush()


async def _client_with_visits(db: AsyncSession) -> str:
    business = await db.get(Business, BIZ)
    assert business is not None
    client = await Factory(db).client(business=business, name="Old Regular")
    await _visit(db, "a", "st_owner", client.id, START)
    await _visit(db, "b", "st_diego", client.id, START + timedelta(days=7))
    await _visit(db, "c", "st_owner", client.id, START + timedelta(days=14))
    await _visit(db, "later", "st_owner", client.id, START + timedelta(days=900))
    return client.id


async def test_older_visits_page_newest_first(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_visits(db)
    before = (START + timedelta(days=30)).isoformat()
    first = await as_owner.get(
        "/v1/bookings/visits", params={"client_id": cid, "before": before, "limit": 2}
    )
    assert first.status_code == 200, first.text
    page = first.json()
    assert [v["id"] for v in page["visits"]] == ["bk_c", "bk_b"]
    assert page["more"] is True
    assert page["completed"] == 3
    assert page["last_completed_at"].startswith("2023-03-20")
    assert page["visits"][0]["item_name"] and page["visits"][1]["staff_name"]
    last = page["visits"][-1]
    rest = await as_owner.get(
        "/v1/bookings/visits",
        params={"client_id": cid, "before": last["starts_at"], "before_id": last["id"]},
    )
    assert [v["id"] for v in rest.json()["visits"]] == ["bk_a"]
    assert rest.json()["more"] is False


async def test_staff_read_only_their_own_older_visits(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_visits(db)
    res = await as_staff.get(
        "/v1/bookings/visits",
        params={"client_id": cid, "before": (START + timedelta(days=30)).isoformat()},
    )
    assert res.status_code == 200, res.text
    assert [v["id"] for v in res.json()["visits"]] == ["bk_b"]
    assert res.json()["completed"] == 1


async def test_visits_of_another_business_client_are_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    other = await Factory(db).business()
    client = await Factory(db).client(business=other)
    res = await as_owner.get(
        "/v1/bookings/visits", params={"client_id": client.id, "before": START.isoformat()}
    )
    assert res.status_code == 404


async def test_visits_require_auth_and_a_bounded_page(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_with_visits(db)
    params = {"client_id": cid, "before": START.isoformat()}
    assert (
        await as_owner.get("/v1/bookings/visits", params={**params, "limit": 0})
    ).status_code == 422
    assert (await as_owner.get("/v1/bookings/visits", params={"client_id": cid})).status_code == 422
    unauth.headers.pop("Authorization", None)
    assert (await unauth.get("/v1/bookings/visits", params=params)).status_code == 401
