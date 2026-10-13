import asyncio
import json
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
import stripe
from scripts.seed_demo import purge_businesses
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.core.deps import Principal
from clientbridge.integrations.stripe import (
    ConnectComponent,
    StripeGateway,
    account_status_from,
    payment_descriptor,
)
from clientbridge.models.business import Business
from clientbridge.models.platform import Audit, IdempotencyKey
from clientbridge.services.business import derive_kyc_status, kyc_status
from clientbridge.services.payments import PaymentService
from tests.conftest import Factory, FakePaymentGateway

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


async def _customer_only_account(db: AsyncSession, gateway: FakePaymentGateway) -> None:
    gateway.configurations["acct_customer"] = {"customer"}
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_customer", stripe_requirements={})
    )
    await db.flush()


async def test_onboard_adds_payments_to_an_account_that_only_pays_for_its_plan(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _customer_only_account(db, gateway)
    assert (await as_owner.get("/v1/connect/status")).json()["kyc_status"] == "not_started"
    res = await as_owner.post("/v1/connect/onboard")
    assert res.status_code == 200, res.text
    assert gateway.created_accounts == [] and gateway.merchant_added == ["acct_customer"]
    biz = (await db.execute(select(Business).where(Business.id == BIZ))).scalar_one()
    assert biz.stripe_account_id == "acct_customer"
    assert biz.stripe_requirements["card_status"] == "restricted"
    audits = (await db.execute(select(Audit.action).where(Audit.entity_id == BIZ))).scalars()
    assert "connect.merchant_added" in set(audits)
    await as_owner.post("/v1/connect/onboard")
    assert gateway.merchant_added == ["acct_customer"]


async def test_embedded_onboarding_reuses_an_account_that_only_pays_for_its_plan(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _customer_only_account(db, gateway)
    payments = await as_owner.post("/v1/connect/session", json={"component": "payments"})
    assert payments.status_code == 409 and gateway.merchant_added == []
    res = await as_owner.post("/v1/connect/session", json={"component": "onboarding"})
    assert res.status_code == 200, res.text
    assert gateway.created_accounts == [] and gateway.merchant_added == ["acct_customer"]
    assert gateway.account_sessions == [("acct_customer", "onboarding")]


async def test_staff_cannot_onboard(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/connect/onboard")
    assert res.status_code == 403


async def test_unauth_cannot_onboard(unauth: httpx.AsyncClient) -> None:
    res = await unauth.post("/v1/connect/onboard")
    assert res.status_code == 401


FIXTURES = Path(__file__).parent / "fixtures" / "stripe"


def _account() -> dict[str, object]:
    return cast("dict[str, object]", json.loads((FIXTURES / "v2_account.json").read_text()))


def test_parses_a_v2_account() -> None:
    status = account_status_from("acct_1NG8Du2eZvKYlo2C", _account())
    assert status.charges_enabled is False and status.payouts_enabled is False
    assert status.details_submitted is True
    assert status.card_status == "restricted"
    assert status.past_due == ["external_account"]
    assert status.currently_due == ["identity.individual.id_numbers"]
    assert status.eventually_due == ["defaults.profile.product_description"]
    assert status.pending_verification == []
    assert status.disabled_reason is None
    assert status.current_deadline == 1_793_491_200


def _with(data: dict[str, object], **changes: object) -> dict[str, object]:
    return {**data, **changes}


def _cards(status: str, code: str = "", resolution: str = "") -> dict[str, object]:
    details = [{"code": code, "resolution": resolution}] if code else []
    return {
        "merchant": {
            "capabilities": {
                "card_payments": {"status": status, "status_details": details},
                "stripe_balance": {"payouts": {"status": status, "status_details": details}},
            }
        }
    }


def test_restricted_cards_needing_info_are_restricted_with_the_business_entries() -> None:
    status = account_status_from("acct_x", _account())
    assert derive_kyc_status(status) == "restricted"
    assert status.currently_due and status.past_due and status.pending_verification == []


@pytest.mark.parametrize(
    ("code", "resolution"),
    [
        ("requirements_pending_verification", "provide_info"),
        ("requirements_pending_verification", "no_resolution"),
        ("determining_status", "no_resolution"),
    ],
)
def test_pending_cards_are_a_review_with_the_entries_stripe_checks(
    code: str, resolution: str
) -> None:
    data = _with(_account(), configuration=_cards("pending", code, resolution))
    status = account_status_from("acct_x", data)
    assert status.disabled_reason is None
    assert status.pending_verification == ["identity.individual.documents.primary_verification"]
    assert derive_kyc_status(status) == "pending"


def test_pending_cards_with_nothing_due_are_pending() -> None:
    data = _with(_account(), configuration=_cards("pending"), requirements=None)
    assert derive_kyc_status(account_status_from("acct_x", data)) == "pending"


def test_restricted_cards_with_nothing_listed_are_still_restricted() -> None:
    data = _with(
        _account(),
        configuration=_cards("restricted", "restricted_other", "provide_info"),
        requirements=None,
    )
    status = account_status_from("acct_x", data)
    assert status.disabled_reason is None
    assert derive_kyc_status(status) == "restricted"


def test_open_terms_mean_onboarding_was_not_submitted() -> None:
    terms = {
        "awaiting_action_from": "user",
        "description": "identity.attestations.terms_of_service.account.date",
        "minimum_deadline": {"status": "currently_due"},
    }
    status = account_status_from("acct_x", _with(_account(), requirements={"entries": [terms]}))
    assert status.details_submitted is False and status.current_deadline is None
    assert derive_kyc_status(status) == "not_started"


def test_an_account_without_the_merchant_configuration_has_not_started() -> None:
    data = _with(_account(), configuration={"customer": {"applied": True}}, requirements=None)
    status = account_status_from("acct_x", data)
    assert status.card_status is None and status.details_submitted is True
    assert derive_kyc_status(status) == "not_started"


def test_an_active_account_is_enabled() -> None:
    data = _with(_account(), configuration=_cards("active"), requirements=None)
    status = account_status_from("acct_x", data)
    assert status.charges_enabled and status.payouts_enabled
    assert derive_kyc_status(status) == "enabled"


def test_active_cards_with_an_upcoming_requirement_stay_enabled() -> None:
    data = _with(_account(), configuration=_cards("active"))
    status = account_status_from("acct_x", data)
    assert status.currently_due == ["identity.individual.id_numbers"]
    assert status.pending_verification == []
    assert derive_kyc_status(status) == "enabled"


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"closed": True}, "closed"),
        (
            {"configuration": _cards("unsupported", "unsupported_country", "no_resolution")},
            "unsupported_country",
        ),
        (
            {"configuration": _cards("restricted", "restricted_other", "contact_stripe")},
            "restricted_other",
        ),
        (
            {"configuration": _cards("restricted", "restricted_other", "no_resolution")},
            "restricted_other",
        ),
        ({"configuration": _cards("rejected", "rejected_fraud", "")}, "rejected_fraud"),
    ],
)
def test_a_state_the_business_cannot_fix_is_disabled(
    changes: dict[str, object], reason: str
) -> None:
    status = account_status_from("acct_x", _with(_account(), **changes))
    assert status.disabled_reason == reason
    assert derive_kyc_status(status) == "disabled"


