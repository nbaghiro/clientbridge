from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import NotFound
from clientbridge.integrations.payments import ConnectAccount
from clientbridge.models.identity import Business
from clientbridge.schemas.identity import BusinessSettingsUpdate


async def business_tz(db: AsyncSession, business_id: str) -> ZoneInfo:
    """The business's local timezone; availability + recurrence store wall-clock times in it, so
    session instants convert into this zone before comparing time-of-day."""
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
    """Whether the business collects GST/HST — a small supplier under the threshold does not, so the
    tax engine applies no tax for it."""
    return bool(
        (
            await db.execute(select(Business.is_tax_registered).where(Business.id == business_id))
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
    business.kyc_status = derive_kyc_status(status)


class BusinessService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

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
            # replace the whole brand with the (validated) values sent; cleared fields drop out
            business.brand = {k: v for k, v in data.brand.model_dump().items() if v is not None}
        await self.db.flush()
        await self.db.refresh(business)
        await self.db.commit()
        return business
