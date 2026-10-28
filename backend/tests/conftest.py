"""Shared fixtures: each test runs in a transaction rolled back at teardown, over the seeded DB."""

import json
from collections.abc import AsyncIterator, Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import engine, get_session
from clientbridge.core.deps import (
    get_auth_email_secret,
    get_resend_webhook_secret,
    get_twilio_auth_token,
)
from clientbridge.core.emails import normalize_email
from clientbridge.core.errors import (
    CardDeclined,
    Conflict,
    NotFound,
    PaymentActionRequired,
    Unauthorized,
)
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import (
    public_booking_rate_limit,
    public_contract_rate_limit,
    public_form_rate_limit,
    public_invite_rate_limit,
    public_pay_rate_limit,
)
from clientbridge.integrations.expo import Push, PushSender, get_push_sender
from clientbridge.integrations.identity import Credential, Identity, Login, unavailable
from clientbridge.integrations.jobs import get_jobs
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.integrations.resend import Email, EmailSender, get_email_sender
from clientbridge.integrations.s3 import FileStorage, get_file_storage
from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
    THIN_EVENT,
    AccountBalance,
    AccountConfiguration,
    ChargeFees,
    ConnectAccount,
    ConnectComponent,
    GatewayEvent,
    InvoicePaid,
    MandateState,
    MissedEvent,
    PaymentGateway,
    PaymentIntentResult,
    PayoutPage,
    PlanItem,
    PlanSubscription,
    PostalAddress,
    PriceTerms,
    RefundResult,
    SetupIntentResult,
    SetupIntentState,
    StripeResource,
    StripeTransaction,
    SubscribedItem,
    SubscriptionResult,
    TransactionPage,
    WebhookVerificationError,
    event_from,
    get_payment_gateway,
)
from clientbridge.integrations.twilio import Sms, SmsSender, get_sms_sender
from clientbridge.main import app
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business, PlanStatus, Staff, SubjectKind, User
from clientbridge.models.clients import Client
from clientbridge.models.platform import Audit
from clientbridge.services import ledger
from clientbridge.services.deliveries import DELIVERIES_JOB, run_deliveries
from clientbridge.services.plans import PLAN_PRICES
from clientbridge.services.tax import TaxResult
from tests.clock import FROZEN

# test modules are collected at FROZEN too, so a date they compute at import agrees with the tests
clock.travel(FROZEN)

# Seeded baseline (committed): the demo business + two of its users.
BIZ = "bz_birchbark"
OWNER_USER = "us_dev"
STAFF_USER = "us_diego"


async def book_invoice(db: AsyncSession, invoice: Invoice) -> None:
    """Post a directly-inserted invoice to the ledger, exactly as sending it would."""
    tax = invoice.tax_total_cents
    await ledger.post_invoice(
        db,
        invoice,
        TaxResult(
            invoice.subtotal_cents, tax, invoice.total_cents, {"GST": tax} if tax else {}, []
        ),
    )


@pytest.fixture(autouse=True)
def frozen_clock(request: pytest.FixtureRequest) -> Iterator[None]:
    """Start business time at FROZEN; tests marked wall_clock talk to a real external clock."""
    if request.node.get_closest_marker("wall_clock") is not None:
        clock.reset()
        yield
        return
    clock.travel(FROZEN)
    try:
        yield
    finally:
        clock.reset()


_seeded_at: dict[str, datetime | None] = {}


async def check_seeded_at_frozen(session: AsyncSession) -> None:
    if "as_of" not in _seeded_at:
        changes = await session.scalar(select(Audit.changes).where(Audit.id == "aud_demo_seed"))
        as_of = changes.get("as_of") if changes else None
        _seeded_at["as_of"] = datetime.fromisoformat(as_of) if isinstance(as_of, str) else None
    if _seeded_at["as_of"] != FROZEN:
        pytest.fail(
            f"the test database was seeded at {_seeded_at['as_of']}, not at {FROZEN.isoformat()}; "
            "run the suite through make test-backend"
        )


