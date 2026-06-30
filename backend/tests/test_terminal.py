import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business
from tests.conftest import FakePaymentGateway

BIZ = "bz_birchbark"


async def _set_account(db: AsyncSession, account: str | None) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=account))
    await db.flush()


async def test_connection_token_returns_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, "acct_test")
    res = await as_owner.post("/v1/terminal/connection-token")
    assert res.status_code == 200, res.text
    assert res.json()["secret"].startswith("pst_fake")


async def test_connection_token_requires_onboarding(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, None)
    assert (await as_owner.post("/v1/terminal/connection-token")).status_code == 409


async def test_staff_can_get_connection_token(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _set_account(db, "acct_test")  # the reader is staff-operated — any principal may connect
    res = await as_staff.post("/v1/terminal/connection-token")
    assert res.status_code == 200, res.text


async def test_connection_token_mints_and_reuses_terminal_location(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _set_account(db, "acct_test")
    first = (await as_owner.post("/v1/terminal/connection-token")).json()
    loc = first["location_id"]
    assert loc is not None and loc.startswith("tml_fake")
    assert len(gateway.created_locations) == 1
    stored = (
        await db.execute(select(Business.stripe_terminal_location_id).where(Business.id == BIZ))
    ).scalar_one()
    assert stored == loc
    # a second call reuses the cached location — no second mint
    second = (await as_owner.post("/v1/terminal/connection-token")).json()
    assert second["location_id"] == loc
    assert len(gateway.created_locations) == 1
