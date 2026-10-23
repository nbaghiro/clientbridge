from uuid import uuid4

from scripts.demo_logins import prune_logins
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Staff, User
from tests.conftest import FakeIdentityProvider

# the logins the seed just wrote, which other databases on the same auth service may use
CURRENT = ("owner@cedarcoast.example", "owner@clearcoat.example")


async def _user(db: AsyncSession, email: str) -> User:
    user = User(id=new_id("user"), identity_id=str(uuid4()), email=email, name="Signed In")
    db.add(user)
    await db.flush()
    return user


async def test_an_orphaned_demo_login_is_deleted(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = {"orphan": "owner@cedarcoast.example.test"}
    assert await prune_logins(owner_db, identities, CURRENT) == ["owner@cedarcoast.example.test"]
    assert identities.deleted == {"orphan"}


async def test_a_reserved_login_someone_signs_in_as_is_kept(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    staff = await owner_db.scalar(select(Staff).where(Staff.user_id.is_not(None)).limit(1))
    assert staff is not None and staff.user_id is not None
    user = await owner_db.get(User, staff.user_id)
    assert user is not None and user.identity_id is not None
    identities.accounts = {user.identity_id: user.email}
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == set()


async def test_an_orphan_that_is_no_retired_demo_login_is_kept(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = {
        "real": "someone@gmail.com",
        "e2e": "signup-13fcb7e4@example.com",
        "test": "repro-1792@example.test",
        "current": "Owner@Clearcoat.example",
        "blank": "",
    }
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == set()


async def test_an_empty_user_from_a_retired_login_goes_with_its_identity(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    retired = await _user(owner_db, "tessa@cedarcoast.example.test")
    onboarding = await _user(owner_db, "someone@gmail.com")
    assert retired.identity_id is not None and onboarding.identity_id is not None
    identities.accounts = {
        retired.identity_id: retired.email,
        onboarding.identity_id: onboarding.email,
    }
    assert await prune_logins(owner_db, identities, CURRENT) == ["tessa@cedarcoast.example.test"]
    assert identities.deleted == {retired.identity_id}
    assert await owner_db.get(User, retired.id) is None
    assert await owner_db.get(User, onboarding.id) is not None


async def test_a_second_prune_deletes_nothing(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = {"orphan": "amrit@cedarcoast.example.test", "real": "a@gmail.com"}
    assert await prune_logins(owner_db, identities, CURRENT) == ["amrit@cedarcoast.example.test"]
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == {"orphan"}
