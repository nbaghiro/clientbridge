import json
import pathlib
import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import PlanItem, PlanSubscription
from clientbridge.models.business import Business
from clientbridge.models.catalog import Subscription
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking
from clientbridge.services import plans
from clientbridge.services.bookings import run_reminders
from clientbridge.services.notifications import Notifier
from clientbridge.services.plans import run_trial_reminders
from tests.conftest import (
    Factory,
    FakeEmailSender,
    FakeIdentityProvider,
    FakePaymentGateway,
    FakePushSender,
    FakeSmsSender,
    session_token,
    subscribed,
)
from tests.helpers import STRIPE, key, local_hour, ok

BIZ = "bz_birchbark"
ACCOUNT = "acct_paying"
SUB = "sub_plan"
SLUG = "birchbark"


async def _set(db: AsyncSession, **values: object) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(**values))
    await db.flush()


async def _business(db: AsyncSession) -> Business:
    business = await db.get(Business, BIZ)
    assert business is not None
    await db.refresh(business)
    return business


async def _trial(db: AsyncSession, left: timedelta, **values: object) -> None:
    await _set(
        db,
        plan=None,
        plan_status="trialing",
        trial_ends_at=datetime.now(UTC) + left,
        stripe_subscription_id=None,
        **values,
    )


async def _subscribed(
    db: AsyncSession, gateway: FakePaymentGateway, *items: PlanItem, status: str = "active"
) -> None:
    await _set(
        db,
        plan="premium" if items[0].lookup_key.startswith("premium") else "team",
        plan_status="active",
        stripe_account_id=ACCOUNT,
        stripe_subscription_id=SUB,
    )
    gateway.plan_subscriptions[SUB] = _sub(*items, status=status)


def _sub(
    *items: PlanItem, sub_id: str = SUB, status: str = "active", account: str = ACCOUNT
) -> PlanSubscription:
    return PlanSubscription(
        id=sub_id,
        status=status,
        customer_account=account,
        business_id=BIZ,
        items=tuple(
            replace(row, current_period_end=datetime(2030, 2, 1, tzinfo=UTC))
            for row in (subscribed(*items) if items else subscribed("premium_month"))
        ),
        cancel_at_period_end=False,
        trial_end=None,
    )


def _event(
    event_type: str,
    sub_id: str = SUB,
    *,
    account: str = ACCOUNT,
    business_id: str = BIZ,
    connected: str | None = None,
    event_id: str | None = None,
) -> bytes:
    body: dict[str, object] = {
        "id": event_id or f"evt_{event_type}_{sub_id}",
        "type": event_type,
        "data": {
            "object": {
                "id": sub_id,
                "object": "subscription",
                "customer_account": account,
                "metadata": {"business_id": business_id},
            }
        },
    }
    if connected is not None:
        body["account"] = connected
    return json.dumps(body).encode()


async def _deliver(api: httpx.AsyncClient, body: bytes) -> None:
    ok(await api.post("/webhooks/stripe", content=body, headers=STRIPE))


async def test_status_shows_the_complimentary_plan_and_every_price(
    as_owner: httpx.AsyncClient,
) -> None:
    body = ok(await as_owner.get("/v1/plan")).json()
    assert (body["access"], body["plan"], body["managed"]) == ("active", "team", False)
    assert body["currency"] == "CAD" and body["seat_cap"] == plans.PLAN_SEAT_CAP
    prices = {(p["plan"], p["interval"]): p["amount_cents"] for p in body["prices"]}
    assert prices == {
        ("premium", "month"): 4999,
        ("premium", "year"): 49990,
        ("team", "month"): 9999,
        ("team", "year"): 99990,
        (None, "month"): 1000,
    }


async def test_status_reads_the_live_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("premium_year"), PlanItem("seat_month", 2))
    body = ok(await as_owner.get("/v1/plan")).json()
    assert (body["plan"], body["interval"], body["managed"]) == ("premium", "year", True)
    assert body["current_period_end"].startswith("2030-02-01")


