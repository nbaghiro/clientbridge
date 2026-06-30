import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business

BIZ = "bz_birchbark"


async def _reset_account(db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=None))
    await db.flush()


async def test_onboard_creates_account_and_link(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _reset_account(db)
    res = await as_owner.post("/v1/connect/onboard")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["url"].startswith("https://connect.stripe.test/")
    assert body["charges_enabled"] is False
    acct = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == BIZ))
    ).scalar_one()
    assert acct is not None and acct.startswith("acct_fake")


async def test_onboard_reuses_existing_account(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _reset_account(db)
    await as_owner.post("/v1/connect/onboard")
    first = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == BIZ))
    ).scalar_one()
    await as_owner.post("/v1/connect/onboard")
    second = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == BIZ))
    ).scalar_one()
    assert first == second  # a second onboard reuses the connected account, not a new one


async def test_onboard_idempotent_key_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _reset_account(db)
    headers = {"Idempotency-Key": "onb-1"}
    first = await as_owner.post("/v1/connect/onboard", headers=headers)
    second = await as_owner.post("/v1/connect/onboard", headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json() == second.json()


async def test_status(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_owner.get("/v1/connect/status")
    assert res.status_code == 200
    body = res.json()
    assert {
        "connected",
        "charges_enabled",
        "payouts_enabled",
        "kyc_status",
        "currently_due",
    } <= set(body)
    assert body["kyc_status"] in {"not_started", "pending", "restricted", "enabled", "disabled"}


async def test_onboard_seeds_kyc_state(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _reset_account(db)
    await as_owner.post("/v1/connect/onboard")
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    # the fake get_account returns a freshly-created account → not_started + what Stripe still wants
    assert biz.kyc_status == "not_started" and biz.stripe_details_submitted is False
    due = biz.stripe_requirements["currently_due"]
    assert isinstance(due, list) and "external_account" in due
    body = (await as_owner.get("/v1/connect/status")).json()  # and status() surfaces it
    assert "external_account" in body["currently_due"]


async def test_staff_cannot_onboard(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/connect/onboard")
    assert res.status_code == 403


async def test_unauth_cannot_onboard(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/connect/onboard")
    assert res.status_code == 401