@pytest.fixture
async def owner_db() -> AsyncIterator[AsyncSession]:
    """A rolled-back session as the schema owner, for admin tools such as the demo reset."""
    owner = create_async_engine(get_settings().migration_database_url)
    conn = await owner.connect()
    trans = await conn.begin()
    session = AsyncSession(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await owner.dispose()


@pytest.fixture
async def db(request: pytest.FixtureRequest) -> AsyncIterator[AsyncSession]:
    conn = await engine.connect()
    trans = await conn.begin()
    session = AsyncSession(
        bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        if request.node.get_closest_marker("wall_clock") is None:
            await check_seeded_at_frozen(session)
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()  # function-scoped loop → clear the pool for the next test


RESEND_SECRET = "whsec_dGVzdHNlY3JldA=="


class FakeEmailSender:
    def __init__(self) -> None:
        self.sent: list[Email] = []

    async def send(self, email: Email) -> str | None:
        self.sent.append(email)
        return f"email_fake{len(self.sent)}"


@pytest.fixture
def email() -> FakeEmailSender:
    return FakeEmailSender()


class FakeSmsSender:
    def __init__(self) -> None:
        self.sent: list[Sms] = []

    async def send(self, sms: Sms) -> str | None:
        self.sent.append(sms)
        return f"sms_fake{len(self.sent)}"


class DownEmailSender(FakeEmailSender):
    """Fails every send, the way a provider outage surfaces to the notifier."""

    async def send(self, email: Email) -> str | None:
        raise RuntimeError("email provider down")


class DownSmsSender(FakeSmsSender):
    """Fails every send, the way a provider outage surfaces to the notifier."""

    async def send(self, sms: Sms) -> str | None:
        raise RuntimeError("sms provider down")


class FakePushSender:
    def __init__(self) -> None:
        self.sent: list[Push] = []

    async def send(self, push: Push) -> None:
        self.sent.append(push)


@pytest.fixture
def sms() -> FakeSmsSender:
    return FakeSmsSender()


class FakeJobs:
    """Records each job a request enqueues; with `work`, runs the deliveries as the worker would."""

    def __init__(
        self,
        db: AsyncSession,
        email: EmailSender,
        sms: SmsSender,
        push: PushSender,
        *,
        work: bool = True,
    ) -> None:
        self.db, self.email, self.sms, self.push = db, email, sms, push
        self.work = work
        self.enqueued: list[str] = []

    async def enqueue(self, name: str) -> None:
        self.enqueued.append(name)
        if self.work and name == DELIVERIES_JOB:
            await run_deliveries(self.db, self.email, self.sms, self.push)


@pytest.fixture
def push() -> FakePushSender:
    return FakePushSender()


class FakeFileStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str]] = []
        self.downloads: list[str] = []
        self.stored: dict[str, int] = {}
        self.deleted: list[str] = []

    def presign_upload(self, key: str, content_type: str) -> str:
        self.uploads.append((key, content_type))
        return f"https://files.test/{key}"

    def presign_download(self, key: str) -> str:
        self.downloads.append(key)
        return f"https://files.test/{key}"

    def head(self, key: str) -> int | None:
        return self.stored.get(key)

    def delete(self, key: str) -> None:
        self.stored.pop(key, None)
        self.deleted.append(key)


@pytest.fixture
def storage() -> FakeFileStorage:
    return FakeFileStorage()


