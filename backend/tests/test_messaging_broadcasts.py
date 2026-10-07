from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Broadcast
from clientbridge.services.consents import prefs_token, record_consent
from clientbridge.services.messaging import run_due_broadcasts
from tests.conftest import Factory, FakeEmailSender, FakeSmsSender
from tests.helpers import key, ok

BIZ = "bz_birchbark"


async def _audience(db: AsyncSession) -> dict[str, str]:
    """Four reachable clients: agreed, implied, opted out, never asked; the seed is unreachable."""
    await db.execute(update(Client).where(Client.business_id == BIZ).values(phone=None, email=None))
    ids: dict[str, str] = {}
    for i, name in enumerate(["agreed", "implied", "stopped", "never"]):
        client = Client(
            id=new_id("client"),
            business_id=BIZ,
            name=name.title(),
            phone=f"+1514555800{i}",
            email=f"{name}@example.ca",
            status="active",
            tags=["promo"],
            custom_fields={},
        )
        db.add(client)
        ids[name] = client.id
    await db.flush()
    later = datetime.now(UTC) + timedelta(days=30)
    for channel in ("sms", "email"):
        await record_consent(
            db,
            BIZ,
            ids["agreed"],
            channel=channel,
            status="granted",
            source="form",
            recorded_by=None,
        )
        await record_consent(
            db,
            BIZ,
            ids["implied"],
            channel=channel,
            status="implied",
            source="online_booking",
            recorded_by=None,
            expires_at=later,
        )
        await record_consent(
            db,
            BIZ,
            ids["stopped"],
            channel=channel,
            status="withdrawn",
            source="unsubscribe",
            recorded_by=None,
        )
    return ids


async def test_broadcast_reaches_only_clients_who_agreed(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    await _audience(db)
    out = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={
                "name": "Promo",
                "channel": "sms",
                "body": "Spring sale",
                "audience": {"tags": ["promo"]},
            },
        )
    ).json()
    assert (out["recipient_count"], out["excluded_count"]) == (2, 2)
    assert sorted(m.to for m in sms.sent) == ["+15145558000", "+15145558001"]
    assert all(m.body.endswith("Reply STOP to opt out.") for m in sms.sent)


async def test_email_broadcast_carries_a_signed_unsubscribe_link(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    ids = await _audience(db)
    ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "News", "channel": "email", "body": "Hello", "audience": {"all": True}},
        )
    )
    to_agreed = next(m for m in email.sent if m.to == "agreed@example.ca")
    assert f"/prefs/{prefs_token(ids['agreed'])}" in to_agreed.body
    assert not any(m.to == "stopped@example.ca" for m in email.sent)


async def test_broadcast_row_keeps_its_counts(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _audience(db)
    out = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "Tags", "channel": "sms", "body": "Hi", "audience": {"tags": ["promo"]}},
        )
    ).json()
    row = (await db.execute(select(Broadcast).where(Broadcast.id == out["id"]))).scalar_one()
    assert (row.recipient_count, row.excluded_count, row.status) == (2, 2, "sent")


async def _scheduled(db: AsyncSession, *, business_id: str = BIZ) -> str:
    broadcast = Broadcast(
        id=new_id("broadcast"),
        business_id=business_id,
        name="Later",
        channel="sms",
        body="Soon",
        audience={},
        status="scheduled",
        scheduled_at=datetime.now(UTC) + timedelta(days=1),
    )
    db.add(broadcast)
    await db.flush()
    return broadcast.id


async def test_cancel_a_scheduled_broadcast(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    await _audience(db)
    bid = await _scheduled(db)
    out = ok(await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).json()
    assert out["status"] == "canceled"
    later = datetime.now(UTC) + timedelta(days=2)
    await run_due_broadcasts(db, sms, email, later)
    assert sms.sent == []  # a canceled broadcast never goes out
    assert (await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 409


async def test_cancel_refuses_a_sent_broadcast(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _audience(db)
    sent = ok(
        await as_owner.post(
            "/v1/broadcasts",
            json={"name": "Now", "channel": "sms", "body": "Hi"},
            headers=key(),
        )
    ).json()
    assert (await as_owner.post(f"/v1/broadcasts/{sent['id']}/cancel")).status_code == 409


async def test_staff_cannot_cancel(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _scheduled(db)
    assert (await as_staff.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 403


async def test_cancel_is_tenant_scoped(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Broadcasts")
    bid = await _scheduled(db, business_id=other.id)
    assert (await as_owner.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 404
    row = (await db.execute(select(Broadcast).where(Broadcast.id == bid))).scalar_one()
    assert row.status == "scheduled"


async def test_cancel_unknown_broadcast_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/broadcasts/bc_nope/cancel")).status_code == 404


async def test_cancel_needs_a_session_401(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _scheduled(db)
    assert (await unauth.post(f"/v1/broadcasts/{bid}/cancel")).status_code == 401


async def test_the_job_sends_a_due_broadcast_and_keeps_its_counts(
    db: AsyncSession, sms: FakeSmsSender, email: FakeEmailSender
) -> None:
    ids = await _audience(db)
    bid = await _scheduled(db)
    await db.execute(
        update(Broadcast).where(Broadcast.id == bid).values(audience={"tags": ["promo"]})
    )
    await db.flush()
    later = datetime.now(UTC) + timedelta(days=2)
    assert await run_due_broadcasts(db, sms, email, later) >= 1
    row = (
        await db.execute(
            select(Broadcast).where(Broadcast.id == bid).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert (row.recipient_count, row.excluded_count, row.status) == (2, 2, "sent")
    stopped = await db.get(Client, ids["stopped"])
    assert stopped is not None
    assert stopped.phone not in {m.to for m in sms.sent}
    assert sorted(m.to for m in sms.sent) == ["+15145558000", "+15145558001"]
