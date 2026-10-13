"""Resend delivery events move email messages along, and a spam complaint withdraws consent."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import is_duplicate
from clientbridge.core.ids import new_id
from clientbridge.integrations.resend import resend_signature, valid_resend_signature
from clientbridge.models.clients import Client, Consent
from clientbridge.models.messaging import Message
from clientbridge.models.platform import Webhook
from clientbridge.services.consents import allows_marketing, latest_consents, record_consent
from clientbridge.services.messaging import open_thread
from tests.conftest import BIZ, RESEND_SECRET, Factory
from tests.helpers import email_event, new_client, ok

EMAIL = "pat@example.ca"


def _event(
    kind: str,
    email_id: str,
    *,
    to: str = EMAIL,
    tags: dict[str, str] | None = None,
    detail: dict[str, object] | None = None,
) -> dict[str, object]:
    data: dict[str, object] = {"email_id": email_id, "to": [to], "tags": tags or {}}
    data.update(detail or {})
    return {"type": kind, "created_at": "2026-10-12T12:00:00.000Z", "data": data}


async def _sent_email(as_owner: httpx.AsyncClient, db: AsyncSession, client_id: str) -> Message:
    res = ok(
        await as_owner.post(
            "/v1/messages", json={"client_id": client_id, "channel": "email", "body": "Hello"}
        )
    )
    return await _message(db, res.json()["id"])


async def _message(db: AsyncSession, message_id: str) -> Message:
    return (await db.execute(select(Message).where(Message.id == message_id))).scalar_one()


async def _webhook(db: AsyncSession, svix_id: str) -> Webhook:
    return (await db.execute(select(Webhook).where(Webhook.id == f"resend_{svix_id}"))).scalar_one()


async def _granted(db: AsyncSession, business_id: str, client_id: str) -> None:
    await record_consent(
        db,
        business_id,
        client_id,
        channel="email",
        status="granted",
        source="form",
        recorded_by=None,
    )


async def _allows_email(db: AsyncSession, business_id: str, client_id: str) -> bool:
    latest = (await latest_consents(db, business_id, [client_id], "email")).get(client_id)
    return allows_marketing(latest)


async def test_a_delivered_event_marks_the_message_delivered(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    assert message.status == "sent" and message.provider_ref is not None
    ok(await email_event(api, _event("email.delivered", message.provider_ref), svix_id="evt_1"))
    assert (await _message(db, message.id)).status == "delivered"
    row = await _webhook(db, "evt_1")
    assert row.provider == "resend" and row.event == "email.delivered"
    assert row.payload["matched"] is True and row.payload["business_id"] == BIZ


@pytest.mark.parametrize(
    ("kind", "detail", "expected"),
    [
        ("email.bounced", {"bounce": {"type": "Permanent", "subType": "General"}}, "General"),
        ("email.failed", {"failed": {"reason": "reached_daily_quota"}}, "reached_daily_quota"),
        ("email.suppressed", {}, ""),
    ],
)
async def test_a_failure_event_marks_the_message_failed(
    api: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    kind: str,
    detail: dict[str, object],
    expected: str,
) -> None:
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    assert message.provider_ref is not None
    ok(
        await email_event(
            api, _event(kind, message.provider_ref, detail=detail), svix_id="evt_fail"
        )
    )
    assert (await _message(db, message.id)).status == "failed"
    assert (await _webhook(db, "evt_fail")).payload["detail"] == expected


async def test_a_delivered_event_after_a_failure_does_not_revive_it(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    ref = message.provider_ref or ""
    ok(await email_event(api, _event("email.bounced", ref), svix_id="evt_b"))
    ok(await email_event(api, _event("email.delivered", ref), svix_id="evt_d"))
    assert (await _message(db, message.id)).status == "failed"


async def test_a_complaint_withdraws_email_consent_through_the_thread(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=EMAIL)
    await _granted(db, BIZ, cid)
    message = await _sent_email(as_owner, db, cid)
    ok(
        await email_event(
            api, _event("email.complained", message.provider_ref or ""), svix_id="evt_c"
        )
    )
    assert (await _message(db, message.id)).status == "sent"
    latest = (await latest_consents(db, BIZ, [cid], "email")).get(cid)
    assert latest is not None and latest.status == "withdrawn" and latest.source == "complaint"
    assert not await _allows_email(db, BIZ, cid)


async def test_a_complaint_on_transactional_mail_resolves_the_client_by_tag(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=EMAIL)
    await _granted(db, BIZ, cid)
    body = _event("email.complained", "email_receipt", tags={"business": BIZ, "client": cid})
    ok(await email_event(api, body, svix_id="evt_receipt"))
    assert not await _allows_email(db, BIZ, cid)
    row = await _webhook(db, "evt_receipt")
    assert row.payload["matched"] is True and row.payload["business_id"] == BIZ


async def test_a_complaint_from_a_shared_mailbox_withdraws_every_client_on_it(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    first, second = await new_client(db, email=EMAIL), await new_client(db, email=EMAIL.upper())
    await _granted(db, BIZ, first)
    await _granted(db, BIZ, second)
    body = _event("email.complained", "email_shared", tags={"business": BIZ, "client": first})
    ok(await email_event(api, body, svix_id="evt_shared"))
    assert not await _allows_email(db, BIZ, first)
    assert not await _allows_email(db, BIZ, second)


async def test_an_event_without_an_email_id_is_recorded_unmatched(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = {"type": "email.delivered", "data": {"email_id": None, "to": [EMAIL]}}
    ok(await email_event(api, body, svix_id="evt_noid"))
    row = await _webhook(db, "evt_noid")
    assert row.payload["matched"] is False and row.payload["email_id"] is None


async def test_a_complaint_tagged_with_another_business_leaves_ours_alone(
    api: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    ours = await new_client(db, email=EMAIL)
    await _granted(db, BIZ, ours)
    rival = await factory.business(name="Rival Mail")
    theirs = await factory.client(business=rival)
    theirs.email = EMAIL
    await db.flush()
    await _granted(db, rival.id, theirs.id)
    body = _event(
        "email.complained", "email_rival", tags={"business": rival.id, "client": theirs.id}
    )
    ok(await email_event(api, body, svix_id="evt_rival"))
    assert not await _allows_email(db, rival.id, theirs.id)
    assert await _allows_email(db, BIZ, ours)
    crossed = _event(
        "email.complained", "email_crossed", tags={"business": BIZ, "client": theirs.id}
    )
    ok(await email_event(api, crossed, svix_id="evt_crossed"))
    assert (await _webhook(db, "evt_crossed")).payload["matched"] is False
    assert await _allows_email(db, BIZ, ours)


async def test_a_complaint_nobody_matches_is_recorded_unmatched(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    ok(await email_event(api, _event("email.complained", "email_ghost"), svix_id="evt_ghost"))
    row = await _webhook(db, "evt_ghost")
    assert row.payload["matched"] is False and row.payload["business_id"] is None


async def test_an_unknown_event_type_is_recorded_and_changes_nothing(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    ok(await email_event(api, _event("email.opened", message.provider_ref or ""), svix_id="evt_o"))
    assert (await _message(db, message.id)).status == "sent"
    assert (await _webhook(db, "evt_o")).event == "email.opened"


async def test_a_redelivery_is_recorded_once(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    body = _event("email.delivered", message.provider_ref or "")
    ok(await email_event(api, body, svix_id="evt_dup"))
    ok(await email_event(api, body, svix_id="evt_dup"))
    rows = (await db.execute(select(Webhook).where(Webhook.id == "resend_evt_dup"))).scalars().all()
    assert len(rows) == 1
    assert (await _message(db, message.id)).status == "delivered"


async def test_a_wrong_or_stale_signature_is_refused(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    body = _event("email.delivered", "email_x")
    res = await email_event(api, body, svix_id="evt_sig", signature="v1,AAAA")
    assert res.status_code == 401
    stale = clock.wall() - timedelta(minutes=10)
    assert (await email_event(api, body, svix_id="evt_sig", at=stale)).status_code == 401
    assert (await api.post("/webhooks/email", content=b"{}")).status_code == 401
    assert (
        await db.execute(select(Webhook.id).where(Webhook.id == "resend_evt_sig"))
    ).scalar_one_or_none() is None


async def test_a_body_that_is_not_an_event_is_acknowledged_and_recorded_as_failed(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    ok(await email_event(api, {}, svix_id="evt_raw", raw=b"not json"))
    row = await _webhook(db, "evt_raw")
    assert row.event == "unparsed" and row.status == "failed"
    ok(await email_event(api, {"data": {"email_id": "email_x"}}, svix_id="evt_untyped"))
    assert (await _webhook(db, "evt_untyped")).status == "failed"


async def test_an_event_for_an_uncommitted_send_is_retried_later(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    data = {"email_id": "email_soon", "to": [EMAIL], "tags": {"business": BIZ, "message": "msg_x"}}
    fresh = {"type": "email.delivered", "created_at": clock.wall().isoformat(), "data": data}
    assert (await email_event(api, fresh, svix_id="evt_soon")).status_code == 503
    unrecorded = await db.execute(select(Webhook.id).where(Webhook.id == "resend_evt_soon"))
    assert unrecorded.scalar_one_or_none() is None
    old = {**fresh, "created_at": (clock.wall() - timedelta(minutes=15)).isoformat()}
    ok(await email_event(api, old, svix_id="evt_soon"))
    assert (await _webhook(db, "evt_soon")).payload["matched"] is False


async def test_a_delivered_event_backfills_a_send_that_timed_out(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=EMAIL)
    thread = await open_thread(db, BIZ, cid, "email")
    note = Message(
        id=new_id("message"),
        business_id=BIZ,
        thread_id=thread.id,
        direction="out",
        channel="email",
        body="late",
        status="failed",
    )
    db.add(note)
    await db.flush()
    body = _event("email.delivered", "email_late", tags={"business": BIZ, "message": note.id})
    ok(await email_event(api, body, svix_id="evt_late"))
    row = await _message(db, note.id)
    assert row.status == "delivered" and row.provider_ref == "email_late"
    ok(await email_event(api, _event("email.bounced", "email_late"), svix_id="evt_late_bounce"))
    assert (await _message(db, note.id)).status == "failed"


async def test_an_sms_send_records_the_provider_reference(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=None)
    client = (await db.execute(select(Client).where(Client.id == cid))).scalar_one()
    client.phone = "+16045550123"
    await db.flush()
    res = ok(
        await as_owner.post("/v1/messages", json={"client_id": cid, "channel": "sms", "body": "Hi"})
    )
    assert (await _message(db, res.json()["id"])).provider_ref == "sms_fake1"


async def test_a_signed_event_of_another_kind_is_acknowledged_and_recorded(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    contact = {"type": "contact.created", "data": {"id": "c_1", "tags": None}}
    ok(await email_event(api, contact, svix_id="evt_contact"))
    row = await _webhook(db, "evt_contact")
    assert row.event == "contact.created" and row.payload["matched"] is False
    message = await _sent_email(as_owner, db, await new_client(db, email=EMAIL))
    bare = {"type": "email.delivered", "data": {"email_id": message.provider_ref, "tags": None}}
    ok(await email_event(api, bare, svix_id="evt_bare"))
    assert (await _message(db, message.id)).status == "delivered"


async def test_a_non_ascii_signature_header_is_refused(api: httpx.AsyncClient) -> None:
    now = str(int(clock.wall().timestamp()))
    headers = {
        b"svix-id": b"evt_latin",
        b"svix-timestamp": now.encode(),
        b"svix-signature": b"v1,\xe9abc",
        b"content-type": b"application/json",
    }
    res = await api.post("/webhooks/email", content=b"{}", headers=headers)
    assert res.status_code == 401


async def test_a_complaint_without_prior_consent_is_recorded_once(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=EMAIL)
    body = _event("email.complained", "email_first", tags={"business": BIZ, "client": cid})
    ok(await email_event(api, body, svix_id="evt_first"))
    ok(await email_event(api, body, svix_id="evt_second"))
    rows = (
        await db.execute(select(func.count()).select_from(Consent).where(Consent.client_id == cid))
    ).scalar_one()
    assert rows == 1
    latest = (await latest_consents(db, BIZ, [cid], "email")).get(cid)
    assert latest is not None and latest.source == "complaint"


async def test_an_archived_clients_complaint_writes_no_consent(
    api: httpx.AsyncClient, as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await new_client(db, email=EMAIL)
    message = await _sent_email(as_owner, db, cid)
    client = (await db.execute(select(Client).where(Client.id == cid))).scalar_one()
    client.deleted_at = clock.now()
    await db.flush()
    ok(
        await email_event(
            api, _event("email.complained", message.provider_ref or ""), svix_id="evt_t"
        )
    )
    tagged = _event("email.complained", "email_other", tags={"business": BIZ, "client": cid})
    ok(await email_event(api, tagged, svix_id="evt_g"))
    rows = (
        await db.execute(select(func.count()).select_from(Consent).where(Consent.client_id == cid))
    ).scalar_one()
    assert rows == 0
    assert (await _webhook(db, "evt_g")).payload["matched"] is False


def test_signature_verification_accepts_any_listed_v1_entry_and_rejects_the_rest() -> None:
    now = clock.now()
    ts = str(int(now.timestamp()))
    body = b'{"type":"email.delivered"}'
    good = resend_signature(RESEND_SECRET, "msg_1", ts, body)
    header = f"v2,unknown v1,{good}"
    assert valid_resend_signature(RESEND_SECRET, "msg_1", ts, body, header, now=now)
    assert not valid_resend_signature(RESEND_SECRET, "msg_1", ts, body, f"v2,{good}", now=now)
    assert not valid_resend_signature(RESEND_SECRET, "msg_2", ts, body, header, now=now)
    assert not valid_resend_signature("", "msg_1", ts, body, header, now=now)
    assert not valid_resend_signature("whsec_not-base64!", "msg_1", ts, body, header, now=now)
    assert not valid_resend_signature(RESEND_SECRET, "msg_1", "soon", body, header, now=now)
    later = now + timedelta(minutes=6)
    assert not valid_resend_signature(RESEND_SECRET, "msg_1", ts, body, header, now=later)


async def test_only_a_duplicate_event_id_counts_as_a_replay(db: AsyncSession) -> None:
    row: dict[str, object] = {
        "id": "resend_dup",
        "provider": "resend",
        "event": "email.delivered",
        "payload": {},
        "status": "processed",
        "processed_at": clock.now(),
    }
    await db.execute(insert(Webhook).values(**row))
    with pytest.raises(IntegrityError) as duplicate:
        async with db.begin_nested():
            await db.execute(insert(Webhook).values(**row))
    with pytest.raises(IntegrityError) as broken:
        async with db.begin_nested():
            await db.execute(
                insert(Webhook).values(**{**row, "id": "resend_x", "provider": "bogus"})
            )
    assert is_duplicate(duplicate.value)
    assert not is_duplicate(broken.value)