class FakeIdentityProvider:
    """The auth service at the boundary: sessions are opaque strings mapped to identities."""

    def __init__(self) -> None:
        self.sessions: dict[str, Identity] = {}
        # What a cached (non-fresh) read still returns, the auth service's earlier answer.
        self.cached: dict[str, Identity] = {}
        self.step_up: set[str] = set()
        self.deleted: set[str] = set()
        # the admin API's identities by id, with their emails and demo tags
        self.accounts: dict[str, Login] = {}
        self.tagged: list[str] = []
        self.fresh_reads = 0
        self.down = False

    def issue(self, identity: Identity) -> str:
        credential = f"test-{uuid4().hex}"
        self.sessions[credential] = identity
        return credential

    async def whoami(self, credential: Credential, *, fresh: bool = False) -> Identity:
        if self.down:
            raise unavailable()
        self.fresh_reads += fresh
        key = credential.session_token or credential.cookie
        if key in self.step_up:
            raise Unauthorized("second factor required", code="second_factor_required")
        identity = self.sessions.get(key) if fresh else self.cached.get(key, self.sessions.get(key))
        if identity is None:
            raise Unauthorized("session expired", code="unauthenticated")
        return identity

    async def identity_exists(self, identity_id: str) -> bool:
        if self.down:
            raise unavailable()
        return identity_id not in self.deleted

    async def find_identity(self, email: str) -> str | None:
        listed = (a.id for a in self.accounts.values() if a.email == email)
        signed_in = (i.id for i in self.sessions.values() if i.email == email)
        return next(listed, None) or next(signed_in, None)

    async def create_identity(
        self, email: str, name: str, password: str, *, demo: bool = False
    ) -> str:
        identity_id = str(uuid4())
        self.accounts[identity_id] = Login(identity_id, email, demo)
        return identity_id

    async def tag_demo(self, identity_id: str) -> None:
        self.tagged.append(identity_id)
        if login := self.accounts.get(identity_id):
            self.accounts[identity_id] = Login(identity_id, login.email, True)

    async def list_identities(self) -> list[Login]:
        return [a for i, a in self.accounts.items() if i not in self.deleted]

    async def delete_identity(self, identity_id: str) -> None:
        self.deleted.add(identity_id)

    def end_sessions(self, identity_id: str) -> None:
        """What the auth service does after a password reset: every session of the identity ends."""
        self.sessions = {k: v for k, v in self.sessions.items() if v.id != identity_id}


@pytest.fixture
def identities() -> FakeIdentityProvider:
    return FakeIdentityProvider()


def identity_for(
    user: User, *, email: str | None = None, verified: bool = True, second_factor: bool = False
) -> Identity:
    address = email or user.email
    return Identity(
        id=user.identity_id,
        email=address,
        verified_emails=frozenset({normalize_email(address)}) if verified else frozenset(),
        name=user.name,
        session_id=f"ses-{uuid4().hex}",
        second_factor=second_factor,
    )


async def session_token(
    identities: FakeIdentityProvider, db: AsyncSession, user_id: str, *, verified: bool = True
) -> str:
    user = await db.get(User, user_id)
    assert user is not None
    return identities.issue(identity_for(user, verified=verified))


def subscribed(*items: PlanItem | str) -> tuple[SubscribedItem, ...]:
    """Subscription items for these prices, named by lookup key as the plan code asks for them."""
    rows: list[SubscribedItem] = []
    for item in items:
        wanted = PlanItem(item) if isinstance(item, str) else item
        price = PLAN_PRICES[wanted.lookup_key]
        rows.append(SubscribedItem(price.product, price.interval, wanted.quantity))
    return tuple(rows)


@dataclass(frozen=True)
class PlanCheckout:
    account_id: str
    items: tuple[PlanItem, ...]
    business_id: str
    trial_end: datetime | None


def _primary(row: dict[str, object]) -> bool:
    """Stripe's `source` filter leaves out a refund failure and a returned application fee."""
    fee_return = row.get("type") == "adjustment" and row.get("reporting_category") == "fee"
    return row.get("type") != "refund_failure" and not fee_return


