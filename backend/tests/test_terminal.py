import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business

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
