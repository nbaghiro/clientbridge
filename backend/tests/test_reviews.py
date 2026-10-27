from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Delivery
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.consents import record_consent, record_text_reply
from clientbridge.services.deliveries import run_deliveries
from tests.conftest import Factory, FakeEmailSender, FakePushSender, FakeSmsSender
from tests.google_business import configure_google_review_profile, review_texts
from tests.helpers import client_id, new_client, queued_subjects

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
NOW = datetime(2030, 1, 1, tzinfo=UTC)


async def _booking(db: AsyncSession, client: str, *, status: str = "completed") -> str:
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
        client_id=client,
        status=status,
        source="manual",
        price_cents=5000,
        completed_at=NOW,
    )
    db.add(booking)
    await db.flush()
    return booking.id


GOOGLE = "https://g.page/r/1/review"


async def _configure(db: AsyncSession, url: str | None = GOOGLE) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    await configure_google_review_profile(db, url is not None)
    await db.flush()


async def test_request_creates_invitation_and_links_to_google(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender
) -> None:
    await _configure(db)
    cid = await new_client(db)
    await db.execute(update(Client).where(Client.id == cid).values(phone="+16045550288"))
    headers = {"Idempotency-Key": "google-invitation"}
    first = await as_owner.post("/v1/reviews/request", json={"client_id": cid}, headers=headers)
    assert first.status_code == 201, first.text
    body = first.json()
    assert set(body) == {"id", "business_id", "client_id", "booking_id", "requested_at"}
    request = await db.get(ReviewRequest, body["id"])
    assert request is not None and request.business_id == BIZ
    assert any(GOOGLE in message.body for message in await review_texts(db))
    assert email.sent == []
    [notice] = await queued_subjects(db, f"review:{body['id']}")
    assert GOOGLE in notice
    assert sms.sent == []
    count = len(await review_texts(db))
    replay = await as_owner.post("/v1/reviews/request", json={"client_id": cid}, headers=headers)
    assert replay.json() == body and len(await review_texts(db)) == count and sms.sent == []


async def test_request_waits_thirty_days_per_client(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db)
    cid = await new_client(db)
    first = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert first.status_code == 201, first.text
    again = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert again.status_code == 409
    assert again.json()["error"] == "review_recently_requested"
    await db.execute(
        update(ReviewRequest)
        .where(ReviewRequest.client_id == cid)
        .values(requested_at=ReviewRequest.requested_at - timedelta(days=31))
    )
    later = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert later.status_code == 201, later.text


async def test_invitation_skips_text_after_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender
) -> None:
    await _configure(db)
    cid = await new_client(db)
    await db.execute(update(Client).where(Client.id == cid).values(phone="+16045550188"))
    await record_consent(db, BIZ, cid, status="withdrawn", source="reply", recorded_by=None)
    sent = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert sent.status_code == 201, sent.text
    assert email.sent == []
    assert not any(GOOGLE in text.body for text in await review_texts(db))


async def test_a_queued_invitation_text_is_dropped_after_a_stop(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    await _configure(db)
    cid = await new_client(db, phone="+16045551289")
    sent = await as_owner.post("/v1/reviews/request", json={"client_id": cid})
    assert sent.status_code == 201, sent.text
    client = await db.get(Client, cid)
    assert client is not None
    await record_text_reply(db, client, stop=True)
    await db.commit()
    await run_deliveries(db, email, sms, push)
    rows = list(
        await db.scalars(
            select(Delivery).where(Delivery.key.startswith(f"review:{sent.json()['id']}:"))
        )
    )
    assert [(r.state, r.error) for r in rows] == [("failed", "consent_withdrawn")]
    assert not any(t.to == "+16045551289" for t in sms.sent)


async def test_business_update_no_longer_sets_the_review_link(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db, None)
    response = await as_owner.patch(
        "/v1/business", json={"google_review_url": "https://example.com/not-google"}
    )
    assert response.status_code == 200, response.text
    business = await db.get(Business, BIZ)
    assert business is not None
    await db.refresh(business)
    assert "google_review_url" not in response.json()


async def test_managers_turn_automatic_requests_off_and_manual_ones_still_send(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db)
    off = await as_owner.patch("/v1/business", json={"review_requests_enabled": False})
    assert off.status_code == 200, off.text
    assert off.json()["review_requests_enabled"] is False
    kept = await as_owner.patch("/v1/business", json={"review_requests_enabled": None})
    assert kept.json()["review_requests_enabled"] is False
    sent = await as_owner.post("/v1/reviews/request", json={"client_id": await new_client(db)})
    assert sent.status_code == 201, sent.text


async def test_staff_cannot_change_automatic_requests(as_staff: httpx.AsyncClient) -> None:
    denied = await as_staff.patch("/v1/business", json={"review_requests_enabled": False})
    assert denied.status_code == 403


async def test_request_needs_google_link(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _configure(db, None)
    result = await as_owner.post("/v1/reviews/request", json={"client_id": await client_id(db)})
    assert result.status_code == 409


async def test_request_rejects_duplicate_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db)
    cid = await new_client(db)
    data = {"client_id": cid, "booking_id": await _booking(db, cid)}
    first = await as_owner.post("/v1/reviews/request", json=data)
    assert first.status_code == 201, first.text
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 409


async def test_request_requires_completed_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db)
    cid = await new_client(db)
    data = {"client_id": cid, "booking_id": await _booking(db, cid, status="confirmed")}
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 409


async def test_request_rejects_mismatched_client(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _configure(db)
    data = {
        "client_id": await new_client(db),
        "booking_id": await _booking(db, await new_client(db, name="Other Client")),
    }
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 404


async def test_request_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _configure(db)
    business = await factory.business(name="Other")
    client = await factory.client(business=business)
    assert (
        await as_owner.post("/v1/reviews/request", json={"client_id": client.id})
    ).status_code == 404
    data = {"client_id": await client_id(db), "booking_id": "bk_missing"}
    assert (await as_owner.post("/v1/reviews/request", json=data)).status_code == 404


async def test_request_unknown_client(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _configure(db)
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clientbridge.core.config import get_settings

    monkeypatch.setattr(get_settings(), "google_business_enabled", False)
    response = await as_owner.get("/v1/reviews/google")
    assert response.status_code == 200
    assert response.json() == {
        "state": "unavailable",
        "connection_id": None,
        "generation": 0,
        "location": None,
        "can_request": False,
        "error_code": None,
    }


async def test_google_status_requires_manager(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/reviews/google")).status_code == 403


async def test_google_status_requires_authentication(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.get("/v1/reviews/google")).status_code == 401


pytestmark = pytest.mark.usefixtures("google_review_provider")
