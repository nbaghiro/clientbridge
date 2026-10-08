import json
from pathlib import Path
from typing import cast

import httpx
import pytest
import stripe
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.stripe import (
    ConnectComponent,
    StripeGateway,
    account_status_from,
    payment_descriptor,
)
from clientbridge.models.business import Business
from clientbridge.models.platform import Audit, IdempotencyKey
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


async def test_embedded_onboarding_creates_one_account_with_fresh_sessions(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _reset_account(db)
    headers = {"Idempotency-Key": "must-not-cache-session"}
    first = await as_owner.post(
        "/v1/connect/session", json={"component": "onboarding"}, headers=headers
    )
    second = await as_owner.post(
        "/v1/connect/session", json={"component": "onboarding"}, headers=headers
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["client_secret"] != second.json()["client_secret"]
    assert first.headers["cache-control"] == "no-store"
    assert len(gateway.created_accounts) == 1
    assert gateway.account_sessions == [(gateway.created_accounts[0], "onboarding")] * 2
    cached = (
        (await db.execute(select(IdempotencyKey).where(IdempotencyKey.scope == "connect.session")))
        .scalars()
        .all()
    )
    audits = (
        (await db.execute(select(Audit).where(Audit.action == "connect.session"))).scalars().all()
    )
    assert cached == []
    assert len(audits) == 2
    assert all(a.changes == {"component": "onboarding"} for a in audits)


async def test_embedded_management_requires_an_account(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _reset_account(db)
    for component in ("account", "payments", "payouts"):
        response = await as_owner.post("/v1/connect/session", json={"component": component})
        assert response.status_code == 409
    assert gateway.account_sessions == []


async def test_embedded_sessions_authorize_each_request(
    as_staff: httpx.AsyncClient, gateway: FakePaymentGateway
) -> None:
    for component in ("onboarding", "account", "payments", "payouts"):
        response = await as_staff.post("/v1/connect/session", json={"component": component})
        assert response.status_code == 403
    assert gateway.account_sessions == []


async def test_embedded_sessions_derive_account_from_membership(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    own_account = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == BIZ))
    ).scalar_one()
    response = await as_owner.post("/v1/connect/session", json={"component": "payments"})
    assert response.status_code == 200
    assert gateway.account_sessions == [(own_account, "payments")]
    denied = await as_owner.post(
        "/v1/connect/session",
        json={"component": "account"},
        headers={"X-Business-Id": "bz_not_yours"},
    )
    assert denied.status_code == 403
    assert len(gateway.account_sessions) == 1


async def test_embedded_sessions_require_authentication(unauth: httpx.AsyncClient) -> None:
    response = await unauth.post("/v1/connect/session", json={"component": "onboarding"})
    assert response.status_code == 401


async def test_embedded_sessions_reject_unlisted_components(as_owner: httpx.AsyncClient) -> None:
    response = await as_owner.post("/v1/connect/session", json={"component": "transfers"})
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Birchbark Pet Studio", "BIRCHBARK PET STUDIO"),
        ("Café <Studio>*", "CAFE STUDIO"),
        ("A business name that is much longer", "A BUSINESS NAME THAT I"),
        ("123456789", None),
        ("猫美容院", None),
        ("ABC", None),
    ],
)
def test_payment_descriptor_is_recognizable_or_left_for_collection(
    name: str, expected: str | None
) -> None:
    assert payment_descriptor(name) == expected


@pytest.mark.parametrize("component", ["onboarding", "account", "payments", "payouts"])
async def test_embedded_adapter_grants_only_requested_features(
    monkeypatch: pytest.MonkeyPatch,
    component: ConnectComponent,
) -> None:
    captured: dict[str, object] = {}

    async def create(**params: object) -> stripe.AccountSession:
        captured.update(params)
        return stripe.AccountSession.construct_from(
            {"client_secret": "single_use_secret"}, "sk_test_fake"
        )

    monkeypatch.setattr(stripe, "api_key", stripe.api_key)
    monkeypatch.setattr(stripe, "api_version", stripe.api_version)
    monkeypatch.setattr(stripe.AccountSession, "create_async", create)
    gateway = StripeGateway("sk_test_fake", "whsec_fake", "CA")
    assert await gateway.create_account_session("acct_own", component) == "single_use_secret"
    assert captured["account"] == "acct_own"
    components = cast(dict[str, dict[str, object]], captured["components"])
    if component in ("onboarding", "account"):
        assert set(components) == (
            {"account_onboarding", "account_management"}
            if component == "account"
            else {"account_onboarding"}
        )
        for config in components.values():
            features = cast(dict[str, object], config["features"])
            assert features["disable_stripe_user_authentication"] is False
            assert features["external_account_collection"] is True
    elif component == "payments":
        assert components == {
            "payments": {
                "enabled": True,
                "features": {
                    "dispute_management": True,
                    "refund_management": False,
                    "capture_payments": False,
                },
            }
        }
    else:
        assert set(components) == {"payouts"}
        features = cast(dict[str, object], components["payouts"]["features"])
        assert not any(features.values())
