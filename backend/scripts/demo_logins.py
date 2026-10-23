"""Remove the auth identities a demo seed left behind when a demo login's email changed."""

from collections.abc import Collection

from sqlalchemy import ColumnElement, and_, delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import Base
from clientbridge.core.emails import normalize_email, reserved_email
from clientbridge.integrations.identity import IdentityProvider
from clientbridge.models.business import User

# demo logins sit on a business's own reserved domain, such as owner@birchbark.example
DEMO_SUFFIXES = (".example", ".example.test")


def retired_login(email: str | None, current: Collection[str]) -> bool:
    """A reserved demo-domain address the seed no longer writes; test and e2e accounts aren't."""
    if not email or not reserved_email(email):
        return False
    address = normalize_email(email)
    return address not in current and address.rpartition("@")[2].endswith(DEMO_SUFFIXES)


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
    """Delete the retired demo logins no user signs in as, and return their emails."""
    seeded = {normalize_email(email) for email in current}
    # a sign-in with a retired login provisions an empty user, which would keep its identity
    empty = (await db.execute(select(User.id, User.email).where(_unreferenced()))).tuples().all()
    stale = [user_id for user_id, email in empty if retired_login(email, seeded)]
    if stale:
        await db.execute(delete(User).where(User.id.in_(stale)))
    linked = set(
        (await db.scalars(select(User.identity_id).where(User.identity_id.is_not(None)))).all()
    )
    pruned: list[str] = []
    for identity_id, email in await identities.list_identities():
        if identity_id not in linked and retired_login(email, seeded):
            await identities.delete_identity(identity_id)
            pruned.append(email or "")
    return sorted(pruned)
