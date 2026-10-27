import logging
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import SUPPORTED_ZONES, zone
from clientbridge.integrations.stripe import (
    ConnectAccount,
    PaymentGateway,
    PostalAddress,
    RequirementError,
)
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, ProvinceCode, Staff, User
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.platform import Audit, File
from clientbridge.schemas.business import BusinessSettingsUpdate, OnboardBody, public_email
from clientbridge.schemas.payments import KycStatus

_log = logging.getLogger(__name__)

_ADDRESS = ("unit", "street_number", "street_name", "city", "province", "postal_code")
# columns that cannot be emptied, so an explicit null leaves them as they are
_KEPT_ON_NULL = (
    "name",
    "timezone",
    "province",
    "filing_frequency",
    "tax_registered",
    "review_requests_enabled",
    "slug",
)
# the slug is the public page's subdomain, so it is a DNS label of 3 to 40 characters
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")
# environment hosts and mail records, Connect's root paths and names kept for our own pages
RESERVED_SLUGS = frozenset(
    {
        "admin",
        "api",
        "app",
        "assets",
        "blog",
        "book",
        "contract",
        "docs",
        "form",
        "help",
        "mail",
        "order",
        "pay",
        "prefs",
        "resend",
        "rsend",
        "send",
        "setup",
        "shop",
        "staging",
        "status",
        "support",
        "sync",
        "www",
    }
)
# Canada Post assigns each postal code's first letter to one province or territory
_POSTAL_PROVINCES: dict[str, tuple[ProvinceCode, ...]] = {
    "A": ("NL",),
    "B": ("NS",),
    "C": ("PE",),
    "E": ("NB",),
    "G": ("QC",),
    "H": ("QC",),
    "J": ("QC",),
    "K": ("ON",),
    "L": ("ON",),
    "M": ("ON",),
    "N": ("ON",),
    "P": ("ON",),
    "R": ("MB",),
    "S": ("SK",),
    "T": ("AB",),
    "V": ("BC",),
    "X": ("NT", "NU"),
    "Y": ("YT",),
}


def postal_address(business: Business) -> PostalAddress:
    """The business's legal street address, or 422 when a part Stripe needs is missing."""
    number, street, city = business.street_number, business.street_name, business.city
    province, postal_code = business.province, business.postal_code
    if not number or not street or not city or province is None or postal_code is None:
        raise Unprocessable(
            "add the business street address, city, province and postal code in Business "
            "settings before taking in-person card payments",
            code="business_address_incomplete",
        )
    return PostalAddress(
        line1=f"{number} {street}",
        line2=business.unit,
        city=city,
        province=province,
        postal_code=postal_code,
    )


async def business_tz(db: AsyncSession, business_id: str) -> ZoneInfo:
    """The business's timezone, in which hours and recurrences store wall-clock times."""
    tz = (
        await db.execute(select(Business.timezone).where(Business.id == business_id))
    ).scalar_one_or_none()
    return zone(tz) if tz is not None else zone("UTC")


