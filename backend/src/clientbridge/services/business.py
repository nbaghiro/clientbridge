import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import SUPPORTED_ZONES, zone
from clientbridge.integrations.stripe import ConnectAccount, PostalAddress
from clientbridge.models.business import Business, ProvinceCode, Staff, User
from clientbridge.models.platform import File
from clientbridge.schemas.business import BusinessSettingsUpdate, OnboardBody, public_email

_POSTAL_CODE = re.compile(r"\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b", re.IGNORECASE)
_COUNTRY = ("canada", "ca")
# a unit or street line: a number, #, or a unit word, which a city name never starts with
_UNIT = re.compile(r"(#|\d|(apt|apartment|app|appartement|unit|suite|bureau|ste)\b)", re.I)
_PROVINCES: dict[str, ProvinceCode] = {
    "alberta": "AB",
    "british columbia": "BC",
    "manitoba": "MB",
    "new brunswick": "NB",
    "newfoundland and labrador": "NL",
    "nova scotia": "NS",
    "northwest territories": "NT",
    "nunavut": "NU",
    "ontario": "ON",
    "prince edward island": "PE",
    "quebec": "QC",
    "québec": "QC",
    "saskatchewan": "SK",
    "yukon": "YT",
}


def postal_address(business: Business) -> PostalAddress:
    """The business's street address from its brand, or 422 naming what Terminal still needs."""
    brand = business.brand or {}
    raw = brand.get("address")
    text = raw.strip() if isinstance(raw, str) else ""
    codes = list(_POSTAL_CODE.finditer(text))
    province = business.province
    if not text or not codes or province is None:
        raise Unprocessable(
            "add the business street address, city, province and postal code in Business "
            "settings before taking in-person card payments",
            code="business_address_incomplete",
        )
    postal = codes[-1]
    rest = f"{text[: postal.start()]},{text[postal.end() :]}"
    parts = [p.strip() for p in re.split(r"[,\n]", rest) if p.strip()]
    if parts and parts[-1].lower() in _COUNTRY:
        parts.pop()
    if parts:
        named = parts[-1].rsplit(" ", 1)
        tail = named[-1].upper()
        whole = _PROVINCES.get(parts[-1].lower())
        if whole is not None or tail in _PROVINCES.values():
            if (whole or tail) != province:
                raise Unprocessable(
                    "the business address is in a different province than the business",
                    code="business_address_incomplete",
                )
            if whole is None:
                parts[-1] = named[0].strip() if len(named) > 1 else ""
                parts = [p for p in parts if p]
            elif len(parts) > 2 and not _UNIT.match(parts[-2]):
                parts.pop()
            # otherwise the full name is the city, as in "Apt 2, Québec" or "Rue X, Québec"
    if len(parts) < 2:
        raise Unprocessable(
            "add the business street address, city, province and postal code in Business "
            "settings before taking in-person card payments",
            code="business_address_incomplete",
        )
    return PostalAddress(
        line1=parts[0],
        line2=", ".join(parts[1:-1]) or None,
        city=parts[-1],
        province=province,
        postal_code=f"{postal.group(1)} {postal.group(2)}".upper(),
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


async def business_tax_registered(db: AsyncSession, business_id: str) -> bool:
    """Whether the business collects GST/HST (small suppliers don't)."""
    return bool(
        (
            await db.execute(select(Business.tax_registered).where(Business.id == business_id))
        ).scalar_one()
    )


def derive_kyc_status(status: ConnectAccount) -> str:
    """The KYC phase from the card_payments capability, per Stripe's v2 verification guide."""
    if status.disabled_reason is not None:
        return "disabled"  # closed, unsupported, or only Stripe support can lift it
    if status.charges_enabled:
        return "enabled"
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


def kyc_status(business: Business) -> str:
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
    }


class BusinessService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

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
        fields = data.model_dump(exclude_unset=True, exclude={"brand", "setup_dismissed"})
        if "timezone" in fields:
            valid_timezone(data.timezone)
        for key, value in fields.items():
            if value is None and key in ("review_hold_at", "filing_frequency", "tax_registered"):
                continue
            cleared = value == "" and key in (
                "gst_hst_number",
                "qst_number",
                "pst_number",
                "google_review_url",
            )
            setattr(business, key, None if cleared else value)
        if data.setup_dismissed is not None:
            business.setup_dismissed_at = clock.now() if data.setup_dismissed else None
        if data.brand is not None:
            if data.brand.logo_file_id is not None:
                await self._assert_logo(data.brand.logo_file_id)
            if data.brand.avatar_file_id is not None:
                await self._assert_logo(data.brand.avatar_file_id)
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
            logo_changed = (
                "logo_file_id" in data.brand.model_fields_set
                and data.brand.logo_file_id != merged.get("logo_file_id")
            )
            if logo_changed and "avatar_file_id" not in data.brand.model_fields_set:
                merged.pop("avatar_file_id", None)
            for key, value in data.brand.model_dump(exclude_unset=True).items():
                if value is None:
                    merged.pop(key, None)
                else:
                    merged[key] = value
            if merged.get("address") != (business.brand or {}).get("address"):
                # the Terminal location holds the old address; the next reader session mints one
                business.stripe_terminal_location_id = None
            business.brand = merged
        await self.db.flush()
        await self.db.refresh(business)
        await self.db.commit()
        return business


class OnboardingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def onboard(self, user_id: str, data: OnboardBody, *, email_verified: bool) -> Business:
        if not email_verified:
            raise Forbidden("verify your email address first", code="email_unverified")
        existing = (
            await self.db.execute(select(Business).where(Business.slug == data.slug))
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("business slug already taken")

        biz = Business(
            id=new_id("business"),
            name=data.name,
            slug=data.slug,
            province=data.province,
            timezone=valid_timezone(data.timezone or "America/Toronto"),
            subject=data.subject,
        )
        self.db.add(biz)
        await self.db.flush()  # insert the business first so the Staff FK resolves
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
