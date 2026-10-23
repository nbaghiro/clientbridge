import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, request_hash, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.locale import message
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import zone
from clientbridge.integrations.stripe import (
    GatewayEvent,
    PaymentGateway,
    PlanItem,
    PlanSubscription,
    PostalAddress,
    SubscribedItem,
)
from clientbridge.models.business import Business, Plan, PlanStatus, Staff
from clientbridge.schemas.plans import (
    PlanAccess,
    PlanChoice,
    PlanInterval,
    PlanLink,
    PlanOut,
    PlanPriceOut,
)
from clientbridge.services.business import (
    apply_account_status,
    businesses_at_hour,
    postal_address,
)
from clientbridge.services.deliveries import (
    DeliveryQueue,
    QueuedEmail,
    QueuedPush,
    QueuedSms,
    dispatch,
)
from clientbridge.services.notifications import Notifier, plan_link

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlanPrice:
    product: str
    amount_cents: int
    interval: PlanInterval


PLAN_CURRENCY = "cad"
# Stripe's tax code for business-use software as a service
PLAN_TAX_CODE = "txcd_10103001"
SEAT_KEY = "seat_month"
# keyed by Stripe price lookup key; tax-exclusive, and a year costs ten months
PLAN_PRICES: dict[str, PlanPrice] = {
    "premium_month": PlanPrice("clientbridge_premium", 4999, "month"),
    "premium_year": PlanPrice("clientbridge_premium", 49990, "year"),
    "team_month": PlanPrice("clientbridge_team", 9999, "month"),
    "team_year": PlanPrice("clientbridge_team", 99990, "year"),
    SEAT_KEY: PlanPrice("clientbridge_seat", 1000, "month"),
}
# trial and Team allow this many members besides the owner; Premium bills each one instead
PLAN_SEAT_CAP = 50
# an invite holds its seat until it expires, so it can't be used to get a free seat
INVITE_TTL = timedelta(days=7)
# Checkout refuses a trial_end closer than this; app-core plans.ts TRIAL_CARRY_MS mirrors it
_CHECKOUT_TRIAL_MIN = timedelta(hours=48)
_REMINDER_HOUR = 9
_REMINDER_LEAD = timedelta(days=3)
_LIVE: tuple[PlanStatus, ...] = ("active", "past_due")
_ENDED = ("canceled", "incomplete_expired")
_TIERS: dict[str, Plan] = {"premium": "premium", "team": "team"}
_PRODUCT_TIERS: dict[str, Plan] = {
    price.product: tier
    for key, price in PLAN_PRICES.items()
    if (tier := _TIERS.get(key.partition("_")[0])) is not None
}
_INTERVALS: dict[str, PlanInterval] = {"month": "month", "year": "year"}
_STRIPE_STATUS: dict[str, PlanStatus] = {
    "active": "active",
    "trialing": "active",
    "past_due": "past_due",
    "unpaid": "lapsed",
    "canceled": "lapsed",
    "paused": "lapsed",
    "incomplete_expired": "lapsed",
}


def product_names(locale: str) -> dict[str, str]:
    """The Stripe product names owners see in Checkout, on invoices and in the portal."""
    return {
        "clientbridge_premium": message(locale, "plans.premium"),
        "clientbridge_team": message(locale, "plans.team"),
        "clientbridge_seat": message(locale, "plans.seat"),
    }


def plan_access(business: Business, now: datetime) -> PlanAccess:
    if business.plan_status == "trialing":
        return "trial" if now < business.trial_ends_at else "lapsed"
    if business.plan_status == "active":
        return "active"
    if business.plan_status == "past_due":
        return "past_due"
    return "lapsed"


def serving(now: datetime) -> ColumnElement[bool]:
    """The businesses that are not lapsed, for jobs that message their clients."""
    return or_(
        Business.plan_status.in_(_LIVE),
        and_(Business.plan_status == "trialing", Business.trial_ends_at > now),
    )


def plan_required() -> AppError:
    return AppError(
        "the business is paused until a plan is chosen", code="plan_required", status_code=402
    )


async def assert_writable(db: AsyncSession, business_id: str, now: datetime) -> None:
    """402 when the business has lapsed: it can sign in and read, but not change anything."""
    business = await db.get(Business, business_id)
    if business is None:
        raise NotFound("business not found")
    if plan_access(business, now) == "lapsed":
        raise plan_required()


def assert_serving(business: Business, now: datetime) -> None:
    """A lapsed business takes no new bookings, orders or estimate acceptances."""
    if plan_access(business, now) == "lapsed":
        raise Conflict("this business isn't available right now", code="business_unavailable")


def seat_cap(business: Business, now: datetime) -> int | None:
    """None when every seat is billed (Premium), else the most members besides the owner."""
    if business.plan == "premium" and plan_access(business, now) in _LIVE:
        return None
    return PLAN_SEAT_CAP