class FakePaymentGateway:
    refund_status: str = "succeeded"

    def __init__(self) -> None:
        self.account_sessions: list[tuple[str, ConnectComponent]] = []
        self.payment_domains: dict[str, set[str]] = {}
        self.created_accounts: list[str] = []
        self.configurations: dict[str, set[AccountConfiguration]] = {}
        self.merchant_added: list[str] = []
        self.account_addresses: list[tuple[str, PostalAddress]] = []
        self.account_urls: list[tuple[str, str]] = []
        self.customer_added: list[tuple[str, PostalAddress]] = []
        self.checkouts: list[PlanCheckout] = []
        self.checkout_keys: dict[str, str] = {}
        self.portal_sessions: list[str] = []
        self.open_checkouts: dict[str, list[str]] = {}
        self.expired_checkouts: list[str] = []
        self.paid_checkouts: dict[
            str, str
        ] = {}  # account -> subscription a completed Checkout bills
        self.canceled_plan_subscriptions: list[str] = []
        self.refunded_plan_subscriptions: list[str] = []
        self.plan_subscriptions: dict[str, PlanSubscription] = {}
        self.plan_item_keys: list[str] = []
        self._plan_changes: dict[str, PlanSubscription] = {}  # honor plan change idempotency keys
        self.detached: list[str] = []
        self.refunds: list[tuple[str, int, bool]] = []
        self.created_prices: list[str] = []
        self.created_price_amounts: list[int] = []  # unit_amount per created Price
        self.prices: dict[str, PriceTerms] = {}
        self.created_subscriptions: list[str] = []
        self.subscription_metadata: dict[str, dict[str, str]] = {}
        self.canceled_subscriptions: list[str] = []
        self.period_end_cancels: list[str] = []
        self.subscription_prices: dict[str, str] = {}
        self.subscription_fee_percents: dict[str, float] = {}
        self._sub_methods: dict[str, str] = {}
        self.pad_enabled = True
        self.pad_intents: dict[str, SetupIntentState] = {}
        self.pad_keys: dict[str, str] = {}
        self.mandates: dict[str, MandateState] = {}
        self._seq = 0
        self._intents: dict[str, PaymentIntentResult] = {}  # honor Stripe idempotency keys
        self._subs: dict[str, SubscriptionResult] = {}  # honor subscription idempotency keys
        self.charged_methods: list[str] = []  # off-session payment_methods passed to a charge
        self.created_locations: list[str] = []  # Terminal locations minted
        self.location_addresses: list[PostalAddress] = []
        self.token_locations: list[str] = []  # the Location each connection token is scoped to
        self.deleted_locations: list[str] = []
        self.location_delete_fails = False
        self.accounts: dict[str, ConnectAccount] = {}  # per-account get_account() results
        self.account_status: ConnectAccount | None = None  # override get_account() in a test
        self.payout_transaction_calls: list[tuple[str, str, str | None]] = []
        self.transaction_calls: list[tuple[str, int | None, str | None]] = []
        self.mandated_charges: list[tuple[str | None, str]] = []
        self.pending_fees: set[str] = set()
        self.charges: dict[str, tuple[int, int]] = {}  # intent id -> (amount, application fee)
        self.payouts: dict[str, list[dict[str, object]]] = {}
        self.transactions: dict[str, list[dict[str, object]]] = {}
        self.objects: dict[tuple[str | None, str, str], dict[str, object]] = {}
        self.missed: dict[str | None, list[MissedEvent]] = {}
        self.customer_keys: dict[str, str] = {}
        self.customer_updates: list[tuple[str, str]] = []
        self.unreadable_accounts: set[str] = set()
        self.terminal_customers: dict[str, str | None] = {}
        self.balances: dict[str, AccountBalance] = {}
        self.pending_cents = 0
        self.balance_cents = 0  # get_balance_cents() result
        self.invoice_payments: dict[str, InvoicePaid] = {}  # Stripe invoice id -> what paid it
        self.canceled_intents: list[str] = []
        self.confirmed: set[str] = set()  # intents the payer already confirmed, so uncancelable

    async def create_connected_account(
        self,
        *,
        business_name: str,
        email: str | None,
        url: str | None = None,
        configurations: tuple[AccountConfiguration, ...],
        address: PostalAddress | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        self._seq += 1
        acct = f"acct_fake{self._seq}"
        self.created_accounts.append(acct)
        self.configurations[acct] = set(configurations)
        return acct

    async def add_merchant_configuration(
        self, account_id: str, *, business_name: str, email: str | None
    ) -> None:
        self.merchant_added.append(account_id)
        self.configurations.setdefault(account_id, set()).add("merchant")

    async def add_customer_configuration(self, account_id: str, *, address: PostalAddress) -> None:
        self.customer_added.append((account_id, address))
        self.configurations.setdefault(account_id, set()).add("customer")

    async def update_account_address(self, account_id: str, *, address: PostalAddress) -> None:
        self.account_addresses.append((account_id, address))

    async def update_account_url(self, account_id: str, *, url: str) -> None:
        self.account_urls.append((account_id, url))

    async def create_plan_checkout(
        self,
        account_id: str,
        *,
        items: Sequence[PlanItem],
        business_id: str,
        trial_end: datetime | None,
        success_url: str,
        cancel_url: str,
        attempt: str,
    ) -> str:
        if attempt not in self.checkout_keys:
            self.checkouts.append(PlanCheckout(account_id, tuple(items), business_id, trial_end))
            url = f"https://checkout.stripe.test/c/{len(self.checkouts)}"
            self.checkout_keys[attempt] = url
            self.open_checkouts.setdefault(account_id, []).append(url)
        return self.checkout_keys[attempt]

    async def close_plan_checkouts(self, account_id: str, *, keep: str) -> PlanSubscription | None:
        kept = self.checkout_keys.get(keep)
        opened = self.open_checkouts.get(account_id, [])
        self.expired_checkouts += [url for url in opened if url != kept]
        self.open_checkouts[account_id] = [url for url in opened if url == kept]
        return await self.paid_plan_subscription(account_id)

    async def paid_plan_subscription(self, account_id: str) -> PlanSubscription | None:
        paid = self.paid_checkouts.get(account_id)
        return self.plan_subscriptions[paid] if paid is not None else None

    async def cancel_plan_subscription(self, subscription_id: str) -> None:
        self.canceled_plan_subscriptions.append(subscription_id)
        sub = self.plan_subscriptions.get(subscription_id)
        if sub is not None:
            self.plan_subscriptions[subscription_id] = replace(sub, status="canceled")

    async def refund_plan_subscription(self, subscription_id: str) -> int:
        self.refunded_plan_subscriptions.append(subscription_id)
        return 0

    async def create_portal_session(self, account_id: str, *, return_url: str) -> str:
        self.portal_sessions.append(account_id)
        return f"https://billing.stripe.test/p/{len(self.portal_sessions)}"

    async def get_plan_subscription(self, subscription_id: str) -> PlanSubscription:
        return self.plan_subscriptions[subscription_id]

    async def set_plan_items(
        self, subscription_id: str, *, items: Sequence[PlanItem], idempotency_key: str
    ) -> PlanSubscription:
        if idempotency_key in self._plan_changes:
            return self._plan_changes[idempotency_key]
        self.plan_item_keys.append(idempotency_key)
        current = self.plan_subscriptions[subscription_id]
        updated = replace(current, items=subscribed(*items))
        self.plan_subscriptions[subscription_id] = updated
        self._plan_changes[idempotency_key] = updated
        return updated

    async def create_account_session(self, account_id: str, component: ConnectComponent) -> str:
        self.account_sessions.append((account_id, component))
        return f"session_secret_{len(self.account_sessions)}"

    async def register_payment_domains(self, account_id: str, domains: Sequence[str]) -> None:
        self.payment_domains.setdefault(account_id, set()).update(domains)

    async def get_account(self, account_id: str) -> ConnectAccount:
        if account_id in self.unreadable_accounts:
            raise Conflict("the account is closed")
        # a freshly-created account: nothing submitted, Stripe wants the hosted KYC details
        return (
            self.accounts.get(account_id)
            or self.account_status
            or ConnectAccount(
                id=account_id,
                charges_enabled=False,
                payouts_enabled=False,
                disabled_reason=None,
                currently_due=[
                    "identity.attestations.terms_of_service.account",
                    "external_account",
                ],
                eventually_due=[],
                past_due=[],
                card_status="restricted"
                if "merchant" in self.configurations.get(account_id, {"merchant"})
                else None,
            )
        )

    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent:
        if signature != "good":
            raise WebhookVerificationError("bad signature")
        body = json.loads(payload)
        if body.get("object") == THIN_EVENT:
            return event_from(body)
        account = body.get("account")
        created = body.get("created")
        return GatewayEvent(
            id=str(body["id"]),
            type=str(body["type"]),
            data=dict(body["data"]["object"]),
            account=str(account) if account is not None else None,
            created=datetime.fromtimestamp(created, tz=UTC) if isinstance(created, int) else None,
            api_version=str(body.get("api_version", STRIPE_API_VERSION)),
        )

    async def balance_transactions(
        self,
        account_id: str,
        *,
        since: int | None = None,
        source: str | None = None,
        kind: str | None = None,
    ) -> list[dict[str, object]]:
        if kind is None:
            self.transaction_calls.append((account_id, since, source))
        return [
            row
            for row in self.transactions.get(account_id, [])
            if (source is None or (row.get("source") == source and _primary(row)))
            and (kind is None or row.get("type") == kind)
            and (since is None or not isinstance(at := row.get("created"), int) or at >= since)
        ]

    async def list_payouts(self, account_id: str, after: str | None = None) -> PayoutPage:
        rows = self.payouts.get(account_id, [])
        start = 0
        if after is not None:
            matches = [i for i, row in enumerate(rows) if row.get("id") == after]
            if not matches:
                raise Conflict("invalid payout cursor")
            start = matches[0] + 1
        page = rows[start : start + 24]
        return PayoutPage(page, str(page[-1]["id"]) if start + 24 < len(rows) else None)

    async def payout_transactions(
        self, account_id: str, payout_id: str, after: str | None
    ) -> TransactionPage:
        self.payout_transaction_calls.append((account_id, payout_id, after))
        rows = [
            StripeTransaction.model_validate(row) for row in self.transactions.get(payout_id, [])
        ]
        start = next((i + 1 for i, row in enumerate(rows) if row.id == after), 0)
        page = rows[start : start + 24]
        return TransactionPage(page, page[-1].id if start + 24 < len(rows) else None)

    async def retrieve(
        self, account_id: str | None, resource: StripeResource, identity: str
    ) -> dict[str, object]:
        if resource == "payout" and (account_id, resource, identity) not in self.objects:
            raise NotFound("payout not found")
        return self.objects[(account_id, resource, identity)]

    async def undelivered_events(
        self, account_id: str | None, *, since: datetime, limit: int
    ) -> list[MissedEvent]:
        return [e for e in self.missed.get(account_id, []) if e.created >= since][:limit]

    async def create_customer(self, account_id: str, *, name: str, idempotency_key: str) -> str:
        self._seq += 1
        return self.customer_keys.setdefault(idempotency_key, f"cus_fake{self._seq}")

    async def update_customer(self, account_id: str, customer_id: str, *, name: str) -> None:
        self.customer_updates.append((customer_id, name))

    async def create_setup_intent(self, account_id: str, *, customer_id: str) -> SetupIntentResult:
        self._seq += 1
        sid = f"seti_fake{self._seq}"
        return SetupIntentResult(id=sid, client_secret=f"{sid}_secret")

    async def create_pad_setup_intent(
        self,
        account_id: str,
        *,
        customer_id: str,
        idempotency_key: str,
        email: str | None = None,
    ) -> SetupIntentResult:
        if idempotency_key in self.pad_keys:
            state = self.pad_intents[self.pad_keys[idempotency_key]]
            return SetupIntentResult(id=state.id, client_secret=state.client_secret)
        self._seq += 1
        sid = f"seti_pad_fake{self._seq}"
        self.pad_keys[idempotency_key] = sid
        self.pad_intents[sid] = SetupIntentState(
            id=sid,
            client_secret=f"{sid}_secret",
            status="requires_payment_method",
            customer_id=customer_id,
            payment_method=None,
            mandate_id=None,
        )
        return SetupIntentResult(id=sid, client_secret=f"{sid}_secret")

    async def ensure_pad_capability(self, account_id: str) -> None:
        if not self.pad_enabled:
            raise Conflict("complete Canadian pre-authorized debit setup")

    async def get_setup_intent(self, account_id: str, setup_intent_id: str) -> SetupIntentState:
        return self.pad_intents[setup_intent_id]

    async def get_mandate(self, account_id: str, mandate_id: str) -> MandateState:
        return self.mandates[mandate_id]

    async def create_price(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: str,
        product_name: str,
    ) -> str:
        self._seq += 1
        pid = f"price_fake{self._seq}"
        self.created_prices.append(pid)
        self.created_price_amounts.append(amount_cents)
        self.prices[pid] = PriceTerms(amount_cents, currency.upper(), interval_count, frequency)
        return pid

    async def get_price(self, account_id: str, price_id: str) -> PriceTerms | None:
        return self.prices.get(price_id)

    async def create_subscription(
        self,
        account_id: str,
        *,
        customer_id: str,
        price_id: str,
        payment_method_id: str,
        metadata: dict[str, str],
        application_fee_percent: float,
        idempotency_key: str | None = None,
    ) -> SubscriptionResult:
        if idempotency_key is not None:
            # Stripe replays a key's first outcome and refuses the key with other parameters
            first = self._sub_methods.setdefault(idempotency_key, payment_method_id)
            if first != payment_method_id:
                raise Conflict("the retry differs from the original request")
        if payment_method_id == "pm_card_declined":
            raise CardDeclined("the card was declined")
        if idempotency_key is not None and idempotency_key in self._subs:
            return self._subs[idempotency_key]
        self._seq += 1
        sid = f"sub_fake{self._seq}"
        self.created_subscriptions.append(sid)
        self.subscription_metadata[sid] = metadata
        self.subscription_prices[sid] = price_id
        self.subscription_fee_percents[sid] = application_fee_percent
        result = SubscriptionResult(
            id=sid,
            status="active",
            current_period_end=datetime(2030, 2, 1, tzinfo=UTC),
        )
        if idempotency_key is not None:
            self._subs[idempotency_key] = result
        return result

    async def cancel_subscription(
        self, account_id: str, *, subscription_id: str, at_period_end: bool = False
    ) -> None:
        if at_period_end:
            self.period_end_cancels.append(subscription_id)
        else:
            self.canceled_subscriptions.append(subscription_id)

    async def invoice_for_payment(
        self, account_id: str, intent_id: str
    ) -> dict[str, object] | None:
        return self.objects.get((account_id, "invoice_payment", intent_id))

    def pay_invoice(self, invoice_id: str, intent_id: str, amount_cents: int) -> None:
        self.invoice_payments[invoice_id] = InvoicePaid(intent_id, amount_cents)

    async def get_invoice_payment(self, account_id: str, *, invoice_id: str) -> InvoicePaid | None:
        return self.invoice_payments.get(invoice_id)

    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str | None,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
        mandate: str | None = None,
    ) -> PaymentIntentResult:
        if mandate is not None:
            self.mandated_charges.append((payment_method, mandate))
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
        self.charges[pid] = (amount_cents, application_fee_cents)
        return result

    async def cancel_payment_intent(self, account_id: str, *, payment_intent_id: str) -> None:
        if payment_intent_id in self.confirmed:
            raise Conflict("this invoice already has a payment in progress")
        self.canceled_intents.append(payment_intent_id)

    async def refund(
        self,
        account_id: str,
        *,
        payment_intent_id: str,
        amount_cents: int,
        idempotency_key: str,
        refund_application_fee: bool = False,
    ) -> RefundResult:
        self._seq += 1
        self.refunds.append((payment_intent_id, amount_cents, refund_application_fee))
        return RefundResult(id=f"re_fake{self._seq}", status=self.refund_status)

    async def detach_payment_method(self, account_id: str, *, payment_method_id: str) -> None:
        self.detached.append(payment_method_id)

    async def create_connection_token(self, account_id: str, *, location_id: str) -> str:
        self._seq += 1
        self.token_locations.append(location_id)
        return f"pst_fake{self._seq}"

    async def delete_terminal_location(self, account_id: str, *, location_id: str) -> None:
        if self.location_delete_fails:
            raise Conflict("the location still has readers")
        self.deleted_locations.append(location_id)

    async def create_terminal_location(
        self, account_id: str, *, display_name: str, address: PostalAddress
    ) -> str:
        self._seq += 1
        loc = f"tml_fake{self._seq}"
        self.created_locations.append(loc)
        self.location_addresses.append(address)
        return loc

    async def create_terminal_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        customer_id: str | None = None,
    ) -> PaymentIntentResult:
        if idempotency_key in self._intents:
            return self._intents[idempotency_key]
        self._seq += 1
        pid = f"pi_term_fake{self._seq}"
        result = PaymentIntentResult(id=pid, client_secret=f"{pid}_secret")
        self._intents[idempotency_key] = result
        self.charges[pid] = (amount_cents, application_fee_cents)
        self.terminal_customers[pid] = customer_id
        return result

    async def get_payment_fees(
        self, account_id: str, *, payment_intent_id: str
    ) -> ChargeFees | None:
        if payment_intent_id in self.pending_fees:
            return None
        amount, app_fee = self.charges.get(payment_intent_id, (0, 0))
        processing = round(amount * 0.029) + 30 if amount else 0
        return ChargeFees(processing, app_fee, None)

    async def get_balance(self, account_id: str, *, currency: str) -> AccountBalance:
        return self.balances.get(
            account_id, AccountBalance(self.balance_cents - self.pending_cents, self.pending_cents)
        )

    async def get_balance_cents(self, account_id: str, *, currency: str) -> int:
        value = await self.get_balance(account_id, currency=currency)
        return value.available_cents + value.pending_cents


