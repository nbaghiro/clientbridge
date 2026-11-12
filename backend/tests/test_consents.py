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
from clientbridge.schemas.messaging import BroadcastAudience
from clientbridge.services.consents import record_consent, set_marketing_consent, stopped_clients
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
    recipients, _ = await broadcast_recipients(db, BIZ, BroadcastAudience(all=True))
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


async def test_a_staff_toggle_after_stop_is_refused(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_sticky_1")
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": False}))
    refused = await as_owner.patch(
        f"/v1/clients/{cid}", json={"name": "Renamed", "marketing_consent": True}
    )
    assert refused.status_code == 409 and refused.json()["error"] == "number_stopped"
    assert await _consents(db, cid) == [("withdrawn", "reply")]
    assert await db.scalar(select(Client.name).where(Client.id == cid)) != "Renamed"
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Back?"})
    assert blocked.status_code == 409 and sms.sent == []


async def test_an_older_staff_grant_cannot_outrank_a_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_sticky_2")
    await record_consent(db, BIZ, cid, status="granted", source="in_person", recorded_by=None)
    recipients, _ = await broadcast_recipients(db, BIZ, BroadcastAudience(all=True))
    assert cid not in {client.id for client, _ in recipients}
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Back?"})
    assert blocked.status_code == 409
    assert PHONE not in [m.to for m in sms.sent]


pytestmark = pytest.mark.usefixtures("google_review_provider")


async def test_a_stop_from_an_old_number_does_not_follow_the_client_to_a_new_one(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db)
    await record_consent(db, BIZ, cid, status="granted", source="form", recorded_by=None)
    await _text_in(as_owner, "STOP", "SM_old_number")
    await db.execute(update(Client).where(Client.id == cid).values(phone="+16045550878"))
    assert cid not in await stopped_clients(db, BIZ, [cid])
    recipients, _ = await broadcast_recipients(db, BIZ, BroadcastAudience(all=True))
    assert cid not in {client.id for client, _ in recipients}
    await set_marketing_consent(db, BIZ, cid, agreed=True, recorded_by=None)
    assert (await _consents(db, cid))[-1] == ("granted", "in_person")
    recipients, _ = await broadcast_recipients(db, BIZ, BroadcastAudience(all=True))
    assert cid in {client.id for client, _ in recipients}
    res = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Hi"})
    assert res.status_code == 200, res.text


async def test_a_new_client_on_a_stopped_number_cannot_start_agreed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _client(db)
    await _text_in(as_owner, "STOP", "SM_new_on_stopped")
    await db.execute(update(Client).where(Client.phone == PHONE).values(phone="+16045550879"))
    body = {"name": "Second Owner", "phone": PHONE, "marketing_consent": True}
    refused = await as_owner.post("/v1/clients", json=body)
    assert refused.status_code == 409 and refused.json()["error"] == "number_stopped"
    assert await db.scalar(select(Client.id).where(Client.name == "Second Owner")) is None
    created = ok(await as_owner.post("/v1/clients", json={**body, "marketing_consent": False}), 201)
    assert await stopped_clients(db, BIZ, [created.json()["id"]]) == {created.json()["id"]}


@pytest.mark.parametrize(
    "body",
    [
        "Stop.",
        "STOP!",
        " stop?! ",
        '"Unsubscribe"',
        "\u201cStop\u201d",
        "STOP \U0001f6d1",
        "Opt  out",
        "revoke",
    ],
)
async def test_a_stop_with_punctuation_still_opts_out(
    as_owner: httpx.AsyncClient, db: AsyncSession, body: str
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, body, "SM_punctuated_stop")
    assert await _consents(db, cid) == [("withdrawn", "reply")]
    await _text_in(as_owner, "Start.", "SM_punctuated_start")
    assert await _consents(db, cid) == [("withdrawn", "reply"), ("granted", "reply")]


async def test_export_names_the_number_each_change_was_recorded_for(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db, name="Moved Number")
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": True}))
    await _text_in(as_owner, "STOP", "SM_export_old_number")
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"phone": "+16045550878"}))
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": True}))
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": False}))
    content = ok(await as_owner.post("/v1/consents/export")).json()["content"]
    mine = [r for r in csv.reader(io.StringIO(content)) if r[0] == "Moved Number"]
    assert [(r[1], r[2], r[3]) for r in mine] == [
        (PHONE, "granted", "in_person"),
        (PHONE, "withdrawn", "reply"),
        ("+16045550878", "granted", "in_person"),
        ("+16045550878", "withdrawn", "in_person"),
    ]


