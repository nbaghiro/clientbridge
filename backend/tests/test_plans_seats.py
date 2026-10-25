from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.errors import PaymentsNotConfigured
from clientbridge.integrations.identity import Identity
from clientbridge.integrations.stripe import PlanItem, PlanSubscription
from clientbridge.models.business import Business, Staff
from clientbridge.services import plans
from clientbridge.services.plans import run_sync_plans
from tests.conftest import (
    FakeEmailSender,
    FakeIdentityProvider,
    FakePaymentGateway,
    subscribed,
)
from tests.helpers import ok

BIZ = "bz_birchbark"
SUB = "sub_plan"


async def _premium(db: AsyncSession, gateway: FakePaymentGateway, seats: int) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(
            plan="premium",
            plan_status="active",
            stripe_account_id="acct_paying",
            stripe_subscription_id=SUB,
        )
    )
    await db.flush()
    gateway.plan_subscriptions[SUB] = PlanSubscription(
        id=SUB,
        status="active",
        customer_account="acct_paying",
        business_id=BIZ,
        items=subscribed("premium_month", PlanItem("seat_month", seats)),
        cancel_at_period_end=False,
        trial_end=None,
    )


def _billed(gateway: FakePaymentGateway) -> int:
    items = gateway.plan_subscriptions[SUB].items
    return next((item.quantity for item in items if item.product == "clientbridge_seat"), 0)


async def _seats(db: AsyncSession) -> int:
    return await plans.billed_seats(db, BIZ, clock.now())


async def _invite(as_owner: httpx.AsyncClient, address: str) -> httpx.Response:
    return await as_owner.post("/v1/staff/invites", json={"email": address, "role": "staff"})


async def test_an_invite_on_premium_bills_its_seat_before_it_is_sent(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    seats = await _seats(db)
    await _premium(db, gateway, seats)
    ok(await _invite(as_owner, "seat@test.ca"), 201)
    assert _billed(gateway) == seats + 1 == await _seats(db)


async def test_a_failed_seat_charge_fails_the_invite(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seats = await _seats(db)
    await _premium(db, gateway, seats)

    async def down(*args: object, **kwargs: object) -> PlanSubscription:
        raise PaymentsNotConfigured("stripe is down")

    monkeypatch.setattr(gateway, "set_plan_items", down)
    assert (await _invite(as_owner, "unpaid@test.ca")).status_code == 503
    unpaid = await db.scalar(select(Staff).where(Staff.invite_email == "unpaid@test.ca"))
    assert unpaid is None and await _seats(db) == seats


async def test_revoking_an_invite_releases_its_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _premium(db, gateway, await _seats(db))
    invite = ok(await _invite(as_owner, "brief@test.ca"), 201).json()
    before = _billed(gateway)
    assert (await as_owner.post(f"/v1/staff/invites/{invite['id']}/revoke")).status_code == 204
    assert _billed(gateway) == before - 1


async def test_removing_a_member_releases_their_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    seats = await _seats(db)
    await _premium(db, gateway, seats)
    ok(await as_owner.post("/v1/staff/st_priya/remove", json={"future": "cancel"}))
    assert _billed(gateway) == seats - 1


async def test_a_trial_stops_at_the_seat_cap(
    as_owner: httpx.AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(plan=None, plan_status="trialing", trial_ends_at=clock.now() + timedelta(1))
    )
    monkeypatch.setattr(plans, "PLAN_SEAT_CAP", await _seats(db))
    res = await _invite(as_owner, "over@test.ca")
    assert res.status_code == 409 and res.json()["error"] == "seat_limit"


async def test_team_stops_at_the_cap_and_premium_has_none(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(plans, "PLAN_SEAT_CAP", await _seats(db) + 1)
    ok(await _invite(as_owner, "last@test.ca"), 201)
    assert (await _invite(as_owner, "over@test.ca")).status_code == 409
    await _premium(db, gateway, await _seats(db))
    ok(await _invite(as_owner, "paid@test.ca"), 201)


async def test_accepting_rechecks_the_plan(
    as_owner: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    invite = ok(await _invite(as_owner, "late@test.ca"), 201).json()
    await db.execute(
        update(Business).where(Business.id == BIZ).values(plan=None, plan_status="lapsed")
    )
    await db.flush()
    identity = Identity(
        id=str(uuid4()),
        email="late@test.ca",
        verified_emails=frozenset({"late@test.ca"}),
        name="Late",
        session_id=str(uuid4()),
        second_factor=False,
    )
    res = await as_owner.post(
        "/v1/staff/invites/accept",
        json={"token": invite["invite_token"]},
        headers={"X-Session-Token": identities.issue(identity), "X-Business-Id": ""},
    )
    assert res.status_code == 402 and res.json()["error"] == "plan_required"


async def test_an_expired_invite_drops_out_at_the_daily_sync(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _premium(db, gateway, await _seats(db))
    invite = ok(await _invite(as_owner, "stale@test.ca"), 201).json()
    billed = _billed(gateway)
    await db.execute(
        update(Staff)
        .where(Staff.id == invite["id"])
        .values(invited_at=clock.now() - plans.INVITE_TTL - timedelta(minutes=1))
    )
    await db.flush()
    assert await run_sync_plans(db, gateway, clock.now()) == 1
    assert _billed(gateway) == billed - 1
    keys = len(gateway.plan_item_keys)
    assert await run_sync_plans(db, gateway, clock.now()) == 1
    assert len(gateway.plan_item_keys) == keys  # already at the count: nothing to change


async def test_the_fake_replays_a_repeated_seat_key(
    db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _premium(db, gateway, 2)
    wanted = [PlanItem("premium_month"), PlanItem("seat_month", 5)]
    first = await gateway.set_plan_items(SUB, items=wanted, idempotency_key="k")
    again = [PlanItem("premium_month"), PlanItem("seat_month", 9)]
    assert await gateway.set_plan_items(SUB, items=again, idempotency_key="k") == first
    assert _billed(gateway) == 5


async def test_an_invite_that_fails_after_billing_its_seat_gives_the_seat_back(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seats = await _seats(db)
    await _premium(db, gateway, seats)

    async def down(message: object) -> None:
        raise RuntimeError("mail is down")

    monkeypatch.setattr(email, "send", down)
    with pytest.raises(RuntimeError):
        await _invite(as_owner, "lost@test.ca")
    assert _billed(gateway) == seats