@pytest.fixture
def gateway() -> FakePaymentGateway:
    return FakePaymentGateway()


@pytest.fixture
def jobs(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> FakeJobs:
    return FakeJobs(db, email, sms, push)


@pytest.fixture
async def api(
    db: AsyncSession,
    email: FakeEmailSender,
    gateway: FakePaymentGateway,
    sms: FakeSmsSender,
    push: FakePushSender,
    jobs: FakeJobs,
    storage: FakeFileStorage,
    identities: FakeIdentityProvider,
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
    app.dependency_overrides[get_identity_provider] = lambda: identities
    app.dependency_overrides[get_payment_gateway] = _gateway
    app.dependency_overrides[get_sms_sender] = lambda: sms
    app.dependency_overrides[get_push_sender] = lambda: push
    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_file_storage] = _storage
    app.dependency_overrides[get_twilio_auth_token] = lambda: "testtoken"
    app.dependency_overrides[get_auth_email_secret] = lambda: "testsecret"
    app.dependency_overrides[get_resend_webhook_secret] = lambda: RESEND_SECRET
    app.dependency_overrides[public_pay_rate_limit] = lambda: None  # no throttling under test
    app.dependency_overrides[public_form_rate_limit] = lambda: None
    app.dependency_overrides[public_contract_rate_limit] = lambda: None
    app.dependency_overrides[public_booking_rate_limit] = lambda: None
    app.dependency_overrides[public_invite_rate_limit] = lambda: None
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
async def as_owner(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> httpx.AsyncClient:
    token = await session_token(identities, db, OWNER_USER)
    api.headers.update({"X-Session-Token": token, "X-Business-Id": BIZ})
    return api


@pytest.fixture
async def as_staff(
    api: httpx.AsyncClient, db: AsyncSession, identities: FakeIdentityProvider
) -> httpx.AsyncClient:
    token = await session_token(identities, db, STAFF_USER)
    api.headers.update({"X-Session-Token": token})
    return api


@pytest.fixture
def unauth(api: httpx.AsyncClient) -> httpx.AsyncClient:
    return api


class Factory:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def business(
        self,
        *,
        province: str = "BC",
        name: str = "Test Studio",
        plan_status: PlanStatus = "active",
        subject: SubjectKind | None = "pet",
    ) -> Business:
        # complimentary Team like the demo, so a test's fixed clock never finds it lapsed
        biz = Business(
            id=new_id("business"),
            name=name,
            slug=f"test-{new_id('business')[-12:].lower()}",
            province=province,
            timezone="America/Vancouver",
            plan="team" if plan_status == "active" else None,
            plan_status=plan_status,
            subject=subject,
        )
        self.db.add(biz)
        await self.db.flush()
        return biz

    async def user(self, *, email: str | None = None, name: str = "Test User") -> User:
        user = User(
            id=new_id("user"),
            identity_id=str(uuid4()),
            email=email or f"u-{new_id('user')[3:13].lower()}@test.ca",
            name=name,
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


@pytest.fixture
async def google_review_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    from clientbridge.services import reviews
    from tests.google_business import FakeGoogle, FakeVault

    settings = get_settings()
    for name, value in {
        "google_business_enabled": True,
        "google_business_client_id": "id",
        "google_business_client_secret": "secret",
        "google_business_kms_key": "key",
        "google_business_redirect_uri": "http://test/callback",
    }.items():
        monkeypatch.setattr(settings, name, value)
    gateway, vault = FakeGoogle(), FakeVault()
    monkeypatch.setattr(reviews, "get_google_business_gateway", lambda: gateway)
    monkeypatch.setattr(reviews, "get_google_secret_store", lambda: vault)
