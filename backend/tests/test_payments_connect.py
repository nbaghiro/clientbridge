import json
from pathlib import Path
from typing import cast

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import account_status_from
from clientbridge.models.business import Business
from clientbridge.services.business import derive_kyc_status, kyc_status
from tests.conftest import FakePaymentGateway

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
    assert kyc_status(biz) == "not_started" and biz.stripe_details_submitted is False
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


FIXTURES = Path(__file__).parent / "fixtures" / "stripe"


def _account_object(name: str) -> dict[str, object]:
    raw = json.loads((FIXTURES / name).read_text())
    return cast("dict[str, object]", raw["data"]["object"])


def test_parses_a_full_account_object() -> None:
    obj = _account_object("account_updated.json")
    status = account_status_from(str(obj["id"]), obj)
    assert status.id == "acct_1NG8Du2eZvKYlo2C"
    assert status.charges_enabled is False and status.payouts_enabled is False
    assert status.details_submitted is True
    assert status.currently_due == ["external_account", "individual.id_number"]
    assert status.past_due == ["external_account"]
    assert status.eventually_due == [
        "external_account",
        "individual.id_number",
        "tos_acceptance.date",
    ]
    assert status.disabled_reason == "requirements.past_due"


def test_derives_restricted_when_stripe_still_needs_things() -> None:
    status = account_status_from("acct_x", _account_object("account_updated.json"))
    # details submitted, but currently_due/past_due are non-empty → the provider must act
    assert derive_kyc_status(status) == "restricted"


def test_reads_the_requirements_deadline() -> None:
    data = _account_object("account_updated.json")
    req = cast(dict[str, object], data["requirements"])
    data = {**data, "requirements": {**req, "current_deadline": 1_800_000_000}}
    assert account_status_from("acct_x", data).current_deadline == 1_800_000_000


async def test_status_shows_deadline_and_available_balance(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    gateway.balance_cents = 12_345
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(
            stripe_charges_enabled=True,
            stripe_requirements={
                "currently_due": ["external_account"],
                "current_deadline": 1_800_000_000,
            },
        )
    )
    body = (await as_owner.get("/v1/connect/status")).json()
    assert body["available_cents"] == 12_345
    assert body["current_deadline"].startswith("2027-01-15")


async def test_status_without_the_balance_when_stripe_fails(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    async def broken(account_id: str, *, currency: str) -> int:
        raise RuntimeError("stripe down")

    gateway.get_balance_cents = broken  # type: ignore[method-assign]
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=True))
    body = (await as_owner.get("/v1/connect/status")).json()
    assert body["available_cents"] is None


async def test_staff_cannot_read_connect_status_403(as_staff: httpx.AsyncClient) -> None:
    assert (await as_staff.get("/v1/connect/status")).status_code == 403