def test_missing_requirements_parse_as_nothing_due() -> None:
    data: dict[str, object] = {"requirements": {"entries": [{"awaiting_action_from": "user"}]}}
    status = account_status_from("acct_x", data)
    assert status.currently_due == [] and status.pending_verification == []
    assert status.charges_enabled is False and status.disabled_reason is None
    assert status.card_status is None


@pytest.mark.parametrize(
    ("card_status", "expected"), [("pending", "pending"), ("restricted", "restricted")]
)
async def test_status_reads_the_mirrored_card_status(
    as_owner: httpx.AsyncClient, db: AsyncSession, card_status: str, expected: str
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(
            stripe_account_id="acct_mirror",
            stripe_details_submitted=True,
            stripe_requirements={"card_status": card_status, "currently_due": []},
        )
    )
    body = (await as_owner.get("/v1/connect/status")).json()
    assert body["kyc_status"] == expected


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
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def broken(account_id: str, *, currency: str) -> int:
        raise RuntimeError("stripe down")

    monkeypatch.setattr(gateway, "get_balance_cents", broken)
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
    for component in ("account", "notices", "payments", "payouts"):
        response = await as_owner.post("/v1/connect/session", json={"component": component})
        assert response.status_code == 409
    assert gateway.account_sessions == []


async def test_embedded_sessions_authorize_each_request(
    as_staff: httpx.AsyncClient, gateway: FakePaymentGateway
) -> None:
    for component in ("onboarding", "account", "notices", "payments", "payouts"):
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
    notices = await as_owner.post("/v1/connect/session", json={"component": "notices"})
    assert notices.status_code == 200
    assert gateway.account_sessions[-1] == (own_account, "notices")
    denied = await as_owner.post(
        "/v1/connect/session",
        json={"component": "account"},
        headers={"X-Business-Id": "bz_not_yours"},
    )
    assert denied.status_code == 403
    assert len(gateway.account_sessions) == 2


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


async def test_two_onboardings_at_once_create_one_account(db: AsyncSession) -> None:
    async with SessionLocal() as setup:
        factory = Factory(setup)
        business = await factory.business(name="Race Onboarding")
        user = await factory.user()
        staff = await factory.staff(business=business, user=user, role="owner")
        await setup.commit()
    principal = Principal(user_id=user.id, business_id=business.id, staff_id=staff.id, role="owner")
    gateway = FakePaymentGateway()
    creating = asyncio.Event()
    release = asyncio.Event()
    create = gateway.create_connected_account

    async def slow_create(**kwargs: Any) -> str:
        creating.set()
        await release.wait()
        return await create(**kwargs)

    gateway.create_connected_account = slow_create  # type: ignore[method-assign]

    async def onboard() -> None:
        async with SessionLocal() as session:
            await PaymentService(session, principal, gateway).start_onboarding(None)

    try:
        first = asyncio.create_task(onboard())
        await creating.wait()
        second = asyncio.create_task(onboard())
        await asyncio.sleep(0.3)
        release.set()
        await asyncio.gather(first, second)
        assert len(gateway.created_accounts) == 1
    finally:
        owner = create_async_engine(get_settings().migration_database_url)
        async with AsyncSession(owner) as session:
            await purge_businesses(session, [business.id], [user.id])
            await session.commit()
        await owner.dispose()


async def test_an_account_never_mirrored_is_not_taken_for_a_payments_account(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_unknown", stripe_requirements={})
    )
    body = (await as_owner.get("/v1/connect/status")).json()
    assert (body["connected"], body["kyc_status"]) == (False, "not_started")
    mirrored = {"card_status": "restricted", "currently_due": ["external_account"]}
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_requirements=mirrored)
    )
    assert (await as_owner.get("/v1/connect/status")).json()["connected"] is True
