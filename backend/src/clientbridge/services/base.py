from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal


class BaseService:
    """Holds the request's DB session + the acting principal (actor + business + role)."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
