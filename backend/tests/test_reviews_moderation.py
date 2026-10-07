from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Subject
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.reviews import build_review_request
from tests.conftest import Factory
from tests.helpers import client_id, ok

BIZ = "bz_birchbark"
GOOGLE = "https://g.page/r/birchbark/review"
NOW = datetime(2030, 1, 1, tzinfo=UTC)


async def _request(db: AsyncSession, *, booking_id: str | None = None) -> str:
    request = build_review_request(BIZ, await client_id(db), booking_id, NOW)
    db.add(request)
    await db.flush()
    assert request.token
    return request.token


async def _visit(db: AsyncSession) -> str:
    cid = await client_id(db)
    item = (await db.execute(select(Item).where(Item.business_id == BIZ).limit(1))).scalar_one()
    pet = Subject(id=new_id("subject"), business_id=BIZ, client_id=cid, kind="pet", name="Biscuit")
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item.id,
        staff_id="st_owner",
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=1),
        capacity=1,
        status="completed",
    )
    db.add_all([pet, slot])
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        staff_id="st_owner",
        client_id=cid,
        subject_id=pet.id,
        status="completed",
        source="manual",
        price_cents=5000,
        completed_at=NOW,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def _set_google(db: AsyncSession, url: str | None = GOOGLE) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(google_review_url=url))
    await db.flush()


async def _status(db: AsyncSession, token: str) -> str:
    return (await db.execute(select(Review.status).where(Review.token == token))).scalar_one()


async def test_low_rating_waits_for_the_owner(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _set_google(db)
    token = await _request(db)
    body = ok(await api.post(f"/review/{token}", json={"rating": 3})).json()
    assert body["completed"] is True and body["published"] is False
    assert body["google_review_url"] is None  # never offered while the review is held
    assert await _status(db, token) == "submitted"


async def test_high_rating_publishes_and_offers_google(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_google(db)
    token = await _request(db)
    body = ok(await api.post(f"/review/{token}", json={"rating": 4})).json()
    assert body["published"] is True and body["google_review_url"] == GOOGLE
    assert await _status(db, token) == "published"


async def test_hold_setting_zero_publishes_everything(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    ok(await as_owner.patch("/v1/business", json={"review_hold_at": 0}))
    token = await _request(db)
    ok(await as_owner.post(f"/review/{token}", json={"rating": 1}))
    assert await _status(db, token) == "published"


async def test_public_context_names_the_visit(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _request(db, booking_id=await _visit(db))
    body = ok(await api.get(f"/review/{token}")).json()
    assert body["pet"] == "Biscuit" and body["service"] and body["first_name"]
    assert body["staff"] is not None


async def test_review_settings_validate(as_owner: httpx.AsyncClient) -> None:
    saved = ok(
        await as_owner.patch(
            "/v1/business", json={"review_hold_at": 2, "google_review_url": GOOGLE}
        )
    ).json()
    assert (saved["review_hold_at"], saved["google_review_url"]) == (2, GOOGLE)
    bad_link = await as_owner.patch("/v1/business", json={"google_review_url": "g.page/x"})
    assert bad_link.status_code == 422
    assert (await as_owner.patch("/v1/business", json={"review_hold_at": 6})).status_code == 422
    cleared = ok(await as_owner.patch("/v1/business", json={"google_review_url": ""}))
    assert cleared.json()["google_review_url"] is None


async def _published(db: AsyncSession, *, business_id: str = BIZ) -> str:
    review = Review(
        id=new_id("review"),
        business_id=business_id,
        client_id=await client_id(db, business_id=business_id),
        rating=5,
        status="published",
    )
    db.add(review)
    await db.flush()
    return review.id


async def test_share_returns_the_google_link(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _set_google(db)
    rid = await _published(db)
    body = ok(await as_owner.post(f"/v1/reviews/{rid}/share")).json()
    assert body["google_review_url"] == GOOGLE and body["review"]["sent_to_google"] is True
    again = ok(await as_owner.post(f"/v1/reviews/{rid}/share")).json()
    assert again["review"]["sent_to_google"] is True  # sharing twice is harmless


async def test_share_needs_a_google_link(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _set_google(db, None)
    rid = await _published(db)
    assert (await as_owner.post(f"/v1/reviews/{rid}/share")).status_code == 409


async def test_share_refuses_a_held_review(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _set_google(db)
    rid = await _published(db)
    await db.execute(update(Review).where(Review.id == rid).values(status="submitted"))
    await db.flush()
    assert (await as_owner.post(f"/v1/reviews/{rid}/share")).status_code == 409


async def test_staff_cannot_share(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _set_google(db)
    rid = await _published(db)
    assert (await as_staff.post(f"/v1/reviews/{rid}/share")).status_code == 403


async def test_share_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _set_google(db)
    other = await factory.business(name="Rival Reviews")
    await factory.client(business=other)
    rid = await _published(db, business_id=other.id)
    assert (await as_owner.post(f"/v1/reviews/{rid}/share")).status_code == 404


async def test_share_needs_a_session_401(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    rid = await _published(db)
    assert (await unauth.post(f"/v1/reviews/{rid}/share")).status_code == 401
