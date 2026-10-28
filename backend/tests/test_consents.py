import csv
import io
import re
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.models.clients import Client, Consent
from clientbridge.services.consents import record_consent
from clientbridge.services.messaging import broadcast_recipients
from tests.conftest import Factory, FakeSmsSender
from tests.google_business import configure_google_review_profile
from tests.helpers import new_client, ok, text_in, texted

BIZ = "bz_birchbark"
PHONE = "+16045550877"


async def _client(db: AsyncSession, *, name: str | None = None) -> str:
    cid = await new_client(db)
    values: dict[str, object] = {"phone": PHONE}
    if name is not None:
        values["name"] = name
    await db.execute(update(Client).where(Client.id == cid).values(**values))
    await texted(db, cid)
    return cid


async def _consents(db: AsyncSession, cid: str) -> list[tuple[str, str]]:
    rows = await db.execute(
        select(Consent.status, Consent.source)
        .where(Consent.client_id == cid)
        .order_by(Consent.created_at, Consent.id)
    )
    return [(status, source) for status, source in rows.all()]


async def _text_in(api: httpx.AsyncClient, body: str, sid: str) -> None:
    ok(await text_in(api, {"From": PHONE, "Body": body, "MessageSid": sid}))


async def test_export_lists_every_change(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client(db, name="=HYPERLINK(1)")
    await record_consent(db, BIZ, cid, status="granted", source="in_person", recorded_by=None)
    await record_consent(db, BIZ, cid, status="withdrawn", source="reply", recorded_by=None)
    body = ok(await as_owner.post("/v1/consents/export")).json()
    assert body["filename"].startswith("consent-log-") and body["filename"].endswith(".csv")
    rows = list(csv.reader(io.StringIO(body["content"])))
    assert rows[0] == [
        "client",
        "phone",
        "status",
        "source",
        "recorded_at",
        "expires_at",
        "recorded_by",
    ]
    mine = [r for r in rows[1:] if r[1] == PHONE]
    assert [(r[2], r[3]) for r in mine] == [
        ("granted", "in_person"),
        ("withdrawn", "reply"),
    ]
    assert mine[0][0] == "'=HYPERLINK(1)"  # a spreadsheet won't run it as a formula


async def test_export_pseudo_localizes_headers_and_keeps_data(
    as_owner: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    english = list(
        csv.reader(io.StringIO(ok(await as_owner.post("/v1/consents/export")).json()["content"]))
    )
    monkeypatch.setattr(get_settings(), "pseudo_locale", True)
    body = ok(await as_owner.post("/v1/consents/export")).json()
    header, *data = list(csv.reader(io.StringIO(body["content"])))
    assert len(header) == len(english[0]) == 7
    for cell in header:
        assert cell.startswith("[") and cell.endswith("~]"), cell
        assert not re.search(r"[A-Za-z]", cell), cell
    assert data == english[1:] and len(data) > 0


async def test_export_is_for_managers(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.post("/v1/consents/export")).status_code == 403


async def test_export_leaves_out_other_businesses(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Consent")
    foreign = await factory.client(business=other, name="Foreign Client")
    await record_consent(
        db, other.id, foreign.id, status="granted", source="form", recorded_by=None
    )
    content = ok(await as_owner.post("/v1/consents/export")).json()["content"]
    assert "Foreign Client" not in content


async def test_implied_consent_lapses(db: AsyncSession) -> None:
    cid = await _client(db)
    await record_consent(
        db,
        BIZ,
        cid,
        status="implied",
        source="online_booking",
        recorded_by=None,
        expires_at=clock.now() - timedelta(days=1),
    )
    recipients, _ = await broadcast_recipients(db, BIZ, {"all": True})
    assert cid not in {client.id for client, _ in recipients}


async def test_stop_reply_blocks_texts_until_start(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, " stop ", "SM_stop_1")
    assert await _consents(db, cid) == [("withdrawn", "reply")]
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Still there?"})
    assert blocked.status_code == 409
    assert sms.sent == []
    await _text_in(as_owner, "START", "SM_start_1")
    assert (await _consents(db, cid))[-1] == ("granted", "reply")
    ok(await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"}))
    assert [m.to for m in sms.sent] == [PHONE]


async def test_ordinary_replies_leave_consent_alone(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "Stop by at 3?", "SM_plain_1")
    await _text_in(as_owner, "START", "SM_plain_2")  # START without a STOP changes nothing
    assert await _consents(db, cid) == []


async def test_stopped_client_gets_no_reminder_texts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await configure_google_review_profile(db)
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_stop_2")
    ok(await as_owner.post("/v1/reviews/request", json={"client_id": cid}), 201)
    assert sms.sent == []


async def test_export_needs_a_session(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.post("/v1/consents/export")).status_code == 401


async def test_a_staff_toggle_after_stop_does_not_unblock_texts(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_sticky_1")
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": False}))
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": True}))
    assert await _consents(db, cid) == [("withdrawn", "reply")]
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Back?"})
    assert blocked.status_code == 409 and sms.sent == []


async def test_an_older_staff_grant_cannot_outrank_a_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_sticky_2")
    await record_consent(db, BIZ, cid, status="granted", source="in_person", recorded_by=None)
    recipients, _ = await broadcast_recipients(db, BIZ, {"all": True})
    assert cid not in {client.id for client, _ in recipients}
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Back?"})
    assert blocked.status_code == 409
    assert PHONE not in [m.to for m in sms.sent]


pytestmark = pytest.mark.usefixtures("google_review_provider")