async def test_only_the_owner_manages_the_plan(
    api: httpx.AsyncClient,
    db: AsyncSession,
    factory: Factory,
    identities: FakeIdentityProvider,
    gateway: FakePaymentGateway,
) -> None:
    business = await _business(db)
    user = await factory.user()
    await factory.staff(business=business, user=user, role="admin")
    token = await session_token(identities, db, user.id)
    api.headers.update({"X-Session-Token": token, "X-Business-Id": BIZ})
    choice = {"plan": "premium", "interval": "month"}
    assert (await api.get("/v1/plan")).status_code == 403
    assert (await api.post("/v1/plan/checkout", json=choice)).status_code == 403
    assert (await api.post("/v1/plan/change", json=choice)).status_code == 403
    assert (await api.post("/v1/plan/portal")).status_code == 403
    assert gateway.checkouts == [] and gateway.portal_sessions == []


async def test_staff_cannot_read_the_plan(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/plan")).status_code == 403


@pytest.mark.parametrize("plan", ["premium", "team"])
@pytest.mark.parametrize("interval", ["month", "year"])
async def test_checkout_bills_a_new_customer_account_and_carries_the_trial(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    plan: str,
    interval: str,
) -> None:
    await _trial(db, timedelta(days=10), stripe_account_id=None)
    res = await as_owner.post("/v1/plan/checkout", json={"plan": plan, "interval": interval})
    assert ok(res).json()["url"].startswith("https://checkout.stripe.test/")
    assert res.headers["cache-control"] == "no-store"
    (account,) = gateway.created_accounts
    assert gateway.configurations[account] == {"customer"}
    (checkout,) = gateway.checkouts
    business = await _business(db)
    assert business.stripe_account_id == account and checkout.account_id == account
    assert checkout.items[0] == PlanItem(f"{plan}_{interval}")
    assert all(item.lookup_key != "seat_month" for item in checkout.items) or plan == "premium"
    assert checkout.trial_end == business.trial_ends_at
    assert business.stripe_requirements["merchant"] is False
    status = ok(await as_owner.get("/v1/connect/status")).json()
    assert (status["connected"], status["kyc_status"]) == (False, "not_started")


async def test_checkout_on_premium_bills_each_seat(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=10))
    ok(await as_owner.post("/v1/plan/checkout", json={"plan": "premium", "interval": "month"}))
    seats = await plans.billed_seats(db, BIZ, datetime.now(UTC))
    assert seats > 0
    assert gateway.checkouts[0].items == (PlanItem("premium_month"), PlanItem("seat_month", seats))


async def test_a_yearly_checkout_leaves_the_monthly_seats_to_the_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=10))
    ok(await as_owner.post("/v1/plan/checkout", json={"plan": "premium", "interval": "year"}))
    assert gateway.checkouts[0].items == (PlanItem("premium_year"),)


async def test_checkout_with_less_than_two_days_left_bills_now(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(hours=30))
    ok(await as_owner.post("/v1/plan/checkout", json={"plan": "team", "interval": "month"}))
    assert gateway.checkouts[0].trial_end is None


async def test_checkout_adds_billing_to_an_existing_payments_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id="acct_merchant")
    ok(await as_owner.post("/v1/plan/checkout", json={"plan": "team", "interval": "year"}))
    assert gateway.created_accounts == []
    (added,) = gateway.customer_added
    assert added[0] == "acct_merchant" and added[1].province == "BC"
    actions = (await db.execute(select(Audit.action).where(Audit.entity_id == BIZ))).scalars()
    assert "plan.checkout" in set(actions)


async def test_checkout_replays_with_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5))
    headers = key()
    choice = {"plan": "team", "interval": "month"}
    first = ok(await as_owner.post("/v1/plan/checkout", json=choice, headers=headers)).json()
    second = ok(await as_owner.post("/v1/plan/checkout", json=choice, headers=headers)).json()
    assert first == second and len(gateway.checkouts) == 1


async def test_checkout_needs_the_business_address_for_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), brand={})
    res = await as_owner.post("/v1/plan/checkout", json={"plan": "team", "interval": "month"})
    assert res.status_code == 422 and res.json()["error"] == "business_address_incomplete"
    assert gateway.checkouts == []


