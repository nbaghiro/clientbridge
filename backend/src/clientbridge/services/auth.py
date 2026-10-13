"""The local profile behind each Kratos identity, created on its first authenticated request."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Executable

from clientbridge.core import clock
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.integrations.kratos import Identity, IdentityProvider
from clientbridge.models.business import User

SEEN_EVERY = timedelta(minutes=5)


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def provision(self, identity: Identity, identities: IdentityProvider) -> User:
        user = await self._by_identity(identity.id)
        if user is None:
            try:
                await self._commit(
                    insert(User)
                    .values(
                        id=new_id("user"),
                        identity_id=identity.id,
                        email=identity.email,
                        name=identity.name,
                    )
                    .on_conflict_do_nothing(index_elements=[User.identity_id])
                )
            except Conflict:
                user = await self._relink(identity, identities)
                if user is None:
                    raise
            user = user or await self._by_identity(identity.id)
            if user is None:
                raise Conflict("identity could not be linked", code="email_in_use")
        name = identity.name or user.name
        now = clock.now()
        stale = user.last_seen_at is None or now - user.last_seen_at >= SEEN_EVERY
        if user.email != identity.email or user.name != name or stale:
            user.email, user.name, user.last_seen_at = identity.email, name, now
            await self._commit()
        return user

    async def _relink(self, identity: Identity, identities: IdentityProvider) -> User | None:
        """The same person signing up again after their old identity was deleted keeps their row."""
        if not identity.email_verified:
            return None
        user = (
            await self.db.execute(select(User).where(User.email == identity.email))
        ).scalar_one_or_none()
        if user is None or await identities.identity_exists(user.identity_id):
            return None
        user.identity_id = identity.id
        await self._commit()
        return user

    async def _commit(self, statement: Executable | None = None) -> None:
        try:
            if statement is not None:
                await self.db.execute(statement)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise Conflict("email already belongs to another user", code="email_in_use") from exc

    async def _by_identity(self, identity_id: str) -> User | None:
        result = await self.db.execute(select(User).where(User.identity_id == identity_id))
        return result.scalar_one_or_none()
