from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import Factory, FakeEmailSender
from tests.helpers import client_id, new_client

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
NOW = datetime(2030, 1, 1, tzinfo=UTC)


async def _booking(db: AsyncSession, *, status: str = "completed") -> str:
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    sess = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=1),
        capacity=1,
        status="completed",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=sess.id,
        starts_at=sess.starts_at,
        staff_id=ST_OWNER,
        client_id=await client_id(db),
        status=status,
        source="manual",
        price_cents=5000,
        completed_at=NOW,
    )
    db.add(booking)
    await db.flush()
    return booking.id


GOOGLE = "https://g.page/r/example/review"


async def _configure(api: httpx.AsyncClient) -> None:
    response = await api.patch("/v1/business", json={"google_review_url": GOOGLE})
    assert response.status_code == 200, response.text


async def test_request_creates_invitation_and_links_to_google(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _configure(as_owner)
    cid = await new_client(db)
    headers = {"Idempotency-Key": "google-invitation"}
    first = await as_owner.post("/v1/reviews/request", json={"client_id": cid}, headers=headers)
    assert first.status_code == 201, first.text
    body = first.json()
    assert set(body) == {"id", "business_id", "client_id", "booking_id", "requested_at"}
    request = await db.get(ReviewRequest, body["id"])
    assert request is not None and request.business_id == BIZ
    assert any(GOOGLE in message.body for message in email.sent)
    count = len(email.sent)
    replay = await as_owner.post("/v1/reviews/request", json={"client_id": cid}, headers=headers)
    assert replay.json() == body and len(email.sent) == count


async def test_request_needs_google_link(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await as_owner.patch("/v1/business", json={"google_review_url": ""})
    result = await as_owner.post("/v1/reviews/request", json={"client_id": await client_id(db)})
    assert result.status_code == 409


async def test_request_rejects_duplicate_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(as_owner)
    data = {"client_id": await client_id(db), "booking_id": await _booking(db)}
    first = await as_owner.post("/v1/reviews/request", json=data)
    assert first.status_code == 201, first.text
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 409


async def test_request_requires_completed_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(as_owner)
    data = {"client_id": await client_id(db), "booking_id": await _booking(db, status="confirmed")}
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 409


async def test_request_rejects_mismatched_client(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(as_owner)
    data = {"client_id": await new_client(db), "booking_id": await _booking(db)}
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 404


async def test_request_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _configure(as_owner)
    business = await factory.business(name="Other")
    client = await factory.client(business=business)
    assert (
        await as_owner.post("/v1/reviews/request", json={"client_id": client.id})
    ).status_code == 404
    data = {"client_id": await client_id(db), "booking_id": "bk_missing"}
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 404


async def test_request_unknown_client(as_owner: httpx.AsyncClient) -> None:
    await _configure(as_owner)
    assert (
        await as_owner.post("/v1/reviews/request", json={"client_id": "cl_missing"})
    ).status_code == 404


async def test_request_requires_manager(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (
        await as_staff.post("/v1/reviews/request", json={"client_id": await client_id(db)})
    ).status_code == 403


@pytest.mark.parametrize("action", ["publish", "hide", "google", "share", "respond"])
async def test_internal_review_actions_removed(as_owner: httpx.AsyncClient, action: str) -> None:
    assert (await as_owner.post(f"/v1/reviews/rv_old/{action}", json={})).status_code == 404


async def test_internal_review_collection_removed(api: httpx.AsyncClient) -> None:
    assert (await api.get("/review/old-token")).status_code == 404
    assert (
        await api.post("/review/old-token", json={"rating": 5, "body": "Feedback"})
    ).status_code == 404


async def test_google_status_is_unavailable_without_integration(
    as_owner: httpx.AsyncClient,
) -> None:
    response = await as_owner.get("/v1/reviews/google")
    assert response.status_code == 200
    assert response.json() == {
        "state": "unavailable",
        "connection_id": None,
        "generation": 0,
        "location": None,
        "can_request": False,
    }


async def test_google_status_requires_manager(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/reviews/google")).status_code == 403


async def test_google_status_requires_authentication(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/v1/reviews/google")).status_code == 401
