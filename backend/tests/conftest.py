"""Shared test fixtures (see .docs/testing.md).

Integration tests run against the migrated + SEEDED dev DB. Each test runs inside a transaction
rolled back at teardown (savepoint join + a `get_session` override), so the committed seed is the
baseline and every write vanishes — repeatable, no residue.
"""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import engine, get_session
from clientbridge.core.deps import get_interac_secret
from clientbridge.core.errors import CardDeclined, PaymentActionRequired, Unauthorized
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import (
    public_booking_rate_limit,
    public_contract_rate_limit,
    public_form_rate_limit,
    public_pay_rate_limit,
    public_review_rate_limit,
)
from clientbridge.core.security import hash_password, issue_access_token
from clientbridge.integrations.email import Email, EmailSender, get_email_sender
from clientbridge.integrations.oauth import OAuthProfile, get_oauth_verifier
from clientbridge.integrations.payments import (
    ConnectAccount,
    GatewayEvent,
    PaymentGateway,
    PaymentIntentResult,
    RefundResult,
    SetupIntentResult,
    SubscriptionResult,
    WebhookVerificationError,
    get_payment_gateway,
)
from clientbridge.integrations.push import Push, get_push_sender
from clientbridge.integrations.s3 import FileStorage, get_file_storage
from clientbridge.integrations.sms import Sms, get_sms_sender
from clientbridge.main import app
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff, User

# Seeded baseline (committed): the demo business + two of its users.
BIZ = "bz_birchbark"
OWNER_USER = "us_dev"
STAFF_USER = "us_diego"


# ── DB: one rolled-back transaction per test ─────────────────────────────────────────────────
@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    conn = await engine.connect()
    trans = await conn.begin()
    session = AsyncSession(
        bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()  # function-scoped loop → clear the pool for the next test


# ── Recording email fake (the boundary pattern) ──────────────────────────────────────────────
class FakeEmailSender:
    def __init__(self) -> None:
        self.sent: list[Email] = []

    async def send(self, email: Email) -> None:
        self.sent.append(email)


@pytest.fixture
def email() -> FakeEmailSender:
    return FakeEmailSender()


class FakeSmsSender:
    def __init__(self) -> None:
        self.sent: list[Sms] = []

    async def send(self, sms: Sms) -> None:
        self.sent.append(sms)


class FakePushSender:
    def __init__(self) -> None:
        self.sent: list[Push] = []

    async def send(self, push: Push) -> None:
        self.sent.append(push)


@pytest.fixture
def sms() -> FakeSmsSender:
    return FakeSmsSender()


@pytest.fixture
def push() -> FakePushSender:
    return FakePushSender()


# ── Recording object-storage fake: deterministic presigned URLs, no network ───────────────────
class FakeFileStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str]] = []
        self.downloads: list[str] = []

    def presign_upload(self, key: str, content_type: str) -> str:
        self.uploads.append((key, content_type))
        return f"https://files.test/{key}"

    def presign_download(self, key: str) -> str:
        self.downloads.append(key)
        return f"https://files.test/{key}"


@pytest.fixture
def storage() -> FakeFileStorage:
    return FakeFileStorage()


# ── OAuth fake: id_token == the email; "invalid" → 401 (lets tests control the profile) ───────
class FakeOAuthVerifier:
    async def verify_google(self, id_token: str) -> OAuthProfile:
        if id_token == "invalid":
            raise Unauthorized("invalid google token")
        return OAuthProfile(
            email=id_token, email_verified=True, name="OAuth User", sub=f"google-{id_token}"
        )


