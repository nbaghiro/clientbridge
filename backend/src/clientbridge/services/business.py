from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import ConnectAccount
from clientbridge.models.business import Business, Staff
from clientbridge.models.platform import File
from clientbridge.schemas.business import BusinessSettingsUpdate, OnboardBody


async def business_tz(db: AsyncSession, business_id: str) -> ZoneInfo:
    """The business's timezone, in which hours and recurrences store wall-clock times."""
    tz = (
        await db.execute(select(Business.timezone).where(Business.id == business_id))
    ).scalar_one_or_none()
    return ZoneInfo(tz) if tz is not None else ZoneInfo("UTC")


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
    }


class BusinessService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def _assert_logo(self, file_id: str) -> None:
        logo = (
            await self.db.execute(
                scoped(File, self.principal.business_id).where(
                    File.id == file_id, File.parent_type == "business", File.purpose == "logo"
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
        for key, value in data.model_dump(exclude_unset=True, exclude={"brand"}).items():
            setattr(business, key, value)
        if data.brand is not None:
            if data.brand.logo_file_id is not None:
                await self._assert_logo(data.brand.logo_file_id)
            # replace the whole brand with the (validated) values sent; cleared fields drop out
            business.brand = {k: v for k, v in data.brand.model_dump().items() if v is not None}
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
            timezone=data.timezone or "America/Toronto",
            locale=data.locale,
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
