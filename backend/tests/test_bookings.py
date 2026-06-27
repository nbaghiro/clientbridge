import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client

ST_OWNER = "st_owner"


async def _client_and_item(db: AsyncSession) -> tuple[str, str]:
    client_id = (await db.execute(select(Client.id).limit(1))).scalars().first()
    item_id = (
        (await db.execute(select(Item.id).where(Item.duration_min.isnot(None)).limit(1)))
        .scalars()
        .first()
    )
    assert client_id and item_id
    return client_id, item_id


def _body(client_id: str, item_id: str, starts: str, staff: str = ST_OWNER) -> dict[str, str]:
    return {"client_id": client_id, "item_id": item_id, "staff_id": staff, "starts_at": starts}


async def test_create_booking(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-01T10:00:00Z")
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "confirmed"
    assert body["staff_id"] == ST_OWNER
    assert body["ends_at"] > body["starts_at"]


async def test_double_book_conflicts(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-02T10:00:00Z")
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 409


async def test_cancel_frees_the_slot(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-03T10:00:00Z")
    bid = (await as_owner.post("/v1/bookings", json=body)).json()["id"]
    canceled = await as_owner.patch(f"/v1/bookings/{bid}", json={"status": "canceled"})
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert (await as_owner.post("/v1/bookings", json=body)).status_code == 201


async def test_reschedule_moves_session(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    created = await as_owner.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-04T10:00:00Z")
    )
    bid = created.json()["id"]
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-03-04T14:00:00Z"})
    assert moved.status_code == 200
    assert moved.json()["starts_at"].startswith("2027-03-04T14:00")


async def test_staff_cannot_book_another_staff(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await as_staff.post(
        "/v1/bookings", json=_body(client_id, item_id, "2027-03-05T10:00:00Z", ST_OWNER)
    )
    assert res.status_code == 403


async def test_unauth_cannot_book(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    res = await unauth.post("/v1/bookings", json=_body(client_id, item_id, "2027-03-06T10:00:00Z"))
    assert res.status_code == 401


async def test_unknown_client_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    _, item_id = await _client_and_item(db)
    res = await as_owner.post(
        "/v1/bookings", json=_body("cl_nope", item_id, "2027-03-07T10:00:00Z")
    )
    assert res.status_code == 404


async def test_idempotent_create_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    client_id, item_id = await _client_and_item(db)
    body = _body(client_id, item_id, "2027-03-08T10:00:00Z")
    headers = {"Idempotency-Key": "bk-test-1"}
    first = await as_owner.post("/v1/bookings", json=body, headers=headers)
    second = await as_owner.post("/v1/bookings", json=body, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