# ── Payment-gateway fake: a webhook verifies only with signature "good"; payload IS the event ──
class FakePaymentGateway:
    def __init__(self) -> None:
        self.created_accounts: list[str] = []
        self.detached: list[str] = []
        self.created_prices: list[str] = []
        self.created_price_amounts: list[int] = []  # unit_amount per created Price
        self.created_subscriptions: list[str] = []
        self.canceled_subscriptions: list[str] = []
        self._seq = 0
        self._intents: dict[str, PaymentIntentResult] = {}  # honor Stripe idempotency keys
        self._subs: dict[str, SubscriptionResult] = {}  # honor subscription idempotency keys
        self.charged_methods: list[str] = []  # off-session payment_methods passed to a charge

    async def create_connected_account(self, *, business_name: str, email: str | None) -> str:
        self._seq += 1
        acct = f"acct_fake{self._seq}"
        self.created_accounts.append(acct)
        return acct

    async def create_account_link(
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str:
        return f"https://connect.stripe.test/{account_id}"

    async def get_account(self, account_id: str) -> ConnectAccount:
        return ConnectAccount(id=account_id, charges_enabled=False, details_submitted=False)

    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent:
        if signature != "good":
            raise WebhookVerificationError("bad signature")
        body = json.loads(payload)
        account = body.get("account")
        return GatewayEvent(
            id=str(body["id"]),
            type=str(body["type"]),
            data=dict(body["data"]["object"]),
            account=str(account) if account is not None else None,
        )

    async def create_customer(self, account_id: str, *, name: str, email: str | None) -> str:
        self._seq += 1
        return f"cus_fake{self._seq}"

    async def create_setup_intent(self, account_id: str, *, customer_id: str) -> SetupIntentResult:
        self._seq += 1
        sid = f"seti_fake{self._seq}"
        return SetupIntentResult(id=sid, client_secret=f"{sid}_secret")

    async def create_pad_setup_intent(
        self, account_id: str, *, customer_id: str
    ) -> SetupIntentResult:
        self._seq += 1
        sid = f"seti_pad_fake{self._seq}"
        return SetupIntentResult(id=sid, client_secret=f"{sid}_secret")

    async def create_price(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: str,
    ) -> str:
        self._seq += 1
        pid = f"price_fake{self._seq}"
        self.created_prices.append(pid)
        self.created_price_amounts.append(amount_cents)
        return pid

    async def create_subscription(
        self,
        account_id: str,
        *,
        customer_id: str,
        price_id: str,
        payment_method_id: str,
        idempotency_key: str | None = None,
    ) -> SubscriptionResult:
        if idempotency_key is not None and idempotency_key in self._subs:
            return self._subs[idempotency_key]
        self._seq += 1
        sid = f"sub_fake{self._seq}"
        self.created_subscriptions.append(sid)
        result = SubscriptionResult(
            id=sid,
            status="active",
            current_period_start=datetime(2030, 1, 1, tzinfo=UTC),
            current_period_end=datetime(2030, 2, 1, tzinfo=UTC),
        )
        if idempotency_key is not None:
            self._subs[idempotency_key] = result
        return result

    async def cancel_subscription(self, account_id: str, *, subscription_id: str) -> None:
        self.canceled_subscriptions.append(subscription_id)

    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
    ) -> PaymentIntentResult:
        if payment_method == "pm_card_declined":
            raise CardDeclined("the card was declined")
        if payment_method == "pm_requires_action":
            raise PaymentActionRequired("this card requires authentication")
        if payment_method is not None:
            self.charged_methods.append(payment_method)
        if idempotency_key in self._intents:
            return self._intents[idempotency_key]
        self._seq += 1
        pid = f"pi_fake{self._seq}"
        result = PaymentIntentResult(id=pid, client_secret=f"{pid}_secret")
        self._intents[idempotency_key] = result
        return result

    async def refund(
        self, account_id: str, *, payment_intent_id: str, amount_cents: int, idempotency_key: str
    ) -> RefundResult:
        self._seq += 1
        return RefundResult(id=f"re_fake{self._seq}", status="succeeded")

    async def detach_payment_method(self, account_id: str, *, payment_method_id: str) -> None:
        self.detached.append(payment_method_id)

    async def create_connection_token(self, account_id: str) -> str:
        self._seq += 1
        return f"pst_fake{self._seq}"

    async def create_terminal_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
    ) -> PaymentIntentResult:
        if idempotency_key in self._intents:
            return self._intents[idempotency_key]
        self._seq += 1
        pid = f"pi_term_fake{self._seq}"
        result = PaymentIntentResult(id=pid, client_secret=f"{pid}_secret")
        self._intents[idempotency_key] = result
        return result


