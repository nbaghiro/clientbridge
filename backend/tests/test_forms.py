import secrets

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import RateLimiter, public_form_rate_limit
from clientbridge.main import app
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.platform import File
from clientbridge.services.forms import snapshot_form
from tests.conftest import Factory, FakeEmailSender, FakeFileStorage
from tests.helpers import client_id, new_client

BIZ = "bz_birchbark"
SATISFACTION = "frm_satisfaction"  # seeded: required "rating", optional "comments"


async def _a_response(db: AsyncSession, *, form_id: str = SATISFACTION) -> str:
    form = await db.get(Form, form_id)
    assert form is not None
    response = FormResponse(
        definition=await snapshot_form(db, form),
        id=new_id("form_response"),
        business_id=BIZ,
        form_id=form_id,
        client_id=await client_id(db),
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
    cid = await new_client(db)
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
    cid = await new_client(db)
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
    cid = await client_id(db)
    res = await as_owner.post("/v1/forms/send", json={"form_id": "frm_nope", "client_id": cid})
    assert res.status_code == 404


async def test_send_unknown_client_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/forms/send", json={"form_id": SATISFACTION, "client_id": "cl_nope"}
    )
    assert res.status_code == 404


async def test_send_requires_admin(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await client_id(db)
    res = await as_staff.post("/v1/forms/send", json={"form_id": SATISFACTION, "client_id": cid})
    assert res.status_code == 403


async def test_send_is_tenant_isolated(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Forms")
    form = Form(id=new_id("form"), business_id=other.id, name="Theirs")
    db.add(form)
    await db.flush()
    cid = await client_id(db)
    res = await as_owner.post("/v1/forms/send", json={"form_id": form.id, "client_id": cid})
    assert res.status_code == 404


async def test_public_get_returns_form_and_fields(api: httpx.AsyncClient, db: AsyncSession) -> None:
    token = await _a_response(db)
    body = (await api.get(f"/form/{token}")).json()
    assert body["form_name"] == "Grooming Satisfaction" and body["completed"] is False
    assert body["brand"]["primary"] == "#2E4A3F"  # brand exposed on the form surface
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
    assert (await api.post("/form/nope/upload", json={})).status_code == 404


async def test_public_upload_attaches_a_file_to_the_response(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    token = await _a_response(db)
    up = await api.post(
        f"/form/{token}/upload", json={"content_type": "application/pdf", "size": 52000}
    )
    assert up.status_code == 200, up.text
    assert up.json()["upload_url"]
    row = (await db.execute(select(File).where(File.id == up.json()["file_id"]))).scalar_one()
    response = (
        await db.execute(select(FormResponse).where(FormResponse.token == token))
    ).scalar_one()
    assert (row.business_id, row.parent_type, row.parent_id, row.purpose) == (
        BIZ,
        "form_response",
        response.id,
        "attachment",
    )


async def test_public_get_is_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_form_rate_limit] = limited
    token = await _a_response(db)
    assert (await api.get(f"/form/{token}")).status_code == 200
    assert (await api.get(f"/form/{token}")).status_code == 429


async def _file_form(db: AsyncSession) -> str:
    form = Form(id="frm_waiver_upload", business_id=BIZ, name="Waiver upload")
    db.add(form)
    await db.flush()
    db.add(
        FormField(
            id="fld_waiver_scan",
            business_id=BIZ,
            form_id=form.id,
            input="file",
            name="waiver",
            label="Signed waiver",
        )
    )
    await db.flush()
    return await _a_response(db, form_id=form.id)


async def _upload(api: httpx.AsyncClient, token: str) -> str:
    up = await api.post(
        f"/form/{token}/upload", json={"content_type": "application/pdf", "size": 52000}
    )
    assert up.status_code == 200, up.text
    file_id: str = up.json()["file_id"]
    return file_id


async def _store(db: AsyncSession, storage: FakeFileStorage, file_id: str) -> None:
    file = await db.get(File, file_id)
    assert file is not None
    storage.stored[file.s3_key] = 52000


async def test_public_upload_counts_once_its_bytes_arrive(
    api: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    token = await _a_response(db)
    file_id = await _upload(api, token)
    complete = f"/form/{token}/upload/{file_id}/complete"
    assert (await api.post(complete)).status_code == 409
    await _store(db, storage, file_id)
    assert (await api.post(complete)).json() == {"file_id": file_id}


async def test_submit_refuses_a_file_that_has_not_finished_uploading(
    api: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    token = await _file_form(db)
    file_id = await _upload(api, token)
    answers = {"answers": {"waiver": file_id}}
    assert (await api.post(f"/form/{token}", json=answers)).status_code == 422
    await _store(db, storage, file_id)
    assert (await api.post(f"/form/{token}/upload/{file_id}/complete")).status_code == 200
    assert (await api.post(f"/form/{token}", json=answers)).status_code == 200


async def test_public_complete_cannot_reach_another_responses_file(
    api: httpx.AsyncClient, db: AsyncSession, storage: FakeFileStorage
) -> None:
    mine, theirs = await _a_response(db), await _a_response(db)
    file_id = await _upload(api, theirs)
    await _store(db, storage, file_id)
    assert (await api.post(f"/form/{mine}/upload/{file_id}/complete")).status_code == 404


@pytest.mark.parametrize(
    "answers",
    [
        {"rating": {"arbitrary": "object"}},
        {"rating": 5, "unknown": "stored"},
        {"rating": True},
        {"rating": "not a number"},
        {"rating": "   "},
        {"rating": 999},
    ],
)
async def test_form_rejects_invalid_answers(
    api: httpx.AsyncClient, db: AsyncSession, answers: dict[str, object]
) -> None:
    token = await _a_response(db)
    response = await api.post(f"/form/{token}", json={"answers": answers})
    assert response.status_code == 422
    stored = await db.scalar(select(FormResponse).where(FormResponse.token == token))
    assert stored is not None and stored.status == "draft" and not stored.answers


async def test_issued_form_keeps_its_definition_after_template_edits(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {
        "name": "Original",
        "fields": [{"input": "text", "label": "Original question", "required": True}],
    }
    created = await as_owner.post("/v1/forms", json=body)
    assert created.status_code == 201, created.text
    form_id = created.json()["id"]
    issued = await as_owner.post(
        "/v1/forms/send", json={"form_id": form_id, "client_id": await client_id(db)}
    )
    token = issued.json()["token"]
    first = (await api.get(f"/form/{token}")).json()
    changed = await as_owner.patch(
        f"/v1/forms/{form_id}",
        json={
            "name": "Changed",
            "fields": [{"input": "number", "label": "New question", "required": True}],
        },
    )
    assert changed.status_code == 200
    current = (await api.get(f"/form/{token}")).json()
    assert current["form_name"] == "Original"
    assert current["fields"] == first["fields"]
    result = await api.post(
        f"/form/{token}", json={"answers": {first["fields"][0]["name"]: "Original answer"}}
    )
    assert result.status_code == 200, result.text


async def test_signature_required_by_issued_form_is_enforced(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    created = await as_owner.post(
        "/v1/forms",
        json={
            "name": "Consent",
            "require_signature": True,
            "fields": [{"input": "text", "label": "Comment"}],
        },
    )
    issued = await as_owner.post(
        "/v1/forms/send", json={"form_id": created.json()["id"], "client_id": await client_id(db)}
    )
    token = issued.json()["token"]
    refused = await api.post(f"/form/{token}", json={"answers": {}})
    assert refused.status_code == 422
    signed = await api.post(
        f"/form/{token}", json={"answers": {}, "signature": {"name": "Pat", "agreed": True}}
    )
    assert signed.status_code == 200, signed.text
    response = await db.get(FormResponse, issued.json()["id"])
    assert response is not None
    await db.refresh(response)
    assert response.signature is not None and response.signature["name"] == "Pat"


async def test_form_delivery_survives_provider_connection_failure(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clientbridge.core import clock
    from clientbridge.integrations.resend import Email
    from clientbridge.models.messaging import Delivery
    from clientbridge.services.deliveries import run_deliveries
    from tests.conftest import FakePushSender, FakeSmsSender

    original = email.send

    async def offline(_: Email) -> str | None:
        raise httpx.ConnectError("provider unavailable")

    monkeypatch.setattr(email, "send", offline)
    response = await as_owner.post(
        "/v1/forms/send",
        json={
            "form_id": SATISFACTION,
            "client_id": await new_client(db),
        },
        headers={"Idempotency-Key": "form-delivery-recovery"},
    )
    assert response.status_code == 201
    deliveries = list(
        await db.scalars(
            select(Delivery).where(Delivery.key.startswith(f"form:{response.json()['id']}:"))
        )
    )
    assert deliveries and any(row.state == "queued" for row in deliveries)
    monkeypatch.setattr(email, "send", original)
    for row in deliveries:
        if row.state == "queued":
            row.next_at = clock.now()
    await db.commit()
    await run_deliveries(db, email, FakeSmsSender(), FakePushSender())
    assert len(email.sent) == 1
    await run_deliveries(db, email, FakeSmsSender(), FakePushSender())
    assert len(email.sent) == 1
