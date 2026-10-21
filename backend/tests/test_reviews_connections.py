from typing import Literal
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.integrations.google_business import (
    GoogleReply,
    get_google_business_gateway,
    get_google_flow_store,
    get_google_secret_store,
)
from clientbridge.main import app
from clientbridge.services.reviews import run_google_operations
from tests.conftest import Factory, FakeIdentityProvider, session_token
from tests.google_business import FakeFlows, FakeGoogle, FakeVault


@pytest.fixture
async def google(
    as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> tuple[FakeGoogle, FakeVault, FakeFlows]:
    settings = get_settings()
    for name, value in {
        "google_business_enabled": True,
        "google_business_client_id": "id",
        "google_business_client_secret": "secret",
        "google_business_kms_key": "key",
        "google_business_redirect_uri": "http://test/callback",
    }.items():
        monkeypatch.setattr(settings, name, value)
    gateway, vault, flows = FakeGoogle(), FakeVault(), FakeFlows()
    app.dependency_overrides[get_google_business_gateway] = lambda: gateway
    app.dependency_overrides[get_google_secret_store] = lambda: vault
    app.dependency_overrides[get_google_flow_store] = lambda: flows
    return gateway, vault, flows


async def connect(api: httpx.AsyncClient) -> dict[str, object]:
    start = await api.post("/v1/reviews/google/authorization", json={"platform": "web"})
    assert start.status_code == 200, start.text
    flow = start.json()
    state = parse_qs(urlsplit(flow["authorization_url"]).query)["state"][0]
    callback = await api.get("/v1/reviews/google/callback", params={"state": state, "code": "code"})
    assert callback.status_code == 303, callback.text
    complete = await api.post(
        "/v1/reviews/google/authorization/complete", json={"flow_token": flow["flow_token"]}
    )
    assert complete.json() == {"state": "complete"}, complete.text
    status = (await api.get("/v1/reviews/google")).json()
    assert status["state"] == "selecting"
    chosen = await api.post(
        "/v1/reviews/google/location",
        json={
            "account_name": "accounts/1",
            "location_name": "locations/1",
            "generation": status["generation"],
        },
    )
    assert chosen.status_code == 200, chosen.text
    return chosen.json()


async def test_google_connect_read_reply_disconnect(
    as_owner: httpx.AsyncClient, db: AsyncSession, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    assert (await as_owner.get("/v1/reviews/google")).json()["state"] == "disconnected"
    status = await connect(as_owner)
    assert status["state"] == "active" and status["can_request"] is True
    read = await as_owner.get("/v1/reviews/google/reviews")
    assert read.status_code == 200 and read.json()["total_count"] == 1, read.text
    headers = {"Idempotency-Key": "reply1"}
    body = {"review_id": "1", "comment": "Thank you", "expected_reply_revision": None}
    reply = await as_owner.post("/v1/reviews/google/replies", json=body, headers=headers)
    assert reply.status_code == 200, reply.text
    assert reply.json()["state"] == "queued"
    assert (
        await as_owner.post("/v1/reviews/google/replies", json=body, headers=headers)
    ).json() == reply.json()
    await run_google_operations(db, *google)
    result = await as_owner.get(f"/v1/reviews/google/operations/{reply.json()['id']}")
    assert result.json()["state"] == "confirmed", result.text
    disconnected = await as_owner.post(
        "/v1/reviews/google/disconnect", json={"generation": status["generation"]}
    )
    assert disconnected.json()["state"] == "disconnected"
    assert (await as_owner.get("/v1/reviews/google/reviews")).status_code == 409


async def test_google_callback_is_single_use(
    as_owner: httpx.AsyncClient, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    start = (
        await as_owner.post("/v1/reviews/google/authorization", json={"platform": "web"})
    ).json()
    state = parse_qs(urlsplit(start["authorization_url"]).query)["state"][0]
    params = {"state": state, "code": "code"}
    assert (await as_owner.get("/v1/reviews/google/callback", params=params)).status_code == 303
    assert (await as_owner.get("/v1/reviews/google/callback", params=params)).status_code == 409


async def test_google_rejects_stale_selection_and_wrong_location(
    as_owner: httpx.AsyncClient, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    status = await connect(as_owner)
    stale = await as_owner.post(
        "/v1/reviews/google/location",
        json={"account_name": "accounts/1", "location_name": "locations/1", "generation": 1},
    )
    assert stale.status_code == 409
    wrong = await as_owner.post(
        "/v1/reviews/google/location",
        json={
            "account_name": "accounts/1",
            "location_name": "locations/elsewhere",
            "generation": status["generation"],
        },
    )
    assert wrong.status_code == 403


async def test_disconnect_cancels_reply_and_erases_payload(
    as_owner: httpx.AsyncClient, db: AsyncSession, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    from clientbridge.models.reviews import GoogleBusinessConnection, GoogleBusinessOperation

    status = await connect(as_owner)
    queued = await as_owner.post(
        "/v1/reviews/google/replies",
        headers={"Idempotency-Key": "cancel"},
        json={"review_id": "1", "comment": "Private draft"},
    )
    assert queued.status_code == 200
    disconnected = await as_owner.post(
        "/v1/reviews/google/disconnect", json={"generation": status["generation"]}
    )
    assert disconnected.status_code == 200
    await run_google_operations(db, *google)
    row = await db.get(GoogleBusinessOperation, queued.json()["id"])
    assert row is not None and row.state == "canceled" and row.request_ciphertext is None
    connection = await db.get(GoogleBusinessConnection, status["connection_id"])
    assert connection is not None and connection.refresh_token_ciphertext is None
    assert google[0].reply is None


async def test_reply_rejects_changed_idempotency_payload(
    as_owner: httpx.AsyncClient, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    await connect(as_owner)
    headers = {"Idempotency-Key": "stable"}
    first = await as_owner.post(
        "/v1/reviews/google/replies", headers=headers, json={"review_id": "1", "comment": "First"}
    )
    assert first.status_code == 200
    second = await as_owner.post(
        "/v1/reviews/google/replies", headers=headers, json={"review_id": "1", "comment": "Second"}
    )
    assert second.status_code == 422 and second.json()["error"] == "idempotency_key_reused"


async def test_reply_detects_external_edit(
    as_owner: httpx.AsyncClient, db: AsyncSession, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    await connect(as_owner)
    response = await as_owner.post(
        "/v1/reviews/google/replies",
        headers={"Idempotency-Key": "external"},
        json={"review_id": "1", "comment": "Our draft"},
    )
    google[0].reply = GoogleReply(comment="Written on Google", updateTime=clock.now())
    await run_google_operations(db, *google)
    result = await as_owner.get(f"/v1/reviews/google/operations/{response.json()['id']}")
    assert result.json()["state"] == "failed"
    assert google[0].reply.comment == "Written on Google"


async def test_uncertain_reply_is_read_back_without_republishing(
    as_owner: httpx.AsyncClient, db: AsyncSession, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    from datetime import timedelta

    from clientbridge.models.reviews import GoogleBusinessOperation

    await connect(as_owner)
    response = await as_owner.post(
        "/v1/reviews/google/replies",
        headers={"Idempotency-Key": "uncertain"},
        json={"review_id": "1", "comment": "Thank you"},
    )
    google[0].ambiguous = True
    await run_google_operations(db, *google)
    operation = await db.get(GoogleBusinessOperation, response.json()["id"])
    assert operation is not None and operation.state == "unknown"
    clock.travel(clock.now() + timedelta(minutes=6), tick=False)
    await run_google_operations(db, *google)
    await db.refresh(operation)
    assert operation.state == "confirmed" and operation.request_ciphertext is None
    assert google[0].writes == 1


async def test_authorization_completion_is_bound_to_the_original_session(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    identities: FakeIdentityProvider,
    google: tuple[FakeGoogle, FakeVault, FakeFlows],
) -> None:
    start = (
        await as_owner.post("/v1/reviews/google/authorization", json={"platform": "web"})
    ).json()
    state = parse_qs(urlsplit(start["authorization_url"]).query)["state"][0]
    await as_owner.get("/v1/reviews/google/callback", params={"state": state, "code": "code"})
    as_owner.headers["X-Session-Token"] = await session_token(identities, db, "us_dev")
    response = await as_owner.post(
        "/v1/reviews/google/authorization/complete", json={"flow_token": start["flow_token"]}
    )
    assert response.status_code == 403


async def test_other_business_cannot_read_a_reply_operation(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    google: tuple[FakeGoogle, FakeVault, FakeFlows],
) -> None:
    from clientbridge.models.business import User

    await connect(as_owner)
    response = await as_owner.post(
        "/v1/reviews/google/replies",
        headers={"Idempotency-Key": "private"},
        json={"review_id": "1", "comment": "Thank you"},
    )
    other = await factory.business()
    user = await db.get(User, "us_dev")
    assert user is not None
    await factory.staff(business=other, user=user)
    as_owner.headers["X-Business-Id"] = other.id
    result = await as_owner.get(f"/v1/reviews/google/operations/{response.json()['id']}")
    assert result.status_code == 404


async def test_concurrent_reply_commands_create_one_operation(
    db: AsyncSession, google: tuple[FakeGoogle, FakeVault, FakeFlows]
) -> None:
    import asyncio

    from scripts.seed_demo import purge_businesses
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import create_async_engine

    from clientbridge.core.db import SessionLocal
    from clientbridge.core.deps import Principal
    from clientbridge.models.reviews import GoogleBusinessConnection, GoogleBusinessOperation
    from clientbridge.schemas.reviews import GoogleReplyCreate
    from clientbridge.services.reviews import GoogleReviewService

    async with SessionLocal() as setup:
        factory = Factory(setup)
        business = await factory.business()
        user = await factory.user()
        staff = await factory.staff(business=business, user=user)
        ciphertext, version = await google[1].seal("refresh", f"{business.id}:gbc_race")
        setup.add(
            GoogleBusinessConnection(
                id="gbc_race",
                business_id=business.id,
                connected_by=user.id,
                state="active",
                generation=1,
                account_name="accounts/1",
                location_name="locations/race",
                refresh_token_ciphertext=ciphertext,
                key_version=version,
            )
        )
        await setup.commit()
    principal = Principal(user_id=user.id, business_id=business.id, staff_id=staff.id, role="owner")

    async def queue() -> str:
        async with SessionLocal() as session:
            result = await GoogleReviewService(session, principal, *google).submit_reply(
                GoogleReplyCreate(review_id="1", comment="One reply"), "concurrent", remove=False
            )
            return result.id

    try:
        first, second = await asyncio.gather(queue(), queue())
        assert first == second
        async with SessionLocal() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(GoogleBusinessOperation)
                    .where(GoogleBusinessOperation.business_id == business.id)
                )
                == 1
            )
    finally:
        owner = create_async_engine(get_settings().migration_database_url)
        async with AsyncSession(owner) as session:
            await purge_businesses(session, [business.id], [user.id])
            await session.commit()
        await owner.dispose()


@pytest.mark.parametrize("code", ["google_access_denied", "google_not_found", "google_unavailable"])
async def test_profile_read_error_preserves_connection_management(
    as_owner: httpx.AsyncClient,
    google: tuple[FakeGoogle, FakeVault, FakeFlows],
    monkeypatch: pytest.MonkeyPatch,
    code: str,
) -> None:
    from clientbridge.integrations.google_business import GoogleBusinessError, GoogleLocation

    status = await connect(as_owner)

    async def unavailable(token: str, location: str) -> GoogleLocation:
        raise GoogleBusinessError("unavailable", code=code)

    monkeypatch.setattr(google[0], "location", unavailable)
    result = await as_owner.get("/v1/reviews/google")
    assert result.status_code == 200
    assert result.json()["error_code"] == code
    assert result.json()["can_request"] is False
    assert result.json()["generation"] == status["generation"]
    assert (
        await as_owner.post(
            "/v1/reviews/google/disconnect", json={"generation": status["generation"]}
        )
    ).json()["state"] == "disconnected"


async def test_definite_reply_rejection_allows_corrected_intent(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    google: tuple[FakeGoogle, FakeVault, FakeFlows],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clientbridge.integrations.google_business import GoogleBusinessError
    from clientbridge.models.reviews import GoogleBusinessOperation

    await connect(as_owner)

    async def rejected(token: str, name: str, comment: str) -> GoogleReply:
        raise GoogleBusinessError("rejected", code="google_request_rejected", status_code=422)

    monkeypatch.setattr(google[0], "put_reply", rejected)
    result = await as_owner.post(
        "/v1/reviews/google/replies",
        json={"review_id": "1", "comment": "Thanks"},
        headers={"Idempotency-Key": "rejected"},
    )
    await run_google_operations(db, *google)
    operation = (await as_owner.get(f"/v1/reviews/google/operations/{result.json()['id']}")).json()
    assert operation["state"] == "failed"
    assert operation["error_code"] == "google_request_rejected"
    row = await db.get(GoogleBusinessOperation, result.json()["id"])
    assert row is not None and row.request_ciphertext is None
    corrected = await as_owner.post(
        "/v1/reviews/google/replies",
        json={"review_id": "1", "comment": "Thank you"},
        headers={"Idempotency-Key": "corrected"},
    )
    assert corrected.status_code == 200


@pytest.mark.parametrize("initial_state", ["running", "unknown"])
@pytest.mark.parametrize(
    "code", ["google_unavailable", "google_rate_limited", "google_access_denied"]
)
async def test_uncertain_reply_readback_error_never_requeues_write(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    google: tuple[FakeGoogle, FakeVault, FakeFlows],
    monkeypatch: pytest.MonkeyPatch,
    initial_state: Literal["running", "unknown"],
    code: str,
) -> None:
    from clientbridge.integrations.google_business import GoogleBusinessError, GoogleReview
    from clientbridge.models.reviews import GoogleBusinessOperation

    await connect(as_owner)
    result = await as_owner.post(
        "/v1/reviews/google/replies",
        json={"review_id": "1", "comment": "Thanks"},
        headers={"Idempotency-Key": "uncertain"},
    )
    row = await db.get(GoogleBusinessOperation, result.json()["id"])
    assert row is not None
    row.state = initial_state
    await db.commit()
    original = google[0].review

    async def unavailable(token: str, name: str) -> GoogleReview:
        raise GoogleBusinessError("unavailable", code=code)

    monkeypatch.setattr(google[0], "review", unavailable)
    await run_google_operations(db, *google)
    await db.refresh(row)
    assert row.state == "unknown"
    monkeypatch.setattr(google[0], "review", original)
    row.next_at = None
    await db.commit()
    await run_google_operations(db, *google)
    assert google[0].writes == 0
    await db.refresh(row)
    assert row.state == "unknown"
