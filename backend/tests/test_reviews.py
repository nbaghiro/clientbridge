from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_review_rate_limit
from clientbridge.main import app
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.reviews import Review, ReviewRequest
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services.review_service import build_review_request
from tests.conftest import Factory, FakeEmailSender

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
NOW = datetime(2030, 1, 1, tzinfo=UTC)


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _fresh_client(db: AsyncSession, *, email: str = "rev@example.ca") -> str:
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Review Client",
        email=email,
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client.id


async def _booking(db: AsyncSession, *, status: str = "completed") -> str:
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    sess = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=1),
        capacity=1,
        booked_count=1,
        status="completed",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=sess.id,
        staff_id=ST_OWNER,
        client_id=await _client_id(db),
        status=status,
        source="manual",
        price_cents=5000,
        completed_at=NOW,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def _a_review(
    db: AsyncSession, *, business_id: str = BIZ, rating: int = 5, status: str = "published"
) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == business_id).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    review = Review(
        id=new_id("review"),
        business_id=business_id,
        client_id=cid,
        rating=rating,
        status=status,
    )
    db.add(review)
    await db.flush()
    return review.id


async def _a_request(db: AsyncSession, *, booking_id: str | None = None) -> str:
    request = build_review_request(BIZ, await _client_id(db), booking_id, NOW)
    db.add(request)
    await db.flush()
    return request.token


async def test_request_creates_request_and_notifies(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _fresh_client(db)
    res = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "sent" and body["token"]
    row = (
        await db.execute(select(ReviewRequest).where(ReviewRequest.id == body["id"]))
    ).scalar_one()
    assert row.business_id == BIZ and row.sent_at is not None
    assert any(f"/review/{body['token']}" in m.body for m in email.sent)


async def test_request_rejects_duplicate_open_for_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_id(db)
    bid = await _booking(db)
    first = await as_owner.post("/v1/reviews/request", json={"client_id": cid, "booking_id": bid})
    assert first.status_code == 201, first.text
    dup = await as_owner.post("/v1/reviews/request", json={"client_id": cid, "booking_id": bid})
    assert dup.status_code == 409


async def test_request_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/reviews/request", json={"client_id": "cl_nope"})
    assert res.status_code == 404


async def test_request_requires_admin(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    assert (await as_staff.post("/v1/reviews/request", json={"client_id": cid})).status_code == 403


async def test_public_get_returns_context(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_request(db)
    body = (await api.get(f"/review/{token}")).json()
    assert body["business_name"] and body["completed"] is False


async def test_public_submit_creates_published_review(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db)
    token = await _a_request(db, booking_id=bid)
    res = await api.post(f"/review/{token}", json={"rating": 5, "body": "Great!"})
    assert res.status_code == 200, res.text
    assert res.json()["completed"] is True and res.json()["rating"] == 5
    request = (
        await db.execute(select(ReviewRequest).where(ReviewRequest.token == token))
    ).scalar_one()
    assert request.status == "completed" and request.review_id is not None
    review = (await db.execute(select(Review).where(Review.id == request.review_id))).scalar_one()
    assert review.status == "published" and review.rating == 5 and review.booking_id == bid


async def test_public_second_submit_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_request(db)
    assert (await api.post(f"/review/{token}", json={"rating": 4})).status_code == 200
    assert (await api.post(f"/review/{token}", json={"rating": 4})).status_code == 409


async def test_public_bad_rating_422(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_request(db)
    assert (await api.post(f"/review/{token}", json={"rating": 6})).status_code == 422
    assert (await api.post(f"/review/{token}", json={"rating": 0})).status_code == 422


async def test_public_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/review/nope")).status_code == 404
    assert (await api.post("/review/nope", json={"rating": 5})).status_code == 404


async def test_public_get_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_review_rate_limit] = limited
    token = await _a_request(db)
    assert (await api.get(f"/review/{token}")).status_code == 200
    assert (await api.get(f"/review/{token}")).status_code == 429


async def test_respond_sets_response_and_timestamp(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = await _a_review(db)
    body = (
        await as_owner.post(f"/v1/reviews/{rid}/respond", json={"response": "Thank you!"})
    ).json()
    assert body["response"] == "Thank you!" and body["responded_at"] is not None


async def test_hide_then_publish_toggles_status(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    rid = await _a_review(db)
    assert (await as_owner.post(f"/v1/reviews/{rid}/hide")).json()["status"] == "hidden"
    assert (await as_owner.post(f"/v1/reviews/{rid}/publish")).json()["status"] == "published"


async def test_mark_sent_to_google(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    rid = await _a_review(db)
    assert (await as_owner.post(f"/v1/reviews/{rid}/google")).json()["sent_to_google"] is True


async def test_moderation_requires_admin(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    rid = await _a_review(db)
    assert (await as_staff.post(f"/v1/reviews/{rid}/hide")).status_code == 403


async def test_moderation_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Reviews")
    await factory.client(business=other)
    rid = await _a_review(db, business_id=other.id)
    assert (await as_owner.post(f"/v1/reviews/{rid}/hide")).status_code == 404


async def test_summary_counts_published_only(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    base = (
        await db.execute(
            select(func.count()).select_from(
                select(Review.id)
                .where(Review.business_id == BIZ, Review.status == "published")
                .subquery()
            )
        )
    ).scalar_one()
    await _a_review(db, rating=4, status="published")
    await _a_review(db, rating=2, status="published")
    await _a_review(db, rating=1, status="hidden")  # excluded from the rollup
    body = (await as_owner.get("/v1/reviews/summary")).json()
    assert body["count"] == base + 2
    assert body["average"] is not None
