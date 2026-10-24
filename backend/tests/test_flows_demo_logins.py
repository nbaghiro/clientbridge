from uuid import uuid4

import pytest
from scripts.demo_logins import prune_logins
from scripts.seed_demo import arguments, finish, link_identities, main, validate_prune_target
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core.config import get_settings
from clientbridge.core.ids import new_id
from clientbridge.integrations.identity import Login
from clientbridge.models.business import Staff, User
from tests.conftest import BIZ, FakeIdentityProvider

# the logins the seed just wrote, which other databases on the same auth service may use
CURRENT = ("owner@cedarcoast.example", "owner@clearcoat.example")
ORPHAN, EARLIER = str(uuid4()), str(uuid4())


async def _user(db: AsyncSession, email: str) -> User:
    user = User(id=new_id("user"), identity_id=str(uuid4()), email=email, name="Signed In")
    db.add(user)
    await db.flush()
    return user


def _accounts(*logins: Login) -> dict[str, Login]:
    return {login.id: login for login in logins}


async def test_a_tagged_orphan_is_deleted(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = _accounts(Login(ORPHAN, "owner@cedarcoast.example.test", True))
    assert await prune_logins(owner_db, identities, CURRENT) == ["owner@cedarcoast.example.test"]
    assert identities.deleted == {ORPHAN}


async def test_an_untagged_orphan_on_a_demo_domain_is_kept(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = _accounts(
        Login(str(uuid4()), "tessa@cedarcoast.example.test", False),
        Login(str(uuid4()), "qa@clientbridge.example", False),
        Login(str(uuid4()), "someone@gmail.com", False),
    )
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == set()


async def test_a_tagged_login_someone_signs_in_as_or_the_seed_wrote_is_kept(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    staff = await owner_db.scalar(select(Staff).where(Staff.user_id.is_not(None)).limit(1))
    assert staff is not None and staff.user_id is not None
    user = await owner_db.get(User, staff.user_id)
    assert user is not None and user.identity_id is not None
    identities.accounts = _accounts(
        Login(user.identity_id, "renamed@retired.example", True),
        Login(str(uuid4()), "Owner@Clearcoat.example", True),
    )
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == set()


async def test_an_empty_user_from_a_retired_login_goes_with_its_identity(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    retired = await _user(owner_db, "tessa@cedarcoast.example.test")
    onboarding = await _user(owner_db, "amrit@cedarcoast.example.test")
    assert retired.identity_id is not None and onboarding.identity_id is not None
    identities.accounts = _accounts(
        Login(retired.identity_id, retired.email, True),
        Login(onboarding.identity_id, onboarding.email, False),
    )
    assert await prune_logins(owner_db, identities, CURRENT) == ["tessa@cedarcoast.example.test"]
    assert identities.deleted == {retired.identity_id}
    assert await owner_db.get(User, retired.id) is None
    assert await owner_db.get(User, onboarding.id) is not None


async def test_a_reseed_tags_existing_logins_and_deletes_nothing_new(
    owner_db: AsyncSession, identities: FakeIdentityProvider
) -> None:
    identities.accounts = _accounts(
        Login(EARLIER, CURRENT[0], False), Login(ORPHAN, "old@cedarcoast.example", True)
    )
    users = [User(id=new_id("user"), email=email, name="Demo") for email in CURRENT]
    await link_identities(identities, users)
    assert identities.tagged == [EARLIER]
    assert users[0].identity_id == EARLIER
    created = identities.accounts[users[1].identity_id or ""]
    assert created.demo and created.email == CURRENT[1]
    assert await prune_logins(owner_db, identities, CURRENT) == ["old@cedarcoast.example"]
    await link_identities(identities, users)
    assert [u.identity_id for u in users] == [EARLIER, created.id]
    assert await prune_logins(owner_db, identities, CURRENT) == []
    assert identities.deleted == {ORPHAN}


def test_the_prune_is_off_unless_asked() -> None:
    assert arguments([]).prune_logins is False
    assert arguments(["--prune-logins"]).prune_logins is True


@pytest.mark.parametrize(
    ("env", "target", "app", "allowed"),
    [
        ("dev", "clientbridge", "clientbridge", True),
        ("staging", "staging_clientbridge", "staging_clientbridge", True),
        ("dev", "clientbridge_test_1a2b3c4d", "clientbridge_test_1a2b3c4d", False),
        ("dev", "scratch", "scratch", False),
        ("dev", "clientbridge", "clientbridge_test_1a2b3c4d", False),
        ("staging", "clientbridge", "clientbridge", False),
        ("prod", "clientbridge", "clientbridge", False),
    ],
)
def test_the_prune_needs_the_app_database(
    monkeypatch: pytest.MonkeyPatch, env: str, target: str, app: str, allowed: bool
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "env", env)
    monkeypatch.setattr(settings, "migration_database_url", f"postgresql://m@localhost/{target}")
    monkeypatch.setattr(settings, "database_url", f"postgresql://a@localhost/{app}")
    if allowed:
        validate_prune_target(core=False)
    else:
        with pytest.raises(SystemExit, match="the API serves"):
            validate_prune_target(core=False)


async def test_a_seed_refuses_the_prune_before_it_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "env", "dev")
    with pytest.raises(SystemExit, match="full seed"):
        await main(core=True, prune=True)
    # the suite's own clientbridge_test database, which shares the auth service with dev
    with pytest.raises(SystemExit, match="the API serves"):
        await main(prune=True)


@pytest.mark.parametrize("asked", [True, False])
async def test_the_prune_runs_only_when_asked(
    identities: FakeIdentityProvider, asked: bool
) -> None:
    identities.accounts = _accounts(Login(ORPHAN, "old@cedarcoast.example", True))
    owner = create_async_engine(get_settings().migration_database_url)
    try:
        await finish(owner, [BIZ], CURRENT, identities if asked else None)
    finally:
        await owner.dispose()
    assert identities.deleted == ({ORPHAN} if asked else set())
