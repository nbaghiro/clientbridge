import secrets

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_form_rate_limit
from clientbridge.main import app
from clientbridge.models.crm import Client
from clientbridge.models.documents import Form, FormResponse
from tests.conftest import Factory, FakeEmailSender

BIZ = "bz_birchbark"
SATISFACTION = "frm_satisfaction"  # seeded: required "rating", optional "comments"


async def _a_client(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


async def _fresh_client(db: AsyncSession, *, email: str = "form@example.ca") -> str:
    client = Client(
        id=new_id("client"),
        business_id=BIZ,
        name="Form Client",
        email=email,
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client.id


async def _a_response(db: AsyncSession, *, form_id: str = SATISFACTION) -> str:
    response = FormResponse(
        id=new_id("form_response"),
        business_id=BIZ,
        form_id=form_id,
        client_id=await _a_client(db),
        status="draft",
        token=secrets.token_urlsafe(16),
    )
    db.add(response)
    await db.flush()
    assert response.token
    return response.token


async def test_send_creates_draft_and_notifies(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    cid = await _fresh_client(db)
    res = await as_owner.post("/v1/forms/send", json={"form_id": SATISFACTION, "client_id": cid})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "draft" and body["token"]
    row = (await db.execute(select(FormResponse).where(FormResponse.id == body["id"]))).scalar_one()
    assert row.business_id == BIZ and row.status == "draft"
    assert any(f"/form/{body['token']}" in m.body for m in email.sent)


async def test_send_retry_notifies_once(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    # A same-key retry replays the cached response inside run_command → the client isn't re-emailed.
    cid = await _fresh_client(db)
    headers = {"Idempotency-Key": "form-send-retry-1"}
    first = await as_owner.post(
        "/v1/forms/send", json={"form_id": SATISFACTION, "client_id": cid}, headers=headers
    )
    second = await as_owner.post(
        "/v1/forms/send", json={"form_id": SATISFACTION, "client_id": cid}, headers=headers
    )
    assert first.status_code == 201 and second.json()["id"] == first.json()["id"]
    token = first.json()["token"]
    assert sum(f"/form/{token}" in m.body for m in email.sent) == 1


async def test_send_unknown_form_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _a_client(db)
    res = await as_owner.post("/v1/forms/send", json={"form_id": "frm_nope", "client_id": cid})
    assert res.status_code == 404


async def test_send_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/forms/send", json={"form_id": SATISFACTION, "client_id": "cl_nope"}
    )
    assert res.status_code == 404


async def test_send_requires_admin(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _a_client(db)
    res = await as_staff.post("/v1/forms/send", json={"form_id": SATISFACTION, "client_id": cid})
    assert res.status_code == 403


async def test_send_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Forms")
    form = Form(id=new_id("form"), business_id=other.id, name="Theirs", attach_to=[])
    db.add(form)
    await db.flush()
    cid = await _a_client(db)
    res = await as_owner.post("/v1/forms/send", json={"form_id": form.id, "client_id": cid})
    assert res.status_code == 404


async def test_public_get_returns_form_and_fields(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_response(db)
    body = (await api.get(f"/form/{token}")).json()
    assert body["form_name"] == "Grooming Satisfaction" and body["completed"] is False
    assert body["brand"]["primary"] == "#3F5E80"  # brand exposed on the form surface
    names = {f["name"] for f in body["fields"]}
    assert "rating" in names and "comments" in names


async def test_public_submit_fills_response(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_response(db)
    res = await api.post(f"/form/{token}", json={"answers": {"rating": 5, "comments": "Great"}})
    assert res.status_code == 200, res.text
    assert res.json()["completed"] is True
    row = (await db.execute(select(FormResponse).where(FormResponse.token == token))).scalar_one()
    assert row.status == "submitted" and row.answers["rating"] == 5
    assert row.submitted_at is not None


async def test_public_second_submit_409(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_response(db)
    assert (await api.post(f"/form/{token}", json={"answers": {"rating": 5}})).status_code == 200
    assert (await api.post(f"/form/{token}", json={"answers": {"rating": 5}})).status_code == 409


async def test_public_missing_required_422(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_response(db)
    assert (
        await api.post(f"/form/{token}", json={"answers": {"comments": "x"}})
    ).status_code == 422
    assert (await api.post(f"/form/{token}", json={"answers": {"rating": ""}})).status_code == 422


async def test_public_unknown_token_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/form/nope")).status_code == 404
    assert (await api.post("/form/nope", json={"answers": {}})).status_code == 404


async def test_public_get_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_form_rate_limit] = limited
    token = await _a_response(db)
    assert (await api.get(f"/form/{token}")).status_code == 200
    assert (await api.get(f"/form/{token}")).status_code == 429