async def test_an_in_person_yes_over_implied_consent_is_recorded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db)
    await record_consent(
        db,
        BIZ,
        cid,
        status="implied",
        source="online_booking",
        recorded_by=None,
        expires_at=clock.now() + timedelta(days=30),
    )
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": True}))
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": True}))
    assert await _consents(db, cid) == [("implied", "online_booking"), ("granted", "in_person")]
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": False}))
    ok(await as_owner.patch(f"/v1/clients/{cid}", json={"marketing_consent": False}))
    assert (await _consents(db, cid))[-2:] == [("granted", "in_person"), ("withdrawn", "in_person")]


async def test_a_phone_change_moves_the_staff_toggle_onto_the_new_numbers_stop(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client(db)
    await _text_in(as_owner, "STOP", "SM_toggle_follows_number")
    away = {"phone": "+16045550878", "marketing_consent": True}
    ok(await as_owner.patch(f"/v1/clients/{cid}", json=away))
    assert (await _consents(db, cid))[-1] == ("granted", "in_person")
    assert cid not in await stopped_clients(db, BIZ, [cid])
    neighbour = {"name": "Next Door", "phone": "+16045550879"}
    other = ok(await as_owner.post("/v1/clients", json=neighbour), 201).json()["id"]
    onto = {"phone": PHONE, "marketing_consent": True}
    refused = await as_owner.patch(f"/v1/clients/{other}", json=onto)
    assert refused.status_code == 409 and refused.json()["error"] == "number_stopped"
    assert await db.scalar(select(Client.phone).where(Client.id == other)) == "+16045550879"


async def test_a_stop_from_a_number_no_client_holds_blocks_whoever_takes_it_until_start(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await _text_in(as_owner, "STOP", "SM_stranger_stop")
    rows = (
        await db.execute(
            select(Consent.client_id, Consent.status, Consent.source).where(Consent.phone == PHONE)
        )
    ).all()
    assert [tuple(row) for row in rows] == [(None, "withdrawn", "reply")]
    body = {"name": "Late Arrival", "phone": PHONE, "marketing_consent": True}
    refused = await as_owner.post("/v1/clients", json=body)
    assert refused.status_code == 409 and refused.json()["error"] == "number_stopped"
    created = ok(await as_owner.post("/v1/clients", json={**body, "marketing_consent": False}), 201)
    cid = created.json()["id"]
    assert await stopped_clients(db, BIZ, [cid]) == {cid}
    blocked = await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Welcome"})
    assert blocked.status_code == 409 and sms.sent == []
    content = ok(await as_owner.post("/v1/consents/export")).json()["content"]
    assert ["", PHONE, "withdrawn", "reply"] in [r[:4] for r in csv.reader(io.StringIO(content))]
    await _text_in(as_owner, "START", "SM_stranger_start")
    assert await stopped_clients(db, BIZ, [cid]) == set()
    assert await _consents(db, cid) == [("granted", "reply")]
    ok(await as_owner.post("/v1/messages", json={"client_id": cid, "body": "Welcome"}))


async def test_a_start_or_an_ordinary_text_from_a_stranger_records_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _text_in(as_owner, "START", "SM_stranger_start_only")
    await _text_in(as_owner, "Stop by at noon?", "SM_stranger_chat")
    assert await db.scalar(select(Consent.id).where(Consent.phone == PHONE)) is None