def live_invite(now: datetime) -> ColumnElement[bool]:
    return func.coalesce(Staff.invited_at, Staff.created_at) > now - INVITE_TTL


async def billed_seats(
    db: AsyncSession, business_id: str, now: datetime, *, excluding: str | None = None
) -> int:
    """Members besides the owner, counting an invite until it is accepted or expires."""
    query = scoped(Staff, business_id).where(
        Staff.role != "owner",
        or_(Staff.status == "active", and_(Staff.status == "invited", live_invite(now))),
    )
    if excluding is not None:
        query = query.where(Staff.id != excluding)
    return int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)


async def assert_seat_free(
    db: AsyncSession, business: Business, now: datetime, *, member: str | None = None
) -> int:
    """The seat count with `member` (or a new one) in it, refused past the cap or when lapsed."""
    if plan_access(business, now) == "lapsed":
        raise plan_required()
    seats = await billed_seats(db, business.id, now, excluding=member) + 1
    cap = seat_cap(business, now)
    if cap is not None and seats > cap:
        raise Conflict(f"this plan allows {cap} team members", code="seat_limit")
    return seats


def _assert_fits(plan: Plan, seats: int) -> None:
    """Team includes up to the cap; a business with more members stays on Premium."""
    if plan == "team" and seats > PLAN_SEAT_CAP:
        raise Conflict(f"Team allows {PLAN_SEAT_CAP} team members", code="seat_limit")


def plan_items(plan: Plan, interval: PlanInterval, seats: int) -> list[PlanItem]:
    items = [PlanItem(f"{plan}_{interval}")]
    if plan == "premium" and seats > 0:
        items.append(PlanItem(SEAT_KEY, seats))
    return items


def _plan_item(sub: PlanSubscription) -> SubscribedItem | None:
    return next((item for item in sub.items if item.product in _PRODUCT_TIERS), None)


def _seats_of(sub: PlanSubscription) -> int:
    seat = PLAN_PRICES[SEAT_KEY].product
    return next((item.quantity for item in sub.items if item.product == seat), 0)


def _tier_of(sub: PlanSubscription) -> tuple[Plan | None, PlanInterval | None]:
    item = _plan_item(sub)
    if item is None:
        return None, None
    return _PRODUCT_TIERS.get(item.product), _INTERVALS.get(item.interval)


async def sync_seats(gateway: PaymentGateway, business: Business, seats: int) -> None:
    """Set a Premium subscription's seat quantity; absolute, so a retry sets the same number."""
    if business.plan != "premium" or business.stripe_subscription_id is None:
        return
    if business.plan_status not in _LIVE:
        return
    sub = await gateway.get_plan_subscription(business.stripe_subscription_id)
    tier, interval = _tier_of(sub)
    if tier is None or interval is None or _seats_of(sub) == seats:
        return
    await gateway.set_plan_items(
        sub.id,
        items=plan_items(tier, interval, seats),
        idempotency_key=f"plan-seats:{business.id}:{secrets.token_hex(8)}",
    )


def _prices() -> list[PlanPriceOut]:
    return [
        PlanPriceOut(
            plan=_TIERS.get(key.partition("_")[0]),
            interval=price.interval,
            amount_cents=price.amount_cents,
        )
        for key, price in PLAN_PRICES.items()
    ]


def _out(
    business: Business, seats: int, now: datetime, sub: PlanSubscription | None = None
) -> PlanOut:
    _, interval = _tier_of(sub) if sub is not None else (None, None)
    item = _plan_item(sub) if sub is not None else None
    return PlanOut(
        access=plan_access(business, now),
        plan=business.plan,
        plan_status=business.plan_status,
        trial_ends_at=business.trial_ends_at,
        managed=business.stripe_subscription_id is not None and business.plan_status in _LIVE,
        interval=interval,
        seats=seats,
        seat_cap=seat_cap(business, now),
        current_period_end=item.current_period_end if item is not None else None,
        cancel_at_period_end=sub.cancel_at_period_end if sub is not None else False,
        currency=PLAN_CURRENCY.upper(),
        prices=_prices(),
    )


def _key(idempotency_key: str | None) -> str:
    return idempotency_key or secrets.token_hex(8)


def _address(business: Business) -> PostalAddress:
    try:
        return postal_address(business)
    except Unprocessable as exc:
        raise Unprocessable(
            "add the business street address, city, province and postal code in Business "
            "settings before choosing a plan; plan prices are taxed by that address",
            code="business_address_incomplete",
        ) from exc


