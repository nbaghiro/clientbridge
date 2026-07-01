from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import Forbidden, NotFound
from clientbridge.models.identity import Business
from clientbridge.schemas.identity import BusinessSettingsUpdate


class BusinessService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def update_settings(self, data: BusinessSettingsUpdate) -> Business:
        """Owner/admin edit of the acting business's account fields (the principal's business)."""
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can change account settings")
        business = await self.db.get(Business, self.principal.business_id)
        if business is None:
            raise NotFound("business not found")
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(business, key, value)
        await self.db.flush()
        await self.db.refresh(business)
        await self.db.commit()
        return business
