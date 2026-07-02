from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import NotFound
from clientbridge.models.identity import Business
from clientbridge.schemas.identity import BusinessSettingsUpdate


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
