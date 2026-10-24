"""Remove the auth identities the demo seed created for logins it no longer writes."""

from collections.abc import Collection

from sqlalchemy import ColumnElement, and_, delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import Base
from clientbridge.core.emails import normalize_email
from clientbridge.integrations.identity import IdentityProvider
from clientbridge.models.business import User


def _unreferenced() -> ColumnElement[bool]:
    """No row points at the user: no staff role, client link, message, audit or device."""
    users = User.__table__
    return and_(
        *(
            ~exists().where(column == users.c.id)
            for table in Base.metadata.tables.values()
            if table is not users
            for column in table.c
            if any(fk.column is users.c.id for fk in column.foreign_keys)
        )
    )


async def prune_logins(
    db: AsyncSession, identities: IdentityProvider, current: Collection[str]
) -> list[str]:
    """Delete the seed's tagged identities that no current login or user row holds."""
    seeded = {normalize_email(email) for email in current}
    retired = {
        login.id: login.email or ""
        for login in await identities.list_identities()
        if login.demo and normalize_email(login.email or "") not in seeded
    }
    if not retired:
        return []
    # a sign-in with a retired login provisions an empty user, which would keep its identity
    await db.execute(delete(User).where(User.identity_id.in_(list(retired)), _unreferenced()))
    linked = set(
        (
            await db.scalars(select(User.identity_id).where(User.identity_id.in_(list(retired))))
        ).all()
    )
    pruned: list[str] = []
    for identity_id, email in retired.items():
        if identity_id not in linked:
            await identities.delete_identity(identity_id)
            pruned.append(email)
    return sorted(pruned)