@pytest.fixture
def gateway() -> FakePaymentGateway:
    return FakePaymentGateway()


# ── In-process HTTP client sharing the test's transaction + the boundary fakes ───────────────
@pytest.fixture
async def api(
    db: AsyncSession,
    email: FakeEmailSender,
    gateway: FakePaymentGateway,
    sms: FakeSmsSender,
    push: FakePushSender,
    storage: FakeFileStorage,
) -> AsyncIterator[httpx.AsyncClient]:
    async def _session() -> AsyncIterator[AsyncSession]:
        yield db

    def _email() -> EmailSender:
        return email

    def _gateway() -> PaymentGateway:
        return gateway

    def _storage() -> FileStorage:
        return storage

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_email_sender] = _email
    app.dependency_overrides[get_oauth_verifier] = FakeOAuthVerifier
    app.dependency_overrides[get_payment_gateway] = _gateway
    app.dependency_overrides[get_sms_sender] = lambda: sms
    app.dependency_overrides[get_push_sender] = lambda: push
    app.dependency_overrides[get_file_storage] = _storage
    app.dependency_overrides[get_interac_secret] = lambda: "testsecret"
    app.dependency_overrides[public_pay_rate_limit] = lambda: None  # no throttling under test
    app.dependency_overrides[public_review_rate_limit] = lambda: None
    app.dependency_overrides[public_form_rate_limit] = lambda: None
    app.dependency_overrides[public_contract_rate_limit] = lambda: None
    app.dependency_overrides[public_booking_rate_limit] = lambda: None
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


def _bearer(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_access_token(user_id)}"}


@pytest.fixture
def as_owner(api: httpx.AsyncClient) -> httpx.AsyncClient:
    api.headers.update(_bearer(OWNER_USER))
    return api


@pytest.fixture
def as_staff(api: httpx.AsyncClient) -> httpx.AsyncClient:
    api.headers.update(_bearer(STAFF_USER))
    return api


@pytest.fixture
def unauth(api: httpx.AsyncClient) -> httpx.AsyncClient:
    return api


# ── Factories: valid, business-scoped rows built in the test transaction ─────────────────────
class Factory:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def business(self, *, province: str = "BC", name: str = "Test Studio") -> Business:
        biz = Business(
            id=new_id("business"),
            name=name,
            slug=f"test-{new_id('business')[-12:].lower()}",
            province=province,
            timezone="America/Vancouver",
        )
        self.db.add(biz)
        await self.db.flush()
        return biz

    async def user(self, *, email: str | None = None, password: str | None = None) -> User:
        user = User(
            id=new_id("user"),
            email=email or f"u-{new_id('user')[3:13].lower()}@test.ca",
            name="Test User",
            password_hash=hash_password(password) if password else None,
            oauth={},
        )
        self.db.add(user)
        await self.db.flush()
        return user

    async def staff(
        self, *, business: Business, user: User | None = None, role: str = "owner"
    ) -> Staff:
        staff = Staff(
            id=new_id("staff"),
            business_id=business.id,
            user_id=user.id if user else None,
            role=role,
            status="active",
        )
        self.db.add(staff)
        await self.db.flush()
        return staff

    async def client(self, *, business: Business, name: str = "Test Client") -> Client:
        client = Client(
            id=new_id("client"),
            business_id=business.id,
            name=name,
            tags=[],
            custom_fields={},
        )
        self.db.add(client)
        await self.db.flush()
        return client


@pytest.fixture
def factory(db: AsyncSession) -> Factory:
    return Factory(db)