async def load_staff(db: AsyncSession, biz: str, staff_id: str) -> Staff:
    """Load an active staff member by id, else NotFound."""
    row = (
        await db.execute(scoped(Staff, biz).where(Staff.id == staff_id, Staff.status == "active"))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("staff not found")
    return row


def staff_name() -> ColumnElement[str | None]:
    """A member's name from their account, or the address an open invite went to."""
    account = select(User.name).where(User.id == Staff.user_id).correlate(Staff).scalar_subquery()
    return func.coalesce(account, case((Staff.status == "invited", Staff.invite_email)))


async def staff_names(db: AsyncSession, biz: str, ids: Iterable[str]) -> dict[str, str | None]:
    wanted = set(ids)
    if not wanted:
        return {}
    rows = await db.execute(
        scoped(Staff, biz).with_only_columns(Staff.id, staff_name()).where(Staff.id.in_(wanted))
    )
    return dict(rows.tuples().all())


def local_today(business: Business) -> date:
    return clock.today(zone(business.timezone))


async def businesses_at_hour(db: AsyncSession, now: datetime, hour: int) -> list[Business]:
    """Businesses whose local clock reads `hour` at `now`, for daily client messages."""
    businesses = (await db.execute(select(Business))).scalars().all()
    return [b for b in businesses if now.astimezone(zone(b.timezone)).hour == hour]


QUIET_FROM = time(21)
QUIET_UNTIL = time(9)


def quiet_hours(now: datetime, tz: ZoneInfo) -> bool:
    """21:00 to 09:00 local, when no broadcast goes out."""
    local = now.astimezone(tz).time()
    return local >= QUIET_FROM or local < QUIET_UNTIL


def after_quiet_hours(at: datetime, tz: ZoneInfo) -> datetime:
    """`at`, or the next 09:00 local when `at` falls in quiet hours."""
    if not quiet_hours(at, tz):
        return at
    local = at.astimezone(tz)
    day = local.date() if local.time() < QUIET_UNTIL else local.date() + timedelta(days=1)
    return datetime.combine(day, QUIET_UNTIL, tzinfo=tz).astimezone(UTC)


def valid_timezone(name: str | None) -> str:
    if name is None or name not in SUPPORTED_ZONES:
        raise Unprocessable("timezone must be a supported time zone", code="invalid_timezone")
    return name


async def business_province(db: AsyncSession, business_id: str) -> str | None:
    """The business's province code (drives the sales-tax rates it collects); None if unset."""
    return (
        await db.execute(select(Business.province).where(Business.id == business_id))
    ).scalar_one_or_none()


def registered_on(registered: bool, since: date | None, day: date) -> bool:
    """Whether a business collects GST/HST on its calendar `day` (small suppliers don't)."""
    return registered and (since is None or since <= day)


async def business_tax_registered(db: AsyncSession, business_id: str, at: datetime) -> bool:
    """Whether the business collected GST/HST at the instant `at`, on its own calendar."""
    registered, since, tz = (
        await db.execute(
            select(Business.tax_registered, Business.tax_registered_on, Business.timezone).where(
                Business.id == business_id
            )
        )
    ).one()
    return registered_on(registered, since, at.astimezone(zone(tz)).date())


def derive_kyc_status(status: ConnectAccount) -> KycStatus:
    """The KYC phase from the card_payments and payouts capabilities, per Stripe's v2 guide."""
    if status.disabled_reason is not None:
        return "disabled"  # closed, unsupported, or only Stripe support can lift it
    if status.charges_enabled:
        return "enabled" if status.payouts_enabled and not status.past_due else "payouts_paused"
    # an account that only pays for its plan has no card capability yet
    if not status.details_submitted or status.card_status is None:
        return "not_started"
    if status.card_status == "pending":
        return "pending"
    if status.card_status == "restricted" or status.currently_due or status.past_due:
        return "restricted"
    return "pending"


def has_merchant(business: Business) -> bool:
    """Whether the mirrored account can take payments, not only pay for its plan."""
    return isinstance(business.stripe_requirements.get("card_status"), str)


def merchant_account(business: Business) -> str | None:
    """The account that takes the business's payments; None until it has the merchant config."""
    return business.stripe_account_id if has_merchant(business) else None


def kyc_status(business: Business) -> KycStatus:
    """The KYC state, read from the account fields mirrored off Stripe."""
    req = business.stripe_requirements

    def _due(key: str) -> list[str]:
        value = req.get(key)
        return [str(x) for x in value] if isinstance(value, list) else []

    reason = req.get("disabled_reason")
    return derive_kyc_status(
        ConnectAccount(
            id=business.stripe_account_id or "",
            charges_enabled=business.stripe_charges_enabled,
            payouts_enabled=business.stripe_payouts_enabled,
            disabled_reason=reason if isinstance(reason, str) else None,
            currently_due=_due("currently_due"),
            eventually_due=_due("eventually_due"),
            past_due=_due("past_due"),
            card_status=card if isinstance(card := req.get("card_status"), str) else None,
        )
    )


def apply_account_status(business: Business, status: ConnectAccount) -> None:
    """Mirror the connected-account KYC state onto the business (Stripe = source of truth)."""
    business.stripe_charges_enabled = status.charges_enabled
    business.stripe_payouts_enabled = status.payouts_enabled
    business.stripe_requirements = {
        "currently_due": status.currently_due,
        "eventually_due": status.eventually_due,
        "past_due": status.past_due,
        "disabled_reason": status.disabled_reason,
        "card_status": status.card_status,
        "current_deadline": status.current_deadline,
        "requirement_errors": [
            {"requirement": e.requirement, "code": e.code} for e in status.requirement_errors
        ],
    }


def requirement_errors(business: Business) -> list[RequirementError]:
    """The mirrored reasons Stripe rejected details the business sent."""
    rows = business.stripe_requirements.get("requirement_errors")
    errors: list[RequirementError] = []
    for row in cast(list[object], rows) if isinstance(rows, list) else []:
        if isinstance(row, dict):
            item = cast(dict[str, object], row)
            requirement, code = item.get("requirement"), item.get("code")
            if isinstance(requirement, str) and isinstance(code, str):
                errors.append(RequirementError(requirement, code))
    return errors


def _assert_postal_code_in_province(business: Business) -> None:
    code, province = business.postal_code, business.province
    if (
        code is not None
        and province is not None
        and province not in _POSTAL_PROVINCES.get(code[0], ())
    ):
        raise Unprocessable(
            "the postal code is not in the business's province",
            code="postal_code_province_mismatch",
        )


async def has_issued_tax(db: AsyncSession, business_id: str) -> bool:
    """Whether any issued document charged tax: such tax is fixed in its province's codes."""
    issued = or_(
        Line.invoice_id.in_(
            scoped(Invoice, business_id)
            .with_only_columns(Invoice.id)
            .where(Invoice.status != "draft")
        ),
        Line.estimate_id.in_(
            scoped(Estimate, business_id)
            .with_only_columns(Estimate.id)
            .where(Estimate.status != "draft")
        ),
        Line.order_id.in_(
            scoped(Order, business_id).with_only_columns(Order.id).where(Order.status != "void")
        ),
    )
    taxed_line = scoped(Line, business_id).where(Line.tax_amount_cents > 0, issued).exists()
    tax_leg = (
        scoped(Entry, business_id)
        .join(Account, Account.id == Entry.account_id)
        .where(Account.category == "tax")
        .exists()
    )
    return bool(await db.scalar(select(or_(taxed_line, tax_leg))))


def assert_public_slug(slug: str) -> None:
    if SLUG.match(slug) is None:
        raise Unprocessable(
            "a slug is 3 to 40 lowercase letters, digits or dashes", code="slug_invalid"
        )
    if slug in RESERVED_SLUGS or "clientbridge" in slug:
        raise Unprocessable("that slug is reserved", code="slug_reserved")


class BusinessService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.gateway = gateway

    async def _move_plan_account(self, business: Business) -> None:
        """Give a plan-only Stripe account the new address so its plan is taxed where it now is."""
        # a payments account's address was verified in Stripe onboarding and changes there
        if business.stripe_account_id is None or has_merchant(business):
            return
        try:
            address = postal_address(business)
        except Unprocessable:
            return
        try:
            await self.gateway.update_account_address(business.stripe_account_id, address=address)
        except Exception:
            # the settings stay saved; Stripe keeps the old address until the next change
            _log.exception("stripe address update failed for %s", business.id)

    async def _drop_terminal_location(self, business: Business, location_id: str) -> None:
        if business.stripe_account_id is None:
            return
        try:
            await self.gateway.delete_terminal_location(
                business.stripe_account_id, location_id=location_id
            )
        except Exception:
            # the address stays saved; the old Location only lingers unused in Stripe
            _log.exception("stripe terminal location delete failed for %s", business.id)

    async def _move_page_url(self, business: Business) -> None:
        if business.stripe_account_id is None:
            return
        url = get_settings().page_url(business.slug)
        try:
            await self.gateway.update_account_url(business.stripe_account_id, url=url)
        except Exception:
            # the slug stays saved; Stripe shows the old page until the next change
            _log.exception("stripe business url update failed for %s", business.id)

    async def _assert_logo(self, file_id: str) -> None:
        logo = (
            await self.db.execute(
                scoped(File, self.principal.business_id).where(
                    File.id == file_id,
                    File.parent_type == "business",
                    File.purpose == "logo",
                    File.uploaded_at.is_not(None),
                )
            )
        ).scalar_one_or_none()
        if logo is None:
            raise NotFound("logo not found")

    async def update_settings(self, data: BusinessSettingsUpdate) -> Business:
        """Owner/admin edit of the acting business's account fields (the principal's business)."""
        assert_role(
            self.principal,
            "owner",
            "admin",
            message="only an owner or admin can change account settings",
        )
        business = await self.db.get(Business, self.principal.business_id)
        if business is None:
            raise NotFound("business not found")
        previous_province = business.province
        previous_slug = business.slug
        if data.slug is not None and data.slug != business.slug:
            assert_public_slug(data.slug)
        fields = data.model_dump(exclude_unset=True, exclude={"brand", "setup_dismissed"})
        located = [getattr(business, key) for key in _ADDRESS]
        if data.timezone is not None:
            valid_timezone(data.timezone)
        if (
            data.province is not None
            and data.province != business.province
            and await has_issued_tax(self.db, business.id)
        ):
            raise Conflict(
                "the province cannot change once a document has charged tax",
                code="province_locked",
            )
        registered = business.tax_registered if data.tax_registered is None else data.tax_registered
        if data.tax_registered_on is not None and not registered:
            raise Unprocessable(
                "a registration date needs GST/HST registration turned on",
                code="tax_registration_off",
            )
        for key, value in fields.items():
            if value is not None or key not in _KEPT_ON_NULL:
                setattr(business, key, value)
        if not business.tax_registered:
            business.tax_registered_on = None
        _assert_postal_code_in_province(business)
        if data.setup_dismissed is not None:
            business.setup_dismissed_at = clock.now() if data.setup_dismissed else None
        if data.brand is not None:
            if data.brand.logo_file_id is not None:
                await self._assert_logo(data.brand.logo_file_id)
            if data.brand.public_staff_ids:
                staff = (
                    (
                        await self.db.execute(
                            scoped(Staff, business.id).where(
                                Staff.id.in_(data.brand.public_staff_ids), Staff.status == "active"
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if len({member.id for member in staff}) != len(set(data.brand.public_staff_ids)):
                    raise NotFound("public team member not found")
            merged = dict(business.brand or {})
            for key, value in data.brand.model_dump(exclude_unset=True).items():
                if value is None:
                    merged.pop(key, None)
                else:
                    merged[key] = value
            business.brand = merged
        for action, old, new in (
            ("business.province", previous_province, business.province),
            ("business.slug", previous_slug, business.slug),
        ):
            if old == new:
                continue
            self.db.add(
                Audit(
                    id=new_id("audit"),
                    business_id=business.id,
                    performed_by=self.principal.user_id,
                    action=action,
                    entity_type="business",
                    entity_id=business.id,
                    changes={"old": old, "new": new},
                )
            )
        moved = [getattr(business, key) for key in _ADDRESS] != located
        stale_location = business.stripe_terminal_location_id if moved else None
        if moved:
            # the Terminal location holds the old address; the next reader session mints one
            business.stripe_terminal_location_id = None
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise Conflict("another business uses that address", code="slug_taken") from exc
        await self.db.refresh(business)
        await self.db.commit()
        if moved:
            await self._move_plan_account(business)
        if stale_location is not None:
            await self._drop_terminal_location(business, stale_location)
        if business.slug != previous_slug:
            await self._move_page_url(business)
        return business


class OnboardingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def onboard(self, user_id: str, data: OnboardBody, *, email_verified: bool) -> Business:
        if not email_verified:
            raise Forbidden("verify your email address first", code="email_unverified")
        assert_public_slug(data.slug)
        biz = Business(
            id=new_id("business"),
            name=data.name,
            slug=data.slug,
            province=data.province,
            timezone=valid_timezone(data.timezone or "America/Toronto"),
            subject=data.subject,
        )
        self.db.add(biz)
        try:
            await self.db.flush()  # insert the business first so the Staff FK resolves
        except IntegrityError as exc:
            await self.db.rollback()
            raise Conflict("another business uses that address", code="slug_taken") from exc
        self.db.add(
            Staff(
                id=new_id("staff"),
                business_id=biz.id,
                user_id=user_id,
                role="owner",
                status="active",
                payee=True,
            )
        )
        await self.db.commit()
        return biz


def reply_address(business: Business) -> str | None:
    """Where a reply to the business's mail should go: its brand email, else its billing email."""
    value = (business.brand or {}).get("email")
    brand_email = public_email(value) if isinstance(value, str) else None
    return brand_email or public_email(business.billing_email)
