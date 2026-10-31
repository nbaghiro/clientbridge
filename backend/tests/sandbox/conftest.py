"""Isolated Stripe sandbox fixtures; explicit sandbox runs fail when prerequisites are missing."""

import asyncio
import json
import os
import re
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import stripe
import uvicorn
from e2e import stripe_shapes
from fastapi import FastAPI, Request, Response

from clientbridge.integrations.stripe import (
    StripeGateway,
    WebhookVerificationError,
    close_stripe_client,
    get_payment_gateway,
)
from clientbridge.main import app


def setting(name: str) -> str:
    value = os.environ.get(name)
    if value:
        return value
    if os.environ.get("STRIPE_E2E_REQUIRED") == "1":
        pytest.fail(f"sandbox prerequisite missing: {name}", pytrace=False)
    pytest.skip(f"set {name} to run the Stripe sandbox tier")


@pytest.fixture
async def live_gateway() -> AsyncIterator[StripeGateway]:
    key = setting("STRIPE_TEST_SECRET_KEY")
    if not key.startswith(("sk_test_", "rk_test_")):
        pytest.fail("Stripe QA requires a test-mode key", pytrace=False)
    previous_base, previous_key, previous_version = (
        stripe.api_base,
        stripe.api_key,
        stripe.api_version,
    )
    stripe.api_base = "https://api.stripe.com"
    try:
        gateway = StripeGateway(key, "whsec_sandbox_test", "CA")
        platform = await stripe.Account.retrieve_async()
        assert platform.id == setting("STRIPE_TEST_PLATFORM"), "unexpected Stripe platform"
        balance = await stripe.Balance.retrieve_async()
        assert balance.livemode is False, "live Stripe balance is forbidden in QA"
        yield gateway
    finally:
        await close_stripe_client()
        stripe.api_base, stripe.api_key, stripe.api_version = (
            previous_base,
            previous_key,
            previous_version,
        )


async def merchant(name: str) -> str:
    identity = setting(name)
    account = await stripe.Account.retrieve_async(identity)
    metadata = account.to_dict().get("metadata")
    assert isinstance(metadata, dict) and metadata.get("clientbridge_qa") == "payments", (
        "merchant is not reserved for QA"
    )
    balance = await stripe.Balance.retrieve_async(stripe_account=identity)
    assert balance.livemode is False
    assert account.charges_enabled and account.payouts_enabled, "complete merchant onboarding first"
    assert account.default_currency == "cad", "QA merchant must settle in CAD"
    return identity


@pytest.fixture
async def connected_account_id(live_gateway: StripeGateway) -> str:
    return await merchant("STRIPE_TEST_CONNECTED_ACCOUNT")


@pytest.fixture
async def other_account_id(live_gateway: StripeGateway, connected_account_id: str) -> str:
    identity = await merchant("STRIPE_TEST_OTHER_ACCOUNT")
    assert identity != connected_account_id, "tenant isolation requires distinct merchants"
    return identity


@dataclass
class StripeRun:
    gateway: StripeGateway
    account: str
    namespace: str = field(default_factory=lambda: f"qa-{uuid4()}")
    customers: list[tuple[str, str]] = field(default_factory=list)
    intents: list[tuple[str, str]] = field(default_factory=list)
    clocks: list[tuple[str, str]] = field(default_factory=list)
    prices: list[tuple[str, str]] = field(default_factory=list)
    # charges a test paid out on purpose; the money is at the bank, so there's nothing to refund
    kept: set[str] = field(default_factory=set)

    async def customer(self, account: str | None = None) -> str:
        scope = account or self.account
        identity = await self.gateway.create_customer(
            scope,
            name="QA Customer",
            idempotency_key=f"{self.namespace}:customer:{len(self.customers)}",
        )
        self.customers.append((scope, identity))
        await stripe.Customer.modify_async(
            identity, metadata={"clientbridge_qa": self.namespace}, stripe_account=scope
        )
        return identity

    async def clean_intent(self, account: str, identity: str) -> None:
        await unlocked(lambda: self._clean_intent(account, identity))

    async def _clean_intent(self, account: str, identity: str) -> None:
        intent = await stripe.PaymentIntent.retrieve_async(identity, stripe_account=account)
        assert intent.livemode is False
        if intent.status == "succeeded":
            if identity in self.kept:
                return
            charge_id = intent.latest_charge
            assert isinstance(charge_id, str)
            charge = await stripe.Charge.retrieve_async(charge_id, stripe_account=account)
            # a disputed charge can't be refunded; the dispute already moved its money
            if charge.amount_refunded < charge.amount and not charge.disputed:
                await stripe.Refund.create_async(
                    payment_intent=identity,
                    amount=charge.amount - charge.amount_refunded,
                    refund_application_fee=True,
                    stripe_account=account,
                    idempotency_key=f"{self.namespace}:cleanup:{identity}",
                )
        elif intent.status != "canceled":
            await stripe.PaymentIntent.cancel_async(identity, stripe_account=account)

    async def cleanup(self) -> None:
        errors: list[Exception] = []
        for account, identity in reversed(self.clocks):
            try:
                await stripe.test_helpers.TestClock.delete_async(identity, stripe_account=account)
            except Exception as exc:
                errors.append(exc)
        for account, identity in reversed(self.customers):
            try:
                customer = await stripe.Customer.retrieve_async(identity, stripe_account=account)
                metadata = customer.to_dict().get("metadata")
                assert (
                    isinstance(metadata, dict) and metadata.get("clientbridge_qa") == self.namespace
                )
                intents = await stripe.PaymentIntent.list_async(
                    customer=identity, stripe_account=account
                )
                async for intent in intents.auto_paging_iter():
                    await self.clean_intent(account, intent.id)
                await stripe.Customer.delete_async(identity, stripe_account=account)
            except Exception as exc:
                errors.append(exc)
        for account, identity in reversed(self.intents):
            try:
                await self.clean_intent(account, identity)
            except Exception as exc:
                errors.append(exc)
        for account, identity in reversed(self.prices):
            try:
                price = await stripe.Price.retrieve_async(identity, stripe_account=account)
                assert isinstance(price.product, str)
                await stripe.Product.modify_async(
                    price.product, default_price="", active=False, stripe_account=account
                )
                await stripe.Price.modify_async(identity, active=False, stripe_account=account)
            except Exception as exc:
                errors.append(exc)
        if errors:
            raise ExceptionGroup("Stripe QA cleanup failed", errors)


