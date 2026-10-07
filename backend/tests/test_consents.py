import csv
import io
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import TooManyRequests
from clientbridge.core.ratelimit import RateLimiter, public_prefs_rate_limit
from clientbridge.main import app
from clientbridge.models.clients import Client, Consent
from clientbridge.services.consents import prefs_token, record_consent
from tests.conftest import Factory, FakeSmsSender
from tests.helpers import TWILIO, client_id, ok

BIZ = "bz_birchbark"
PHONE = "+16045550177"


async def _client(db: AsyncSession, *, name: str | None = None) -> str:
    cid = await client_id(db, email="pat@example.ca")
    values: dict[str, object] = {"phone": PHONE}
    if name is not None:
        values["name"] = name
    await db.execute(update(Client).where(Client.id == cid).values(**values))
    await db.flush()
    return cid


async def _consents(db: AsyncSession, cid: str, channel: str) -> list[tuple[str, str]]:
    rows = await db.execute(
        select(Consent.status, Consent.source)
        .where(Consent.client_id == cid, Consent.channel == channel)
        .order_by(Consent.created_at, Consent.id)
    )
    return [(status, source) for status, source in rows.all()]


async def _text_in(api: httpx.AsyncClient, body: str, sid: str) -> None:
    ok(
        await api.post(
            "/webhooks/sms",
            data={"From": PHONE, "Body": body, "MessageSid": sid},
            headers=TWILIO,
        )
    )


async def test_export_lists_every_change(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db, name="=HYPERLINK(1)")
    await record_consent(
        db, BIZ, cid, channel="sms", status="granted", source="in_person", recorded_by=None
    )
    await record_consent(
        db, BIZ, cid, channel="sms", status="withdrawn", source="reply", recorded_by=None
    )
    body = ok(await as_owner.post("/v1/consents/export")).json()
    assert body["filename"].startswith("consent-log-") and body["filename"].endswith(".csv")
    rows = list(csv.reader(io.StringIO(body["content"])))
    assert rows[0][:6] == ["client", "email", "phone", "channel", "status", "source"]
    mine = [r for r in rows[1:] if r[2] == PHONE]
    assert [(r[3], r[4], r[5]) for r in mine] == [
        ("sms", "granted", "in_person"),
        ("sms", "withdrawn", "reply"),
    ]
    assert mine[0][0] == "'=HYPERLINK(1)"  # a spreadsheet won't run it as a formula


async def test_export_is_for_managers(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/consents/export")).status_code == 403


async def test_export_leaves_out_other_businesses(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Consent")
    foreign = await factory.client(business=other, name="Foreign Client")
    await record_consent(
        db, other.id, foreign.id, channel="email", status="granted", source="form", recorded_by=None
    )
    content = ok(await as_owner.post("/v1/consents/export")).json()["content"]
    assert "Foreign Client" not in content


async def test_preferences_page_reads_and_saves(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db)
    token = prefs_token(cid)
    page = ok(await api.get(f"/prefs/{token}")).json()
    assert (page["email"], page["sms"]) == (False, False)
    assert page["phone_hint"] == "•••0177" and page["email_hint"] == "p•••@example.ca"
    saved = ok(await api.post(f"/prefs/{token}", json={"email": True, "sms": False})).json()
    assert (saved["email"], saved["sms"]) == (True, False)
    assert await _consents(db, cid, "email") == [("granted", "preferences")]
    ok(await api.post(f"/prefs/{token}", json={"email": True, "sms": False}))
    assert len(await _consents(db, cid, "email")) == 1  # saving the same choice records nothing


async def test_one_click_unsubscribe(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db)
    await record_consent(
        db, BIZ, cid, channel="email", status="granted", source="in_person", recorded_by=None
    )
    token = prefs_token(cid)
    out = ok(await api.post(f"/prefs/{token}/unsubscribe", json={"channel": "email"})).json()
    assert out["email"] is False
    assert (await _consents(db, cid, "email"))[-1] == ("withdrawn", "unsubscribe")
    ok(await api.post(f"/prefs/{token}/unsubscribe", json={"channel": "email"}))
    assert len(await _consents(db, cid, "email")) == 2  # a second click is a no-op


async def test_preferences_link_must_be_signed(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db)
    assert (await api.get(f"/prefs/{cid}.forged")).status_code == 404
    assert (await api.get("/prefs/nothing")).status_code == 404
    forged = await api.post(f"/prefs/{cid}.forged", json={"email": True, "sms": True})
    assert forged.status_code == 404
    assert await _consents(db, cid, "sms") == []


async def test_implied_consent_lapses(api: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db)
    await record_consent(
        db,
        BIZ,
        cid,
        channel="email",
        status="implied",
        source="online_booking",
        recorded_by=None,
        expires_at=datetime.now(UTC) - timedelta(days=1),
    )
    assert ok(await api.get(f"/prefs/{prefs_token(cid)}")).json()["email"] is False


async def test_stop_reply_blocks_texts_until_start(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, " stop ", "SM_stop_1")
    assert await _consents(db, cid, "sms") == [("withdrawn", "reply")]
    blocked = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Still there?"}
    )
    assert blocked.status_code == 409
    assert sms.sent == []
    email = await as_owner.post(
        "/v1/messages", json={"client_id": cid, "channel": "email", "body": "By email"}
    )
    assert email.status_code == 200  # email still reaches them

    await _text_in(as_owner, "START", "SM_start_1")
    assert (await _consents(db, cid, "sms"))[-1] == ("granted", "reply")
    ok(await as_owner.post("/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi"}))
    assert [m.to for m in sms.sent] == [PHONE]


async def test_ordinary_replies_leave_consent_alone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "Stop by at 3?", "SM_plain_1")
    await _text_in(as_owner, "START", "SM_plain_2")  # START without a STOP changes nothing
    assert await _consents(db, cid, "sms") == []


async def test_stopped_client_gets_no_reminder_texts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_stop_2")
    ok(await as_owner.post("/v1/reviews/request", json={"client_id": cid}), 201)
    assert sms.sent == []


async def test_preferences_are_rate_limited(api: httpx.AsyncClient, db: AsyncSession) -> None:
    rl = RateLimiter(limit=1, window_s=60.0)

    def limited() -> None:
        if not rl.check("x", 0.0):
            raise TooManyRequests("slow down")

    app.dependency_overrides[public_prefs_rate_limit] = limited
    token = prefs_token(await _client(db))
    try:
        assert (await api.get(f"/prefs/{token}")).status_code == 200
        assert (await api.get(f"/prefs/{token}")).status_code == 429
    finally:
        app.dependency_overrides.pop(public_prefs_rate_limit, None)
