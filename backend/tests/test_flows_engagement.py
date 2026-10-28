"""Client engagement flows: forms, contracts, reviews, messages and broadcasts."""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.services.messaging import run_due_broadcasts
from tests.conftest import FakeEmailSender, FakePushSender, FakeSmsSender
from tests.google_business import configure_google_review_profile
from tests.helpers import local_hour, ok, queued_subjects, text_in, unread


async def _client(api: httpx.AsyncClient, **contact: str | list[str] | bool) -> str:
    created = ok(await api.post("/v1/clients", json={"name": "Engaged Client", **contact}), 201)
    return str(created.json()["id"])


async def test_form_is_sent_and_answered(as_owner: httpx.AsyncClient, sms: FakeSmsSender) -> None:
    api = as_owner
    cid = await _client(api, phone="+16045550276")
    sent = ok(
        await api.post("/v1/forms/send", json={"form_id": "frm_satisfaction", "client_id": cid}),
        201,
    ).json()
    assert sent["status"] == "draft"
    assert any(f"/form/{sent['token']}" in m.body for m in sms.sent)

    form = ok(await api.get(f"/form/{sent['token']}")).json()
    assert form["completed"] is False
    assert {"rating", "comments"} <= {f["name"] for f in form["fields"]}
    assert (await api.post(f"/form/{sent['token']}", json={"answers": {}})).status_code == 422
    done = ok(
        await api.post(f"/form/{sent['token']}", json={"answers": {"rating": 4, "comments": "ok"}})
    ).json()
    assert done["completed"] is True
    assert ok(await api.get(f"/form/{sent['token']}")).json()["completed"] is True
    again = await api.post(f"/form/{sent['token']}", json={"answers": {"rating": 5}})
    assert again.status_code == 409


async def test_contract_is_sent_and_signed(as_owner: httpx.AsyncClient, sms: FakeSmsSender) -> None:
    api = as_owner
    cid = await _client(api, phone="+16045550277")
    sent = ok(
        await api.post("/v1/contracts/send", json={"contract_id": "con_waiver", "client_id": cid}),
        201,
    ).json()
    assert sent["status"] == "pending"
    assert any(f"/contract/{sent['token']}" in m.body for m in sms.sent)

    context = ok(await api.get(f"/contract/{sent['token']}")).json()
    assert context["status"] == "pending" and context["body"]
    signed = ok(
        await api.post(
            f"/contract/{sent['token']}/sign",
            json={"typed_name": "Flow Signer", "agreed": True, "version": context["version"]},
        )
    ).json()
    assert signed["status"] == "signed"
    assert ok(await api.get(f"/contract/{sent['token']}")).json()["status"] == "signed"
    again = await api.post(
        f"/contract/{sent['token']}/sign",
        json={"typed_name": "Twice", "agreed": True, "version": context["version"]},
    )
    assert again.status_code == 409


async def test_review_invitation_links_directly_to_google(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    url = "https://g.page/r/1/review"
    await configure_google_review_profile(db)
    cid = await _client(as_owner, phone="+16045550278")
    request = ok(await as_owner.post("/v1/reviews/request", json={"client_id": cid}), 201).json()
    assert request["requested_at"]
    assert "token" not in request and "rating" not in request
    [notice] = await queued_subjects(db, f"review:{request['id']}")
    assert url in notice
    assert sms.sent == []


async def test_messages_and_broadcasts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    api = as_owner
    cid = await _client(api, phone="+16045550899", tags=["flowvip"], marketing_consent=True)
    sent = ok(await api.post("/v1/messages", json={"client_id": cid, "body": "Hi"})).json()
    assert (sent["direction"], sent["status"]) == ("out", "sent")
    assert sms.sent[-1].to == "+16045550899"

    for sid in ("SM_flow_1", "SM_flow_2"):
        ok(await text_in(api, {"From": "+16045550899", "Body": "Reply", "MessageSid": sid}))
    assert await unread(db, sent["thread_id"]) == 2
    read = ok(await api.post(f"/v1/threads/{sent['thread_id']}/read")).json()
    assert (read["id"], read["unread_count"]) == (sent["thread_id"], 0)
    assert await unread(db, sent["thread_id"]) == 0

    now = await local_hour(db, 12)
    blast = ok(
        await api.post(
            "/v1/broadcasts",
            json={
                "name": "Flow promo",
                "body": "Sale",
                "audience": {"tags": ["flowvip"]},
            },
        )
    ).json()
    assert (blast["status"], blast["recipient_count"]) == ("sending", 1)
    await run_due_broadcasts(db, sms, FakeEmailSender(), FakePushSender(), now)
    assert sms.sent[-1].body == "Birchbark Pet Studio: Sale Reply STOP to opt out."


pytestmark = pytest.mark.usefixtures("google_review_provider")
