import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business
from clientbridge.models.platform import WebhookEvent

BIZ = "bz_birchbark"


def _event(event_id: str, account_id: str, *, charges_enabled: bool = True) -> str:
    body: dict[str, object] = {
        "id": event_id,
        "type": "account.updated",
        "data": {"object": {"id": account_id, "charges_enabled": charges_enabled}},
    }
    return json.dumps(body)


async def test_account_updated_enables_charges(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id="acct_x"))
    await db.flush()
    res = await api.post(
        "/webhooks/stripe",
        content=_event("evt_1", "acct_x"),
        headers={"Stripe-Signature": "good"},
    )
    assert res.status_code == 200
    enabled = (
        await db.execute(select(Business.stripe_charges_enabled).where(Business.id == BIZ))
    ).scalar_one()
    assert enabled is True


async def test_bad_signature_rejected(api: httpx.AsyncClient) -> None:
    res = await api.post(
        "/webhooks/stripe",
        content=_event("evt_2", "acct_x"),
        headers={"Stripe-Signature": "bad"},
    )
    assert res.status_code == 400


async def test_duplicate_event_is_noop(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_y", stripe_charges_enabled=False)
    )
    await db.flush()
    body = _event("evt_dup", "acct_y", charges_enabled=True)
    first = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    # flip charges back off, then replay the SAME event id — dedup must skip re-dispatch
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=False)
    )
    await db.flush()
    second = await api.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": "good"})
    assert first.status_code == 200 and second.status_code == 200
    enabled = (
        await db.execute(select(Business.stripe_charges_enabled).where(Business.id == BIZ))
    ).scalar_one()
    assert enabled is False  # replay was a no-op, not a re-enable
    rows = (
        (await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == "evt_dup")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