async def test_checkout_refuses_a_business_already_paying(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"))
    res = await as_owner.post("/v1/plan/checkout", json={"plan": "premium", "interval": "month"})
    assert res.status_code == 409 and res.json()["error"] == "plan_active"


@pytest.mark.parametrize(
    "choice",
    [{"plan": "gold", "interval": "month"}, {"plan": "team", "interval": "week"}, {"plan": "team"}],
)
async def test_checkout_rejects_an_unknown_plan(
    as_owner: httpx.AsyncClient, choice: dict[str, str]
) -> None:
    assert (await as_owner.post("/v1/plan/checkout", json=choice)).status_code == 422


async def test_change_to_team_drops_the_seat_item_and_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("premium_month"), PlanItem("seat_month", 3))
    headers = key()
    choice = {"plan": "team", "interval": "year"}
    body = ok(await as_owner.post("/v1/plan/change", json=choice, headers=headers)).json()
    again = ok(await as_owner.post("/v1/plan/change", json=choice, headers=headers)).json()
    assert body == again and len(gateway.plan_item_keys) == 1
    assert (body["plan"], body["interval"]) == ("team", "year")
    assert gateway.plan_subscriptions[SUB].items == subscribed("team_year")
    assert (await _business(db)).plan == "team"


async def test_change_to_premium_bills_the_current_team(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"))
    ok(await as_owner.post("/v1/plan/change", json={"plan": "premium", "interval": "month"}))
    seats = await plans.billed_seats(db, BIZ, datetime.now(UTC))
    assert gateway.plan_subscriptions[SUB].items == subscribed(
        "premium_month", PlanItem("seat_month", seats)
    )
    assert (await _business(db)).plan == "premium"


async def test_change_and_portal_need_a_subscription(as_owner: httpx.AsyncClient) -> None:
    choice = {"plan": "team", "interval": "month"}
    for res in (
        await as_owner.post("/v1/plan/change", json=choice),
        await as_owner.post("/v1/plan/portal"),
    ):
        assert res.status_code == 409 and res.json()["error"] == "plan_not_managed"


async def test_portal_opens_for_the_billing_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"))
    res = ok(await as_owner.post("/v1/plan/portal"))
    assert res.json()["url"].startswith("https://billing.stripe.test/")
    assert gateway.portal_sessions == [ACCOUNT]


async def test_a_new_subscription_is_adopted_and_its_seats_reconciled(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(
        PlanItem("premium_month"), PlanItem("seat_month", 1), status="trialing"
    )
    await _deliver(api, _event("customer.subscription.created"))
    business = await _business(db)
    assert (business.plan, business.plan_status) == ("premium", "active")
    assert business.stripe_subscription_id == SUB
    seats = await plans.billed_seats(db, BIZ, datetime.now(UTC))
    assert gateway.plan_subscriptions[SUB].items[1] == subscribed(PlanItem("seat_month", seats))[0]


@pytest.mark.parametrize(
    ("stripe_status", "plan_status", "plan"),
    [
        ("past_due", "past_due", "team"),
        ("unpaid", "lapsed", None),
        ("canceled", "lapsed", None),
        ("paused", "lapsed", None),
        ("active", "active", "team"),
    ],
)
async def test_updates_mirror_the_fetched_subscription(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    stripe_status: str,
    plan_status: str,
    plan: str | None,
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"), status=stripe_status)
    await _deliver(api, _event("customer.subscription.updated"))
    business = await _business(db)
    assert (business.plan_status, business.plan) == (plan_status, plan)


async def test_a_deleted_subscription_lapses_the_business(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"), status="canceled")
    await _deliver(api, _event("customer.subscription.deleted"))
    business = await _business(db)
    assert plans.plan_access(business, datetime.now(UTC)) == "lapsed"


async def test_an_incomplete_subscription_changes_nothing(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"), status="incomplete")
    await _deliver(api, _event("customer.subscription.created"))
    business = await _business(db)
    assert (business.plan_status, business.stripe_subscription_id) == ("trialing", SUB)


async def test_out_of_order_events_end_at_the_fetched_state(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"))
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"), status="past_due")
    await _deliver(api, _event("customer.subscription.updated", event_id="evt_late"))
    await _deliver(api, _event("customer.subscription.updated", event_id="evt_early"))
    assert (await _business(db)).plan_status == "past_due"


async def test_a_repeated_event_is_applied_once(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"), status="past_due")
    body = _event("customer.subscription.updated")
    await _deliver(api, body)
    await _set(db, plan_status="active")
    await _deliver(api, body)
    assert (await _business(db)).plan_status == "active"


async def test_a_second_live_subscription_is_not_adopted(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"))
    gateway.plan_subscriptions["sub_other"] = _sub(PlanItem("premium_month"), sub_id="sub_other")
    await _deliver(api, _event("customer.subscription.created", "sub_other"))
    await _deliver(api, _event("customer.subscription.updated", "sub_other"))
    business = await _business(db)
    assert (business.stripe_subscription_id, business.plan) == (SUB, "team")


async def test_events_for_another_business_change_nothing(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"))
    await _deliver(api, _event("customer.subscription.created", account="acct_nobody"))
    await _deliver(api, _event("customer.subscription.created", business_id="bz_demo_second"))
    business = await _business(db)
    assert (business.plan_status, business.stripe_subscription_id) == ("trialing", None)


async def test_a_connected_account_subscription_never_touches_the_plan(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("team_month"), status="canceled")
    body = _event("customer.subscription.updated", connected=ACCOUNT)
    await _deliver(api, body)
    assert (await _business(db)).plan_status == "active"


async def test_a_platform_event_never_touches_client_memberships(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    membership = await db.scalar(select(Subscription).limit(1))
    assert membership is not None and membership.provider_ref is not None
    before = membership.status
    gateway.plan_subscriptions[membership.provider_ref] = _sub(
        PlanItem("team_month"), sub_id=membership.provider_ref, status="canceled"
    )
    await _deliver(api, _event("customer.subscription.deleted", membership.provider_ref))
    await db.refresh(membership)
    assert membership.status == before


async def test_a_lapsed_business_reads_but_cannot_write(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _trial(db, -timedelta(minutes=1))
    assert (await as_owner.get("/v1/staff/team")).status_code == 200
    res = await as_owner.post("/v1/clients", json={"name": "New Client"})
    assert res.status_code == 402 and res.json()["error"] == "plan_required"
    invite = await as_owner.post("/v1/staff/invites", json={"email": "x@test.ca", "role": "staff"})
    assert invite.status_code == 402
    renamed = await as_owner.patch("/v1/staff/st_priya", json={"role": "staff"})
    assert renamed.status_code == 402
    assert (await as_owner.get("/v1/plan")).status_code == 200


async def test_a_lapsed_business_can_still_choose_a_plan_and_export(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, -timedelta(days=1))
    ok(await as_owner.post("/v1/plan/checkout", json={"plan": "team", "interval": "month"}))
    assert gateway.checkouts[0].trial_end is None
    export = await as_owner.post("/v1/reports/export", json={})
    assert export.status_code != 402


async def test_a_trial_and_a_past_due_plan_keep_full_access(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _trial(db, timedelta(days=1))
    ok(await as_owner.post("/v1/clients", json={"name": "Trial Client"}), 201)
    await _set(db, plan="team", plan_status="past_due")
    ok(await as_owner.post("/v1/clients", json={"name": "Late Client"}), 201)


async def test_a_lapsed_business_takes_no_public_bookings(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _trial(db, -timedelta(days=1))
    body = {
        "item_id": "it_groom_sm",
        "staff_id": "st_owner",
        "starts_at": "2027-03-02T18:50:00Z",
        "client": {"name": "Web Client", "email": "web@example.com"},
    }
    res = await api.post(f"/book/{SLUG}", json=body)
    assert res.status_code == 409 and res.json()["error"] == "business_unavailable"


async def test_a_lapsed_business_sends_no_booking_reminders(
    db: AsyncSession,
    email: FakeEmailSender,
    sms: FakeSmsSender,
    push: FakePushSender,
) -> None:
    now = datetime(2030, 1, 1, tzinfo=UTC)
    await _set(db, plan=None, plan_status="lapsed")
    booking = await db.scalar(select(Booking).where(Booking.business_id == BIZ).limit(1))
    assert booking is not None
    assert await run_reminders(db, Notifier(email, sms, push), now) == 0


async def test_trial_reminders_go_three_days_before_and_on_the_last_day(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    now = await local_hour(db, 9)
    notifier = Notifier(email, sms, push)
    await _trial(db, timedelta(days=3, hours=2), billing_email="owner@birchbark.test")
    assert await run_trial_reminders(db, notifier, now) == 1
    assert email.sent[-1].to == "owner@birchbark.test"
    assert "/setup/plan" in email.sent[-1].body
    await _trial(db, timedelta(hours=5))
    assert await run_trial_reminders(db, notifier, now) == 1
    assert email.sent[-1].subject != email.sent[0].subject
    await _trial(db, timedelta(days=5))
    assert await run_trial_reminders(db, notifier, now) == 0
    await _set(db, plan="team", plan_status="active", trial_ends_at=now + timedelta(hours=5))
    assert await run_trial_reminders(db, notifier, now) == 0
    later = await local_hour(db, 10)
    await _trial(db, timedelta(hours=5))
    assert await run_trial_reminders(db, notifier, later) == 0


async def test_the_renewal_date_comes_from_the_plan_item_not_the_seat_item(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _subscribed(db, gateway, PlanItem("premium_year"))
    seat, plan = subscribed(PlanItem("seat_month", 2), "premium_year")
    gateway.plan_subscriptions[SUB] = replace(
        _sub(),
        items=(
            replace(seat, current_period_end=datetime(2030, 2, 1, tzinfo=UTC)),
            replace(plan, current_period_end=datetime(2030, 12, 1, tzinfo=UTC)),
        ),
    )
    body = ok(await as_owner.get("/v1/plan")).json()
    assert body["current_period_end"].startswith("2030-12-01")


def test_the_site_shows_the_prices_stripe_bills() -> None:
    site = (
        pathlib.Path(__file__).parents[2] / "frontend/apps/site/src/content/plans.ts"
    ).read_text()

    def cents(path: str) -> int:
        tier, _, interval = path.partition(".")
        block = re.search(rf"{tier}: \{{([^}}]*)\}}", site) if interval else None
        source = block.group(1) if block else site
        found = re.search(rf"{interval or tier}: (\d+)", source)
        assert found is not None, path
        return int(found.group(1))

    assert {key: price.amount_cents for key, price in plans.PLAN_PRICES.items()} == {
        "premium_month": cents("premium.month"),
        "premium_year": cents("premium.year"),
        "team_month": cents("team.month"),
        "team_year": cents("team.year"),
        "seat_month": cents("seat"),
    }


async def test_an_incomplete_subscription_is_recorded_and_its_activation_applies(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"), status="incomplete")
    await _deliver(api, _event("customer.subscription.created", event_id="evt_new"))
    business = await _business(db)
    assert (business.stripe_subscription_id, business.plan_status) == (SUB, "trialing")
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"), status="active")
    await _deliver(api, _event("customer.subscription.updated", event_id="evt_paid"))
    business = await _business(db)
    assert (business.plan, business.plan_status) == ("team", "active")


async def test_an_update_for_a_subscription_never_seen_is_adopted_by_its_metadata(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("premium_month"), status="active")
    await _deliver(api, _event("customer.subscription.updated"))
    business = await _business(db)
    assert (business.stripe_subscription_id, business.plan) == (SUB, "premium")


async def test_an_expired_first_payment_leaves_the_trial_running(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _trial(db, timedelta(days=5), stripe_account_id=ACCOUNT)
    gateway.plan_subscriptions[SUB] = _sub(PlanItem("team_month"), status="incomplete_expired")
    await _deliver(api, _event("customer.subscription.updated"))
    business = await _business(db)
    assert plans.plan_access(business, datetime.now(UTC)) == "trial"
