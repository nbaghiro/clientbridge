"""Client engagement flows: forms, contracts, reviews, messages and broadcasts."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.reviews import Review
from tests.conftest import FakeEmailSender, FakeSmsSender
from tests.helpers import TWILIO, ok, review_id, unread


async def _client(api: httpx.AsyncClient, **contact: str | list[str] | bool) -> str:
    created = ok(await api.post("/v1/clients", json={"name": "Engaged Client", **contact}), 201)
    return str(created.json()["id"])


async def test_form_is_sent_and_answered(
    as_owner: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    api = as_owner
    cid = await _client(api, email="form-flow@example.ca")
    sent = ok(
        await api.post("/v1/forms/send", json={"form_id": "frm_satisfaction", "client_id": cid}),
        201,
    ).json()
    assert sent["status"] == "draft"
    assert any(f"/form/{sent['token']}" in m.body for m in email.sent)

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


async def test_contract_is_sent_and_signed(
    as_owner: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    api = as_owner
    cid = await _client(api, email="sign-flow@example.ca")
    sent = ok(
        await api.post("/v1/contracts/send", json={"contract_id": "con_waiver", "client_id": cid}),
        201,
    ).json()
    assert sent["status"] == "pending"
    assert any(f"/contract/{sent['token']}" in m.body for m in email.sent)

    context = ok(await api.get(f"/contract/{sent['token']}")).json()
    assert context["status"] == "pending" and context["body"]
    signed = ok(
        await api.post(
            f"/contract/{sent['token']}/sign", json={"typed_name": "Flow Signer", "agreed": True}
        )
    ).json()
    assert signed["status"] == "signed"
    assert ok(await api.get(f"/contract/{sent['token']}")).json()["status"] == "signed"
    again = await api.post(
        f"/contract/{sent['token']}/sign", json={"typed_name": "Twice", "agreed": True}
    )
    assert again.status_code == 409


async def test_review_is_requested_submitted_answered_and_hidden(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    api = as_owner
    cid = await _client(api, email="review-flow@example.ca")
    request = ok(await api.post("/v1/reviews/request", json={"client_id": cid}), 201).json()
    assert request["status"] == "requested"
    assert any(f"/review/{request['token']}" in m.body for m in email.sent)

    page = ok(await api.get(f"/review/{request['token']}")).json()
    assert page["completed"] is False
    submitted = ok(
        await api.post(f"/review/{request['token']}", json={"rating": 5, "body": "Lovely"})
    ).json()
    assert submitted["completed"] is True and submitted["rating"] == 5
    assert (await api.post(f"/review/{request['token']}", json={"rating": 5})).status_code == 409
    rid = await review_id(db, request["token"])
    review = await db.get(Review, rid, populate_existing=True)
    assert review is not None and review.status == "published"
    replied = ok(await api.post(f"/v1/reviews/{rid}/respond", json={"response": "Thanks"})).json()
    assert replied["response"] == "Thanks" and replied["responded_at"] is not None
    assert ok(await api.post(f"/v1/reviews/{rid}/hide")).json()["status"] == "hidden"
    assert ok(await api.post(f"/v1/reviews/{rid}/publish")).json()["status"] == "published"


async def test_messages_and_broadcasts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    api = as_owner
    cid = await _client(api, phone="+16045550199", tags=["flowvip"], marketing_consent=True)
    sent = ok(
        await api.post("/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi"})
    ).json()
    assert (sent["direction"], sent["status"]) == ("out", "sent")
    assert sms.sent[-1].to == "+16045550199"

    for sid in ("SM_flow_1", "SM_flow_2"):
        ok(
            await api.post(
                "/webhooks/sms",
                data={"From": "+16045550199", "Body": "Reply", "MessageSid": sid},
                headers=TWILIO,
            )
        )
    assert await unread(db, sent["thread_id"]) == 2
    read = ok(await api.post(f"/v1/threads/{sent['thread_id']}/read")).json()
    assert (read["id"], read["unread_count"]) == (sent["thread_id"], 0)
    assert await unread(db, sent["thread_id"]) == 0

    blast = ok(
        await api.post(
            "/v1/broadcasts",
            json={
                "name": "Flow promo",
                "channel": "sms",
                "body": "Sale",
                "audience": {"tags": ["flowvip"]},
            },
        )
    ).json()
    assert (blast["status"], blast["recipient_count"]) == ("sent", 1)
    assert sms.sent[-1].body == "Birchbark Pet Studio: Sale Reply STOP to opt out."
