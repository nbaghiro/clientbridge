from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.models.platform import DeviceToken


class DeviceService:
    """Registers the caller's Expo push token (the push outreach target). Upsert by token, so a
    device that re-logs in just re-points to the current user/business."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def register(self, token: str, platform: str) -> None:
        existing = (
            await self.db.execute(select(DeviceToken).where(DeviceToken.token == token))
        ).scalar_one_or_none()
        if existing is not None:
            existing.user_id = self.principal.user_id
            existing.business_id = self.principal.business_id
            existing.platform = platform
        else:
            self.db.add(
                DeviceToken(
                    id=new_id("device_token"),
                    business_id=self.principal.business_id,
                    user_id=self.principal.user_id,
                    token=token,
                    platform=platform,
                )
            )
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()  # a concurrent register of the same token won — already done
