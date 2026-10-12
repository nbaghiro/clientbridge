from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.zones import SUPPORTED_ZONES, zone
from clientbridge.integrations.stripe import ConnectAccount
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.platform import File
from clientbridge.schemas.business import BusinessSettingsUpdate, OnboardBody


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


def local_today(business: Business) -> date:
    return datetime.now(zone(business.timezone)).date()


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
    """The provider-facing KYC state, derived from the Stripe account (the source of truth)."""
    if status.disabled_reason is not None and status.disabled_reason.startswith("rejected"):
        return "disabled"
    if status.charges_enabled and not status.currently_due and not status.past_due:
        return "enabled"
    if not status.details_submitted:
        return "not_started"  # account created, the provider hasn't finished the hosted flow
    if status.currently_due or status.past_due:
        return "restricted"  # Stripe needs more from the provider
    if status.pending_verification:
        return "pending"  # Stripe is reviewing
    return "pending"


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
            details_submitted=business.stripe_details_submitted,
            disabled_reason=reason if isinstance(reason, str) else None,
            currently_due=_due("currently_due"),
            eventually_due=_due("eventually_due"),
            past_due=_due("past_due"),
            pending_verification=_due("pending_verification"),
        )
    )


def apply_account_status(business: Business, status: ConnectAccount) -> None:
    """Mirror the connected-account KYC state onto the business (Stripe = source of truth)."""
    business.stripe_charges_enabled = status.charges_enabled
    business.stripe_payouts_enabled = status.payouts_enabled
    business.stripe_details_submitted = status.details_submitted
    business.stripe_requirements = {
        "currently_due": status.currently_due,
        "eventually_due": status.eventually_due,
        "past_due": status.past_due,
        "pending_verification": status.pending_verification,
        "disabled_reason": status.disabled_reason,
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
            business.setup_dismissed_at = datetime.now(UTC) if data.setup_dismissed else None
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
            business.brand = merged
        await self.db.flush()
        await self.db.refresh(business)
        await self.db.commit()
        return business


class OnboardingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def onboard(self, user_id: str, data: OnboardBody) -> Business:
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
        )
        self.db.add(biz)
        await self.db.flush()  # insert the business first so the Staff FK resolves
        user = await self.db.get(User, user_id)
        self.db.add(
            Staff(
                id=new_id("staff"),
                business_id=biz.id,
                user_id=user_id,
                name=user.name if user is not None else None,
                role="owner",
                status="active",
                payee=True,
            )
        )
        await self.db.commit()
        return biz