class PlanService:
    """The owner's platform plan: trial state, Checkout, plan changes and the billing portal."""

    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.gateway = gateway

    def _assert_owner(self) -> None:
        assert_role(self.principal, "owner", message="only the owner can manage the plan")

    async def _business(self, *, lock: bool = False) -> Business:
        query = select(Business).where(Business.id == self.principal.business_id)
        business = (
            await self.db.execute(
                query.with_for_update(key_share=True).execution_options(populate_existing=True)
                if lock
                else query
            )
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("business not found")
        return business

    async def status(self) -> PlanOut:
        self._assert_owner()
        now = clock.now()
        business = await self._business()
        seats = await billed_seats(self.db, business.id, now)
        sub = (
            await self.gateway.get_plan_subscription(business.stripe_subscription_id)
            if business.stripe_subscription_id is not None
            else None
        )
        return _out(business, seats, now, sub)

    async def checkout(self, choice: PlanChoice, idempotency_key: str | None) -> PlanLink:
        self._assert_owner()
        now = clock.now()
        business = await self._business(lock=True)
        # a complimentary plan is live without a subscription, and Checkout would bill it
        if plan_access(business, now) in _LIVE:
            raise Conflict("the business already has a plan; change it instead", code="plan_active")
        seats = await billed_seats(self.db, business.id, now)
        _assert_fits(choice.plan, seats)
        address = _address(business)
        cmd = Command(self.db, self.principal)
        account_id = business.stripe_account_id
        if account_id is None:
            account_id = await self.gateway.create_connected_account(
                business_name=business.name,
                email=business.billing_email,
                url=get_settings().page_url(business.slug),
                configurations=("customer",),
                address=address,
                idempotency_key=f"customer-account:{business.id}",
            )
            business.stripe_account_id = account_id
            apply_account_status(business, await self.gateway.get_account(account_id))
            cmd.record("connect.account_created", entity_type="business", entity_id=business.id)
            # kept even if a later Stripe call fails, so the retry reuses this account
            self.db.add_all(cmd.audits)
            await self.db.commit()
            cmd = Command(self.db, self.principal)
            business = await self._business(lock=True)
        else:
            await self.gateway.add_customer_configuration(account_id, address=address)
        left = business.trial_ends_at - now
        carry = plan_access(business, now) == "trial" and left >= _CHECKOUT_TRIAL_MIN
        parameters = request_hash(
            {
                "choice": choice,
                "seats": seats,
                "trial_end": business.trial_ends_at if carry else None,
            }
        )
        attempt = f"{_key(idempotency_key)}:{parameters}"
        # two tabs or a retry without a key would otherwise open two subscriptions
        if await self.gateway.close_plan_checkouts(account_id, keep=attempt):
            raise Conflict("the business already has a plan; change it instead", code="plan_active")
        url = await self.gateway.create_plan_checkout(
            account_id,
            # Checkout takes one interval, so a yearly plan gets its monthly seats once it exists
            items=plan_items(
                choice.plan, choice.interval, seats if choice.interval == "month" else 0
            ),
            business_id=business.id,
            trial_end=business.trial_ends_at if carry else None,
            success_url=f"{plan_link()}?checkout=done",
            cancel_url=plan_link(),
            attempt=attempt,
        )
        cmd.record(
            "plan.checkout",
            entity_type="business",
            entity_id=business.id,
            changes={"plan": choice.plan, "interval": choice.interval},
        )
        self.db.add_all(cmd.audits)
        # the Checkout URL is a credential, so it never enters command response storage
        await self.db.commit()
        return PlanLink(url=url)

    async def change(self, choice: PlanChoice, idempotency_key: str | None) -> PlanOut:
        self._assert_owner()

        async def run(cmd: Command) -> PlanOut:
            now = clock.now()
            business = await self._business(lock=True)
            subscription_id = business.stripe_subscription_id
            if subscription_id is None or business.plan_status not in _LIVE:
                raise Conflict("this business has no plan to change", code="plan_not_managed")
            seats = await billed_seats(self.db, business.id, now)
            _assert_fits(choice.plan, seats)
            sub = await self.gateway.set_plan_items(
                subscription_id,
                items=plan_items(choice.plan, choice.interval, seats),
                idempotency_key=f"plan-change:{business.id}:{_key(idempotency_key)}",
            )
            business.plan = _tier_of(sub)[0] or choice.plan
            cmd.record(
                "plan.change",
                entity_type="business",
                entity_id=business.id,
                changes={"plan": choice.plan, "interval": choice.interval},
            )
            return _out(business, seats, now, sub)

        return await run_command(
            self.db,
            self.principal,
            action="plan.change",
            run=run,
            response_model=PlanOut,
            idempotency_key=idempotency_key,
            request=choice,
        )

    async def portal(self) -> PlanLink:
        self._assert_owner()
        business = await self._business()
        if business.stripe_subscription_id is None or business.stripe_account_id is None:
            raise Conflict("this business has no plan to manage", code="plan_not_managed")
        url = await self.gateway.create_portal_session(
            business.stripe_account_id, return_url=plan_link()
        )
        cmd = Command(self.db, self.principal)
        cmd.record("plan.portal", entity_type="business", entity_id=business.id)
        self.db.add_all(cmd.audits)
        await self.db.commit()
        return PlanLink(url=url)


async def apply_subscription_event(
    db: AsyncSession, gateway: PaymentGateway, event: GatewayEvent
) -> None:
    """Mirror a platform subscription onto its business from Stripe's current copy."""
    data = event.data
    subscription_id, account = data.get("id"), data.get("customer_account")
    if not isinstance(subscription_id, str) or not isinstance(account, str):
        return
    business = (
        await db.execute(
            select(Business)
            .where(Business.stripe_account_id == account)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if business is None:
        _log.warning("plan subscription %s is for unknown account %s", subscription_id, account)
        return
    metadata = data.get("metadata")
    named = metadata.get("business_id") if isinstance(metadata, dict) else None
    if named is not None and named != business.id:
        _log.warning("plan subscription %s names %s, not %s", subscription_id, named, business.id)
        return
    current = business.stripe_subscription_id
    if current != subscription_id:
        # only a subscription our Checkout made for this business is adopted, whatever its event
        if named != business.id:
            return
        if current is not None and business.plan_status in _LIVE:
            duplicate = await gateway.get_plan_subscription(subscription_id)
            if duplicate.status in _ENDED:
                return
            # the business already pays through another subscription; this one would bill twice
            active = await gateway.get_plan_subscription(current)
            refunded = 0
            if (
                duplicate.created_at is not None
                and active.created_at is not None
                and duplicate.created_at >= active.created_at
            ):
                refunded = await gateway.refund_plan_subscription(subscription_id)
            await gateway.cancel_plan_subscription(subscription_id)
            _log.warning(
                "%s already has plan subscription %s; cancelled %s and refunded %d cents",
                business.id,
                current,
                subscription_id,
                refunded,
            )
            return
    sub = await gateway.get_plan_subscription(subscription_id)
    if current is not None and current != subscription_id and sub.status in _LIVE:
        previous = await gateway.get_plan_subscription(current)
        if previous.status not in _ENDED:
            await gateway.cancel_plan_subscription(current)
    business.stripe_subscription_id = subscription_id
    status = _STRIPE_STATUS.get(sub.status)
    trialing = plan_access(business, clock.now()) == "trial"
    # incomplete: Checkout has not collected the first payment; an expired one leaves the trial
    if status is None or (sub.status == "incomplete_expired" and trialing):
        await db.flush()
        return
    business.plan_status = status
    business.plan = _tier_of(sub)[0] if status != "lapsed" else None
    await db.flush()
    if event.type == "customer.subscription.created":
        await sync_seats(gateway, business, await billed_seats(db, business.id, clock.now()))


async def run_sync_seats(db: AsyncSession, gateway: PaymentGateway, now: datetime) -> int:
    """Set every Premium subscription's seats to the current count; catches expired invites."""
    identities = list(
        await db.scalars(
            select(Business.id).where(
                Business.plan == "premium",
                Business.plan_status.in_(_LIVE),
                Business.stripe_subscription_id.is_not(None),
            )
        )
    )
    await db.commit()
    synced = 0
    for identity in identities:
        try:
            business = await db.scalar(
                select(Business)
                .where(Business.id == identity)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
            if (
                business is not None
                and business.plan == "premium"
                and business.plan_status in _LIVE
            ):
                await sync_seats(gateway, business, await billed_seats(db, business.id, now))
                synced += 1
            await db.commit()
        except Exception:
            await db.rollback()
            _log.exception("seat sync failed for %s", identity)
    return synced


async def run_trial_reminders(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Email the owner at the last 9 a.m. local before the trial ends, and three days earlier."""
    sent = 0
    for business in await businesses_at_hour(db, now, _REMINDER_HOUR):
        if business.plan_status != "trialing" or now >= business.trial_ends_at:
            continue
        tz = zone(business.timezone)
        today = now.astimezone(tz).date()
        ends = business.trial_ends_at.astimezone(tz)
        last = ends.date() if ends.time() > time(_REMINDER_HOUR) else ends.date() - timedelta(1)
        if today == last:
            last_day = True
        elif today == last - _REMINDER_LEAD:
            last_day = False
        else:
            continue
        queue = DeliveryQueue(
            db,
            f"trial:{business.id}:{business.trial_ends_at.isoformat()}:{today.isoformat()}",
            business.id,
        )
        queued = Notifier(
            QueuedEmail(queue), QueuedSms(queue), QueuedPush(queue), raise_errors=True
        )
        await queued.on_trial_ending(db, business.id, last_day=last_day)
        await db.commit()
        for identity in queue.ids:
            sent += await dispatch(db, identity, notifier.email, notifier.sms, notifier.push)
    return sent