async def unlocked[T](request: Callable[[], Awaitable[T]]) -> T:
    """Retries Stripe's lock_timeout, returned while Stripe itself is still updating the object."""
    # a dispute can hold its charge for most of a minute while Stripe processes it
    for attempt in range(9):
        try:
            return await request()
        except stripe.RateLimitError as exc:
            # the SDK leaves a 429's code off exc.code and keeps it on exc.error
            if exc.error is None or exc.error.code != "lock_timeout" or attempt == 8:
                raise
            await asyncio.sleep(min(2**attempt, 10))
    raise AssertionError("unreachable")


@pytest.fixture
async def stripe_run(
    live_gateway: StripeGateway, connected_account_id: str
) -> AsyncIterator[StripeRun]:
    run = StripeRun(live_gateway, connected_account_id)
    try:
        yield run
    finally:
        await run.cleanup()


@dataclass
class StripeEvents:
    gateway: StripeGateway
    account: str
    owned: set[str] = field(default_factory=set)
    queue: asyncio.Queue[tuple[bytes, str]] = field(default_factory=asyncio.Queue, repr=False)

    async def capture(self, request: Request) -> Response:
        payload = await request.body()
        signature = request.headers.get("stripe-signature", "")
        try:
            event = self.gateway.verify_webhook(payload, signature)
        except WebhookVerificationError:
            return Response(status_code=400)
        if event.account == self.account and any(
            event.data.get(key) in self.owned
            for key in ("id", "payment_intent")
            if isinstance(event.data.get(key), str)
        ):
            recording = os.environ.get("STRIPE_RECORD_EVENTS")
            if recording:
                body = json.loads(payload)
                stripe_shapes.record(event.type, body["data"]["object"], Path(recording))
            await self.queue.put((payload, signature))
        return Response(status_code=204)

    async def next(self, kind: str, *, within: float = 60) -> tuple[bytes, str]:
        deferred: list[tuple[bytes, str]] = []
        try:
            async with asyncio.timeout(within):
                while True:
                    payload, signature = await self.queue.get()
                    if self.gateway.verify_webhook(payload, signature).type == kind:
                        return payload, signature
                    deferred.append((payload, signature))
        finally:
            for item in deferred:
                self.queue.put_nowait(item)


@pytest.fixture
async def stripe_events(
    api: httpx.AsyncClient, stripe_run: StripeRun
) -> AsyncIterator[StripeEvents]:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    capture = FastAPI()
    events = StripeEvents(stripe_run.gateway, stripe_run.account)
    capture.add_api_route("/events", events.capture, methods=["POST"])
    server = uvicorn.Server(uvicorn.Config(capture, log_level="error"))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    process: asyncio.subprocess.Process | None = None
    drain: asyncio.Task[None] | None = None
    previous = app.dependency_overrides[get_payment_gateway]
    try:
        async with asyncio.timeout(10):
            while not server.started:
                if serving.done():
                    await serving
                    raise RuntimeError("webhook capture server did not start")
                await asyncio.sleep(0.05)
        # no --latest: events must render at the sandbox default, the version the webhook pins
        process = await asyncio.create_subprocess_exec(
            "stripe",
            "listen",
            "--events-from",
            "@accounts",
            "--events",
            ",".join(
                (
                    "payment_intent.succeeded",
                    "payment_intent.payment_failed",
                    "payment_intent.canceled",
                    "refund.created",
                    "refund.updated",
                    "charge.dispute.created",
                    "charge.dispute.updated",
                    "charge.dispute.closed",
                    "charge.dispute.funds_withdrawn",
                    "charge.dispute.funds_reinstated",
                    "payout.created",
                    "payout.paid",
                )
            ),
            "--forward-to",
            f"http://127.0.0.1:{port}/events",
            "--skip-update",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "STRIPE_API_KEY": setting("STRIPE_TEST_SECRET_KEY")},
        )
        assert process.stdout is not None
        async with asyncio.timeout(30):
            while True:
                line = await process.stdout.readline()
                if not line:
                    raise RuntimeError("Stripe listener exited before becoming ready")
                match = re.search(rb"whsec_[A-Za-z0-9]+", line)
                if match:
                    events.gateway = StripeGateway(
                        setting("STRIPE_TEST_SECRET_KEY"), match[0].decode(), "CA"
                    )
                    break

        async def discard_output() -> None:
            assert process is not None and process.stdout is not None
            while await process.stdout.readline():
                pass

        drain = asyncio.create_task(discard_output())
        app.dependency_overrides[get_payment_gateway] = lambda: events.gateway
        yield events
    finally:
        app.dependency_overrides[get_payment_gateway] = previous
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 5)
            except TimeoutError:
                process.kill()
                await process.wait()
        if drain is not None:
            await drain
        server.should_exit = True
        try:
            await asyncio.wait_for(serving, 5)
        finally:
            listener.close()
