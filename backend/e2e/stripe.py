"""The Stripe provider lane: its runner, webhook relay, sandbox fixtures, evidence and recovery."""

import argparse
import asyncio
import fcntl
import json
import os
import queue
import re
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import tomllib
import traceback
from collections.abc import Callable
from contextlib import ExitStack, suppress
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Literal, cast
from urllib.parse import urlparse, urlsplit
from uuid import UUID, uuid4

import stripe
from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from scripts.demo_context import FIXTURE_BUSINESS, run_id
from scripts.stripe_qa import environment, preflight
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import (
    PAYMENT_EVENTS,
    STRIPE_API_VERSION,
    StripeGateway,
    close_stripe_client,
)
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business, PlanStatus
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking
from clientbridge.services.business import apply_account_status
from clientbridge.services.payments import reconcile_stripe_transactions
from e2e import tier
from e2e.results import REQUIRED_CASES, Report, browser_cases
from e2e.runner import ROOT, Stack, owned_processes, source_snapshot, stop

BUSINESS = run_id(FIXTURE_BUSINESS)


def guard() -> str:
    settings = get_settings()
    database = urlparse(settings.database_url)
    if (
        os.environ.get("STRIPE_BROWSER_E2E") != "1"
        or settings.env != "dev"
        or database.hostname not in ("localhost", "127.0.0.1")
        or database.path != "/clientbridge_test_e2e"
        or urlparse(settings.smtp_url or "").hostname not in ("localhost", "127.0.0.1", "mailpit")
        or not settings.stripe_secret_key.startswith(("sk_test_", "rk_test_"))
        or settings.stripe_secret_key != os.environ.get("STRIPE_TEST_SECRET_KEY")
        or not settings.stripe_webhook_secret.startswith("whsec_")
    ):
        raise ValueError(
            "requires isolated local provider API/database, test credentials and Mailpit"
        )
    account = os.environ["STRIPE_TEST_CONNECTED_ACCOUNT"]
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = STRIPE_API_VERSION
    return account


async def invoice_evidence(invoice_id: str | None, receipts: bool = False) -> dict[str, object]:
    account = guard()
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        business = (
            (
                await db.execute(
                    text(
                        "SELECT stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled "
                        "FROM businesses WHERE id = :id"
                    ),
                    {"id": BUSINESS},
                )
            )
            .mappings()
            .one()
        )
        if business["stripe_account_id"] != account or not (
            business["stripe_charges_enabled"] and business["stripe_payouts_enabled"]
        ):
            raise ValueError("runner must bind the isolated business to the ready QA merchant")
        if invoice_id is None:
            await preflight(dict(os.environ))
            return {"ready": True, "account": account, "business": BUSINESS}
        invoice = (
            (
                await db.execute(
                    text(
                        "SELECT id, business_id, client_id FROM invoices "
                        "WHERE id = :id AND business_id = :business"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            )
            .mappings()
            .one()
        )
        if receipts:
            rows = await db.execute(
                text(
                    "SELECT d.id, d.key, d.state, p.id AS payment_id FROM deliveries d "
                    "JOIN payments p ON d.key LIKE 'stripe:payment:' || p.id || ':%' "
                    "WHERE p.invoice_id=:id AND p.business_id=:business "
                    "AND d.business_id=:business AND d.payload->>'channel'='email' ORDER BY d.id"
                ),
                {"id": invoice_id, "business": BUSINESS},
            )
            return {"receipts": [dict(row) for row in rows.mappings()]}
        payments = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT id, status, amount_cents, currency, tip_cents, "
                        "provider, provider_ref, "
                        "kind FROM payments WHERE invoice_id = :id AND business_id = :business "
                        "ORDER BY id"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            ).mappings()
        ]
        entries = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT e.journal_id, e.ref, e.amount_cents, e.currency, a.category, "
                        "a.owner_type, a.owner_id FROM entries e "
                        "JOIN accounts a ON a.id=e.account_id "
                        "WHERE e.source_type='payment' AND e.source_id IN "
                        "(SELECT id FROM payments WHERE invoice_id=:id AND business_id=:business) "
                        "ORDER BY e.ref, e.leg"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            ).mappings()
        ]
        customer = await db.scalar(
            text("SELECT stripe_customer_id FROM clients WHERE id=:id AND business_id=:business"),
            {"id": invoice["client_id"], "business": BUSINESS},
        )
        if not isinstance(customer, str):
            raise ValueError("invoice fixture has no registered provider customer")
        remote_intents = await stripe.PaymentIntent.list_async(
            customer=customer, stripe_account=account
        )
        provider_intent_ids: list[str] = []
        async for remote in remote_intents.auto_paging_iter():
            metadata = remote.to_dict().get("metadata", {})
            if remote.livemode or metadata.get("invoice_id") != invoice_id:
                raise ValueError("fixture customer has an intent outside this invoice")
            provider_intent_ids.append(remote.id)
        provider: list[dict[str, object]] = []
        webhook_ids: list[str] = []
        for payment in payments:
            identity = payment["provider_ref"]
            if not isinstance(identity, str) or not identity.startswith("pi_"):
                continue
            intent = await stripe.PaymentIntent.retrieve_async(identity, stripe_account=account)
            if intent.livemode:
                raise ValueError("live payment evidence is forbidden")
            details = intent.to_dict()
            last_error = details.get("last_payment_error") or {}
            next_action = details.get("next_action") or {}
            item: dict[str, object] = {
                "id": intent.id,
                "status": intent.status,
                "livemode": intent.livemode,
                "amount": intent.amount,
                "currency": intent.currency,
                "application_fee_amount": intent.application_fee_amount,
                "account": account,
                "error_code": last_error.get("code"),
                "decline_code": last_error.get("decline_code"),
                "next_action_type": next_action.get("type"),
            }
            if isinstance(intent.latest_charge, str):
                charge = await stripe.Charge.retrieve_async(
                    intent.latest_charge, expand=["balance_transaction"], stripe_account=account
                )
                transaction = charge.balance_transaction
                authentication = (
                    charge.to_dict()
                    .get("payment_method_details", {})
                    .get("card", {})
                    .get("three_d_secure")
                )
                item.update(
                    {
                        "charge": charge.id,
                        "charge_paid": charge.paid,
                        "amount_captured": charge.amount_captured,
                        "amount_refunded": charge.amount_refunded,
                        "three_d_secure": {
                            key: authentication.get(key)
                            for key in ("result", "version", "authentication_flow")
                        }
                        if authentication
                        else None,
                    }
                )
                if isinstance(transaction, stripe.BalanceTransaction):
                    item.update({"net": transaction.net, "fee": transaction.fee})
            events = await stripe.Event.list_async(
                created={"gte": intent.created},
                limit=100,
                stripe_account=account,
            )
            async for event in events.auto_paging_iter():
                if (
                    event.type
                    in (
                        "payment_intent.succeeded",
                        "payment_intent.payment_failed",
                        "payment_intent.canceled",
                    )
                    and event.data.object.id == intent.id
                ):
                    webhook_ids.append(event.id)
            provider.append(item)
        webhooks = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT id, event, status, processed_at IS NOT NULL AS processed "
                        "FROM webhooks WHERE id = ANY(CAST(:ids AS text[])) ORDER BY id"
                    ),
                    {"ids": webhook_ids},
                )
            ).mappings()
        ]
        return {
            "invoice": dict(invoice),
            "payments": payments,
            "entries": entries,
            "stripe": provider,
            "provider_intent_ids": sorted(provider_intent_ids),
            "webhooks": webhooks,
        }


async def browser_main(argv: list[str]) -> None:
    """Read committed DB and Stripe evidence without mutating provider or app state."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe browser")
    parser.add_argument("invoice_id", nargs="?")
    parser.add_argument("--receipts", action="store_true")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await invoice_evidence(args.invoice_id, args.receipts)))
    finally:
        await close_stripe_client()
        await engine.dispose()


class Target(BaseModel):
    invoice: str
    intent: str


class RelayFixture(BaseModel):
    invoice: str
    client: str
    customer: str


class RelayManifest(BaseModel):
    account: str
    business: str
    fixtures: list[RelayFixture]


class Intent(BaseModel):
    id: str
    customer: str
    amount: int
    currency: str
    metadata: dict[str, str]


class EventData(BaseModel):
    object: Intent


class Event(BaseModel):
    id: str
    type: str
    livemode: bool
    account: str
    data: EventData


def interrupt(connection: HTTPConnection) -> None:
    active_socket = connection.sock
    if active_socket is not None:
        with suppress(OSError):
            active_socket.shutdown(socket.SHUT_RDWR)
    connection.close()


class Relay:
    def __init__(
        self,
        manifest: Path,
        upstream: str,
        *,
        transport: Callable[[str, bytes, str], int] | None = None,
    ) -> None:
        self.manifest = manifest
        self.upstream = upstream
        self.transport = transport or self.forward
        self.token = secrets.token_urlsafe(32)
        self.secret = ""
        self.lock = threading.RLock()
        self.target: Target | None = None
        self.held: tuple[bytes, str, str, float] | None = None
        self.records: list[dict[str, object]] = []
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.stopping = threading.Event()
        self.workers: set[threading.Thread] = set()
        self.requests: set[socket.socket] = set()
        self.connections: set[HTTPConnection] = set()
        self.releasing = False

    def forward(self, url: str, body: bytes, signature: str) -> int:
        parsed = urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("relay requires a local HTTP upstream")
        connection = HTTPConnection(parsed.hostname, parsed.port, timeout=20)
        expired = threading.Event()

        def timeout() -> None:
            expired.set()
            interrupt(connection)

        with self.lock:
            if self.stopping.is_set():
                raise OSError("relay is stopping")
            self.connections.add(connection)
        timer = threading.Timer(20, timeout)
        timer.start()
        try:
            connection.request(
                "POST",
                parsed.path,
                body,
                {
                    "Content-Type": "application/json",
                    "Stripe-Signature": signature,
                },
            )
            if expired.is_set() or self.stopping.is_set():
                raise TimeoutError("relay transport deadline")
            return connection.getresponse().status
        finally:
            timer.cancel()
            timer.join(1)
            interrupt(connection)
            with self.lock:
                self.connections.discard(connection)

    def record(self, status: str, **fields: object) -> None:
        self.records.append({"status": status, **fields})
        path = self.manifest.parent / "stripe-relay.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.records, indent=2) + "\n")
        temporary.chmod(0o600)
        temporary.replace(path)

    def arm(self, target: Target) -> None:
        with self.lock:
            if self.stopping.is_set():
                raise OSError("relay is stopping")
            manifest = RelayManifest.model_validate_json(self.manifest.read_text())
            if self.target is not None or self.held is not None:
                raise ValueError("relay already armed")
            if (
                not target.intent.startswith("pi_")
                or sum(fixture.invoice == target.invoice for fixture in manifest.fixtures) != 1
            ):
                raise ValueError("target is not a registered fixture")
            self.target = target
            self.record("armed", invoice=target.invoice, intent=target.intent)

    def receive(self, body: bytes, signature: str) -> int:
        with self.lock:
            if self.stopping.is_set():
                raise OSError("relay is stopping")
            stripe.Webhook.construct_event(body, signature, self.secret)
            if self.target is not None:
                envelope = json.loads(body)
                if envelope.get("type") == "payment_intent.succeeded":
                    event = Event.model_validate(envelope)
                    intent = event.data.object
                    if intent.id == self.target.intent:
                        manifest = RelayManifest.model_validate_json(self.manifest.read_text())
                        fixture = next(
                            row for row in manifest.fixtures if row.invoice == self.target.invoice
                        )
                        if (
                            event.livemode
                            or event.account != manifest.account
                            or intent.customer != fixture.customer
                            or intent.amount != 2000
                            or intent.currency != "cad"
                            or intent.metadata.get("invoice_id") != fixture.invoice
                            or intent.metadata.get("business_id") != manifest.business
                        ):
                            self.record("ownership_rejected", event=event.id)
                            raise ValueError("held event ownership mismatch")
                        if self.held is not None and self.held[2] != event.id:
                            raise ValueError("multiple success events for held intent")
                        self.held = (body, signature, event.id, time.monotonic())
                        self.record("held", event=event.id, intent=intent.id)
                        return 202
        return self.transport(self.upstream, body, signature)

    def status(self) -> dict[str, object]:
        with self.lock:
            return {"held": self.held is not None, "records": list(self.records)}

    def release(self) -> int:
        with self.lock:
            if self.stopping.is_set() or self.releasing:
                raise ValueError("relay is stopping or already releasing")
            if self.held is None:
                raise ValueError("no genuine event is held")
            captured = self.held
            body, signature, event_id, started = captured
            if time.monotonic() - started >= 240:
                self.record("expired", event=event_id)
                raise ValueError("held signature exceeded safe release window")
            stripe.Webhook.construct_event(body, signature, self.secret, tolerance=240)
            self.releasing = True
        try:
            status = self.transport(self.upstream, body, signature)
            with self.lock:
                self.record("released", event=event_id, upstream_status=status)
                if status == 200 and self.held == captured:
                    self.held = None
                    self.target = None
            return status
        finally:
            with self.lock:
                self.releasing = False

    def recover(self, resend: Callable[[str], None]) -> None:
        with self.lock:
            if self.releasing:
                raise RuntimeError("release is still in flight; recovery cannot race it")
            if self.held is None:
                self.target = None
                return
            event_id = self.held[2]
            self.target = None
            self.held = None
            self.record("recovery_resend_requested", event=event_id)
        resend(event_id)
        with self.lock:
            self.record("recovery_resend_requested_from_stripe", event=event_id)

    def start(self) -> str:
        relay = self

        class Server(ThreadingHTTPServer):
            block_on_close = False

            def process_request(
                self,
                request: socket.socket | tuple[bytes, socket.socket],
                client_address: tuple[str, int],
            ) -> None:
                if not isinstance(request, socket.socket):
                    raise ValueError("HTTP relay requires a TCP socket")
                with relay.lock:
                    if relay.stopping.is_set() or len(relay.requests) >= 8:
                        self.shutdown_request(request)
                        return
                    request.settimeout(25)
                    relay.requests.add(request)
                    worker = threading.Thread(
                        target=self.process_request_thread,
                        args=(request, client_address),
                        daemon=False,
                    )
                    relay.workers.add(worker)
                    worker.start()

            def process_request_thread(
                self,
                request: socket.socket | tuple[bytes, socket.socket],
                client_address: tuple[str, int],
            ) -> None:
                if not isinstance(request, socket.socket):
                    raise ValueError("HTTP relay requires a TCP socket")
                try:
                    super().process_request_thread(request, client_address)
                finally:
                    with relay.lock:
                        relay.requests.discard(request)

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                pass

            def do_POST(self) -> None:
                try:
                    self.connection.settimeout(25)
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 1_000_000:
                        raise ValueError("invalid body size")
                    body = self.rfile.read(length)
                    if self.path == "/webhook":
                        status = relay.receive(body, self.headers.get("Stripe-Signature", ""))
                        result: dict[str, object] = {"status": status}
                    else:
                        if not secrets.compare_digest(
                            self.headers.get("Authorization", ""),
                            f"Bearer {relay.token}",
                        ):
                            self.send_error(403)
                            return
                        if self.path == "/arm":
                            relay.arm(Target.model_validate_json(body))
                        elif self.path == "/release":
                            result = {"upstream_status": relay.release()}
                            self.send_json(200, result)
                            return
                        elif self.path != "/status":
                            self.send_error(404)
                            return
                        status, result = 200, relay.status()
                    self.send_json(status, result)
                except (
                    ValueError,
                    KeyError,
                    StopIteration,
                    stripe.SignatureVerificationError,
                ):
                    self.send_json(400, {"error": "relay_rejected"})
                except OSError:
                    self.send_json(503, {"error": "upstream_unavailable"})

            def send_json(self, status: int, result: dict[str, object]) -> None:
                if relay.stopping.is_set():
                    return
                content = json.dumps(result).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        server = Server(("127.0.0.1", 0), Handler)
        self.server = server
        server.daemon_threads = False
        self.thread = threading.Thread(
            target=lambda: server.serve_forever(poll_interval=0.1), daemon=False
        )
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self, timeout: float = 30) -> None:
        deadline = time.monotonic() + timeout
        self.stopping.set()
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
        with self.lock:
            requests = list(self.requests)
            connections = list(self.connections)
            workers = list(self.workers)
        for request in requests:
            with suppress(OSError):
                request.shutdown(socket.SHUT_RDWR)
            request.close()
        for connection in connections:
            interrupt(connection)
        for worker in [*workers, *([self.thread] if self.thread is not None else [])]:
            worker.join(max(0, deadline - time.monotonic()))
        alive = sum(worker.is_alive() for worker in workers)
        serving = self.thread is not None and self.thread.is_alive()
        if alive or serving:
            with self.lock:
                self.record("shutdown_failed", active_workers=alive, serving=serving)
            raise RuntimeError("Stripe relay workers exceeded shutdown deadline")
        if self.held is not None:
            raise RuntimeError("Stripe relay stopped with an unrecovered held event")


def state_path() -> Path:
    requested = Path(os.environ["STRIPE_BROWSER_STATE_FILE"])
    path = requested.resolve()
    scratch = Path(__file__).resolve().parents[2] / ".scratchpad"
    if not path.is_relative_to(scratch) or requested.is_symlink():
        raise ValueError("fixture manifest must be a run-owned path under repo .scratchpad")
    return path


def identity(account: str) -> dict[str, object]:
    run = str(UUID(os.environ["STRIPE_BROWSER_RUN_ID"]))
    database = urlparse(get_settings().database_url)
    return {
        "run_id": run,
        "account": account,
        "platform": os.environ["STRIPE_TEST_PLATFORM"],
        "business": BUSINESS,
        "database": {
            "host": database.hostname,
            "port": database.port,
            "name": database.path,
        },
    }


def save(path: Path, state: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def tags(run: str, invoice: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_invoice": invoice,
        "clientbridge_qa_client": client,
    }


EVIDENCE: dict[Literal["lose", "escalate"], str] = {
    "lose": "losing_evidence",
    "escalate": "escalate_inquiry_evidence",
}


async def submit_evidence(
    account: str, dispute: stripe.Dispute, action: Literal["lose", "escalate"], run: str
) -> stripe.Dispute:
    """Stripe's sandbox evidence values decide a test dispute: lose it, or escalate an inquiry."""
    if dispute.livemode:
        raise ValueError("live dispute evidence is forbidden")
    ready = "warning_needs_response" if action == "escalate" else "needs_response"
    if dispute.status == ready:
        for attempt in range(10):
            try:
                dispute = await stripe.Dispute.modify_async(
                    dispute.id,
                    evidence={"uncategorized_text": EVIDENCE[action]},
                    submit=True,
                    stripe_account=account,
                    idempotency_key=f"browser:{run}:{dispute.id}:{action}",
                )
                break
            except stripe.RateLimitError:
                # Stripe locks a dispute while it processes it; the same key retries safely
                if attempt == 9:
                    raise
                await asyncio.sleep(3)
    elif action == "escalate" or dispute.status not in ("under_review", "won", "lost"):
        raise ValueError(f"cannot {action} a dispute that is {dispute.status}")
    deadline = time.monotonic() + 120
    while (
        dispute.status.startswith("warning_")
        if action == "escalate"
        else dispute.status not in ("won", "lost")
    ):
        if time.monotonic() > deadline:
            raise TimeoutError("the sandbox dispute did not settle")
        await asyncio.sleep(2)
        with suppress(stripe.RateLimitError):
            dispute = await stripe.Dispute.retrieve_async(dispute.id, stripe_account=account)
    return dispute


async def settle_disputes(
    account: str, charge_id: str, metadata: dict[str, str], *, apply: bool
) -> int | None:
    """What lost disputes took from an owned charge, losing any still open; None if only planned."""
    listed = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
    disputes = [dispute async for dispute in listed.auto_paging_iter()]
    if any(dispute.livemode or dispute.charge != charge_id for dispute in disputes):
        raise ValueError("dispute does not belong to the owned charge")
    open_disputes = [d for d in disputes if d.status in ("needs_response", "under_review")]
    if open_disputes and not apply:
        return None
    for dispute in open_disputes:
        disputes.remove(dispute)
        disputes.append(
            await submit_evidence(account, dispute, "lose", metadata["clientbridge_qa_run"])
        )
    return sum(dispute.amount for dispute in disputes if dispute.status == "lost")


async def cleanup_intent(
    account: str,
    intent: stripe.PaymentIntent,
    metadata: dict[str, str],
    *,
    apply: bool = True,
) -> dict[str, object]:
    if intent.livemode:
        raise ValueError("live provider cleanup is forbidden")
    if intent.status == "succeeded":
        if not isinstance(intent.latest_charge, str):
            raise ValueError("successful intent has no charge")
        charge = await stripe.Charge.retrieve_async(intent.latest_charge, stripe_account=account)
        if charge.livemode or charge.payment_intent != intent.id or charge.amount != intent.amount:
            raise ValueError("charge does not match the owned intent")
        lost = 0
        if charge.to_dict().get("disputed"):
            lost = await settle_disputes(account, charge.id, metadata, apply=apply)
            if lost is None:
                return {"intent": intent.id, "status": "planned_dispute_loss"}
        refunds = await stripe.Refund.list_async(charge=charge.id, stripe_account=account)
        refunded = 0
        async for refund in refunds.auto_paging_iter():
            if refund.status == "succeeded":
                refunded += refund.amount
            elif refund.status not in ("failed", "canceled"):
                raise ValueError("owned charge has an unsettled refund; retry after settlement")
        remaining = charge.amount - charge.amount_refunded - lost
        if lost and remaining <= 0:
            if refunded != charge.amount_refunded:
                raise ValueError("charge and settled refunds disagree")
            return {"intent": intent.id, "status": "dispute_lost"}
        if remaining == 0:
            if refunded != charge.amount:
                raise ValueError("fully refunded charge lacks settled refund evidence")
            return {"intent": intent.id, "status": "already_refunded"}
        if remaining < 0 or refunded != charge.amount_refunded:
            raise ValueError("charge and settled refunds disagree")
        if not apply:
            return {
                "intent": intent.id,
                "status": "planned_refund",
                "amount_cents": remaining,
            }
        refund = await stripe.Refund.create_async(
            payment_intent=intent.id,
            amount=remaining,
            refund_application_fee=True,
            metadata=metadata,
            stripe_account=account,
            idempotency_key=f"browser:{metadata['clientbridge_qa_run']}:{intent.id}:cleanup:{remaining}",
        )
        if refund.status != "succeeded":
            raise ValueError("owned refund is not settled; cleanup needs retry")
        return {"intent": intent.id, "refund": refund.id, "status": refund.status}
    if intent.status == "canceled":
        return {"intent": intent.id, "status": "already_canceled"}
    if intent.status in (
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "requires_capture",
    ):
        if not apply:
            return {"intent": intent.id, "status": "planned_cancel"}
        canceled = await stripe.PaymentIntent.cancel_async(intent.id, stripe_account=account)
        if canceled.status != "canceled":
            raise ValueError("owned intent cancellation did not complete")
        return {"intent": intent.id, "status": canceled.status}
    raise ValueError("owned intent is processing; defer cleanup rather than guessing")


def validate_cleanup_fixtures(fixtures: list[dict[str, str]]) -> None:
    for field in ("invoice", "client", "customer"):
        values = [fixture.get(field) for fixture in fixtures]
        if any(not value for value in values) or len(values) != len(set(values)):
            raise ValueError("incomplete or duplicate fixture lineage; cannot prove cleanup")


async def validate_context() -> str:
    account = guard()
    lease = Path(__file__).resolve().parents[2] / ".scratchpad/stripe-qa.lock"
    with lease.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass  # The parent runner must hold this lease until cleanup finishes.
        else:
            fcntl.flock(lock, fcntl.LOCK_UN)
            raise ValueError("runner must hold the shared Stripe QA merchant lease")
    await preflight(dict(os.environ))
    environment = os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local")
    if environment not in ("local", "ci"):
        raise ValueError("browser fixtures require a dedicated local or CI merchant environment")
    for merchant_id, slot in (
        (account, "a"),
        (os.environ["STRIPE_TEST_OTHER_ACCOUNT"], "b"),
    ):
        merchant = await stripe.Account.retrieve_async(merchant_id)
        metadata = merchant.to_dict().get("metadata", {})
        if (
            metadata.get("clientbridge_qa_environment") != environment
            or metadata.get("clientbridge_qa_slot") != slot
        ):
            raise ValueError("browser fixture merchant environment/slot ownership mismatch")
    return account


async def setup_action(action: str, invoice_id: str | None) -> dict[str, object]:
    account = await validate_context()
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    path = state_path()
    expected = identity(account)
    state: dict[str, object]
    if path.exists():
        state = json.loads(path.read_text())
        if any(state.get(key) != value for key, value in expected.items()):
            raise ValueError("fixture manifest belongs to another run/database/merchant")
    elif action == "prepare":
        path.parent.mkdir(parents=True, exist_ok=True)
        state = {**expected, "fixtures": []}
        with path.open("x") as file:
            file.write(json.dumps(state))
        path.chmod(0o600)
    else:
        raise ValueError("prepare must create the ownership manifest first")
    fixtures = state.get("fixtures")
    if not isinstance(fixtures, list):
        raise ValueError("invalid ownership manifest")
    run = str(state["run_id"])
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None:
            raise ValueError("isolated seed business is missing")
        if action == "prepare":
            if fixtures or state.get("deposit_fixtures"):
                raise ValueError("cannot rebind a business after registering fixtures")
            status = await gateway.get_account(account)
            if not status.charges_enabled or not status.payouts_enabled:
                raise ValueError("v2 merchant is not ready")
            business.stripe_account_id = account
            apply_account_status(business, status)
            db.add(await reconciled_at_prepare(account))
            await db.commit()
            return {"prepared": True, **expected}
        if business.stripe_account_id != account:
            raise ValueError("isolated business merchant binding changed")
        if action == "register":
            invoice = await db.get(Invoice, invoice_id)
            if invoice is None or invoice.business_id != BUSINESS:
                raise ValueError("invoice does not belong to the isolated fixture business")
            client = await db.get(Client, invoice.client_id)
            if client is None or client.business_id != BUSINESS:
                raise ValueError("invoice customer ownership mismatch")
            owned_tags = tags(run, invoice.id, client.id)
            fixture = next((f for f in fixtures if f.get("invoice") == invoice.id), None)
            if fixture is None:
                if client.stripe_customer_id is not None:
                    raise ValueError("refusing to adopt a pre-existing provider customer")
                fixture = {"invoice": invoice.id, "client": client.id}
                fixtures.append(fixture)
                save(
                    path, state
                )  # Record lineage before any provider write, including crash recovery.
            if fixture["client"] != client.id:
                raise ValueError("registered invoice customer changed")
            customer = await stripe.Customer.create_async(
                name=client.name,
                email=client.email or "",
                metadata=owned_tags,
                stripe_account=account,
                idempotency_key=f"browser:{run}:{invoice.id}:customer",
            )
            if customer.livemode or customer.to_dict().get("metadata") != owned_tags:
                raise ValueError("provider customer ownership mismatch")
            if client.stripe_customer_id not in (None, customer.id):
                raise ValueError("refusing to replace another provider customer")
            fixture["customer"] = customer.id
            save(path, state)
            client.stripe_customer_id = customer.id
            await db.commit()
            return {"registered": True, "invoice": invoice.id, "customer": customer.id}

        validate_cleanup_fixtures(fixtures)
        deposits = deposit_fixtures(state, complete=True)
        invoice_customers = {fixture["customer"] for fixture in fixtures}
        deposit_customers = {fixture.customer for fixture in deposits}
        if invoice_customers & deposit_customers:
            raise ValueError("invoice and deposit fixtures cannot share customers")
        purchasers = client_fixtures(state, complete=True)
        client_customers = {fixture.customer for fixture in purchasers}
        if client_customers & (invoice_customers | deposit_customers):
            raise ValueError("client fixtures cannot share customers with other fixtures")
        for purchaser in purchasers:
            client = await db.get(Client, purchaser.client)
            if (
                client is None
                or client.business_id != BUSINESS
                or client.stripe_customer_id not in (None, purchaser.customer)
            ):
                raise ValueError("client fixture DB ownership changed; refusing provider cleanup")
            await clean_client(account, run, purchaser, apply=False)
        actions = await cleanup_deposits(db, state, account)
        for purchaser in purchasers:
            actions.extend(await clean_client(account, run, purchaser, apply=True))
        seen_customers: set[str] = set()
        customers = await stripe.Customer.list_async(limit=100, stripe_account=account)
        async for customer in customers.auto_paging_iter():
            customer_tags = customer.to_dict().get("metadata", {})
            if customer_tags.get("clientbridge_qa_run") != run:
                continue
            if customer.id in deposit_customers or customer.id in client_customers:
                continue
            fixture = next(
                (
                    f
                    for f in fixtures
                    if f.get("invoice") == customer_tags.get("clientbridge_qa_invoice")
                ),
                None,
            )
            if fixture is None or customer_tags != tags(run, fixture["invoice"], fixture["client"]):
                raise ValueError("run-tagged customer lacks exact registered fixture lineage")
            if customer.livemode or fixture.get("customer", customer.id) != customer.id:
                raise ValueError("registered customer identity mismatch")
            seen_customers.add(customer.id)
            invoice = await db.get(Invoice, fixture["invoice"])
            client = await db.get(Client, fixture["client"])
            if (
                invoice is None
                or client is None
                or invoice.business_id != BUSINESS
                or invoice.client_id != client.id
                or client.stripe_customer_id not in (None, customer.id)
            ):
                raise ValueError("fixture DB ownership changed; refusing provider cleanup")
            intents = await stripe.PaymentIntent.list_async(
                customer=customer.id, stripe_account=account
            )
            async for intent in intents.auto_paging_iter():
                intent_tags = intent.to_dict().get("metadata", {})
                if (
                    intent.livemode
                    or intent.customer != customer.id
                    or intent_tags.get("invoice_id") != invoice.id
                    or intent_tags.get("business_id") != BUSINESS
                    or intent.amount != 2000
                    or intent.currency != "cad"
                ):
                    raise ValueError("customer has an intent outside this exact invoice fixture")
                local = await db.scalar(select(Payment).where(Payment.provider_ref == intent.id))
                if local is not None and (
                    local.invoice_id != invoice.id or local.business_id != BUSINESS
                ):
                    raise ValueError("provider intent maps to another local payment")
                actions.append(
                    await cleanup_intent(account, intent, tags(run, invoice.id, client.id))
                )
        expected_customers = {f["customer"] for f in fixtures if "customer" in f}
        if not expected_customers.issubset(seen_customers):
            raise ValueError("registered provider customer is missing; cannot prove cleanup")
        state["cleanup"] = actions
        save(path, state)
        # Retain tagged customers for diagnostics. Never delete application or unrelated data.
        return {"cleaned": True, "actions": actions, "retained_tagged_customers": True}


async def setup_main(argv: list[str]) -> None:
    """Manage run-owned sandbox fixtures under the runner-held merchant lease."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe setup")
    parser.add_argument("action", choices=("prepare", "register", "cleanup"))
    parser.add_argument("invoice_id", nargs="?")
    args = parser.parse_args(argv)
    if args.action == "register" and args.invoice_id is None:
        parser.error("register requires invoice_id")
    try:
        print(json.dumps(await setup_action(args.action, args.invoice_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()


class DepositFixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # an enrolment's client books on Connect, which opens the deposit, so the client registers first
    kind: Literal["booking", "enrolment"] = "booking"
    booking: str | None = None
    client: str
    customer: str | None = None
    amount_cents: Literal[2000] = 2000
    currency: Literal["CAD"] = "CAD"
    invoice: str | None = None


def deposit_fixtures(state: dict[str, object], *, complete: bool = False) -> list[DepositFixture]:
    fixtures = TypeAdapter(list[DepositFixture]).validate_python(state.get("deposit_fixtures", []))
    if any(f.kind == "booking" and not f.booking for f in fixtures):
        raise ValueError("a visit deposit fixture names its booking")
    for field in ("booking", "client", "customer"):
        values = [getattr(fixture, field) for fixture in fixtures]
        present = [value for value in values if value]
        # an enrolment may still be unbound when cleanup runs; its customer then has no intent
        expected = (
            [v for f, v in zip(fixtures, values, strict=True) if f.kind == "booking" or v]
            if field == "booking"
            else values
        )
        if len(present) != len(set(present)) or (complete and len(present) != len(expected)):
            raise ValueError("incomplete or duplicate deposit lineage; cannot prove cleanup")
    return fixtures


def load_deposit(state: dict[str, object], booking_id: str) -> DepositFixture:
    matches = [fixture for fixture in deposit_fixtures(state) if fixture.booking == booking_id]
    if len(matches) != 1:
        raise ValueError("booking is not a unique registered deposit fixture")
    return matches[0]


def deposit_tags(run: str, booking: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_booking": booking,
        "clientbridge_qa_client": client,
    }


def enrolment_tags(run: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_enrolment": client,
        "clientbridge_qa_client": client,
    }


def fixture_tags(run: str, fixture: DepositFixture) -> dict[str, str]:
    """The tags the fixture's customer carries, fixed when it is created."""
    if fixture.kind == "enrolment":
        return enrolment_tags(run, fixture.client)
    if fixture.booking is None:
        raise ValueError("a visit deposit fixture names its booking")
    return deposit_tags(run, fixture.booking, fixture.client)


def validate_deposit_intent(intent: stripe.PaymentIntent, fixture: DepositFixture) -> None:
    metadata = intent.to_dict().get("metadata", {})
    if (
        intent.livemode
        or intent.customer != fixture.customer
        or intent.amount != 2000
        or intent.currency != "cad"
        or metadata.get("booking_id") != fixture.booking
        or metadata.get("business_id") != BUSINESS
        or metadata.get("invoice_id")
    ):
        raise ValueError("deposit customer has unrelated provider intent")


async def validate_booking(db: AsyncSession, fixture: DepositFixture) -> tuple[Booking, Client]:
    if fixture.booking is None:
        raise ValueError("the deposit fixture is not bound to a booking yet")
    booking = await db.get(Booking, fixture.booking)
    client = await db.get(Client, fixture.client)
    if (
        booking is None
        or client is None
        or booking.business_id != BUSINESS
        or client.business_id != BUSINESS
        or booking.client_id != client.id
        or booking.deposit_amount_cents != fixture.amount_cents
        or booking.deleted_at is not None
        or client.deleted_at is not None
    ):
        raise ValueError("deposit booking/client/amount ownership mismatch")
    if fixture.invoice:
        invoice = await db.get(Invoice, fixture.invoice)
        linked = await db.scalar(
            select(Line.id).where(
                Line.invoice_id == fixture.invoice,
                Line.booking_id == fixture.booking,
                Line.business_id == BUSINESS,
            )
        )
        if (
            invoice is None
            or invoice.business_id != BUSINESS
            or invoice.client_id != client.id
            or not linked
        ):
            raise ValueError("deposit invoice is not linked to the exact booking/client")
    return booking, client


async def create_deposit_customer(
    path: Path,
    state: dict[str, object],
    fixture: DepositFixture,
    account: str,
    name: str,
    email: str,
) -> stripe.Customer:
    registered = [f for f in deposit_fixtures(state) if f.client == fixture.client]
    if registered != [fixture] or state.get("account") != account:
        raise ValueError("customer write lacks exact registered deposit lineage")
    save(path, state)
    expected = fixture_tags(str(state["run_id"]), fixture)
    owner = fixture.booking if fixture.kind == "booking" else f"enrolment:{fixture.client}"
    customer = await stripe.Customer.create_async(
        name=name,
        email=email,
        metadata=expected,
        stripe_account=account,
        idempotency_key=f"browser:{state['run_id']}:deposit:{owner}:customer",
    )
    if (
        customer.livemode
        or customer.to_dict().get("metadata") != expected
        or fixture.customer not in (None, customer.id)
    ):
        raise ValueError("deposit customer ownership mismatch")
    return customer


async def register_client(
    db: AsyncSession, path: Path, state: dict[str, object], account: str, client_id: str
) -> DepositFixture:
    """File a client who has never booked as an enrolment fixture, before it books on Connect."""
    fixtures = deposit_fixtures(state)
    client = await db.get(Client, client_id)
    if client is None or client.business_id != BUSINESS or client.deleted_at is not None:
        raise ValueError("client does not belong to the fixture business")
    if client.stripe_customer_id is not None:
        raise ValueError("refusing to adopt pre-existing customer")
    booked = await db.scalar(select(Booking.id).where(Booking.client_id == client_id).limit(1))
    paid = await db.scalar(select(Payment.id).where(Payment.client_id == client_id).limit(1))
    if booked is not None or paid is not None:
        raise ValueError("register an enrolment's client before it books or pays")
    if any(item.client == client_id for item in fixtures) or any(
        item.get("client") == client_id for item in cast(list[dict[str, str]], state["fixtures"])
    ):
        raise ValueError("deposit client already belongs to another fixture")
    fixture = DepositFixture(kind="enrolment", client=client_id)
    fixtures.append(fixture)
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    customer = await create_deposit_customer(
        path, state, fixture, account, client.name, client.email or ""
    )
    fixture.customer = customer.id
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    save(path, state)
    client.stripe_customer_id = customer.id
    await db.commit()
    return fixture


async def bind_enrolment(
    db: AsyncSession, path: Path, state: dict[str, object], client_id: str, booking_id: str
) -> DepositFixture:
    """Name the enrolment's first day, the booking that carries its deposit."""
    fixtures = deposit_fixtures(state)
    matches = [f for f in fixtures if f.kind == "enrolment" and f.client == client_id]
    if len(matches) != 1 or matches[0].booking not in (None, booking_id):
        raise ValueError("client is not one unbound enrolment fixture")
    fixture = matches[0]
    fixture.booking = booking_id
    booking, _ = await validate_booking(db, fixture)
    if booking.deposit_status not in ("pending", "collected", "applied"):
        raise ValueError("the enrolment's first day carries no deposit")
    state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
    deposit_fixtures(state)
    save(path, state)
    return fixture


async def deposit_action(action: str, booking_id: str, invoice_id: str | None) -> dict[str, object]:
    account = await validate_context()
    path = state_path()
    state = json.loads(path.read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("deposit manifest identity mismatch")
    fixtures = deposit_fixtures(state)
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if (
            business is None
            or business.stripe_account_id != account
            or not business.stripe_charges_enabled
        ):
            raise ValueError("isolated business is not bound to ready QA account")
        if action == "register-client":
            fixture = await register_client(db, path, state, account, booking_id)
        elif action == "bind":
            if invoice_id is None:
                raise ValueError("bind needs the client and its first booking")
            fixture = await bind_enrolment(db, path, state, booking_id, invoice_id)
        elif action == "register":
            booking = await db.get(Booking, booking_id)
            if booking is None or booking.business_id != BUSINESS:
                raise ValueError("booking does not belong to fixture business")
            fixture = next((item for item in fixtures if item.booking == booking_id), None)
            if fixture is None:
                fixture = DepositFixture(booking=booking_id, client=booking.client_id)
                _, client = await validate_booking(db, fixture)
                if client.stripe_customer_id is not None:
                    raise ValueError("refusing to adopt pre-existing customer")
                prior = await db.scalar(select(Payment.id).where(Payment.booking_id == booking_id))
                if prior is not None or booking.deposit_status != "pending":
                    raise ValueError("register deposit before any collection attempt")
                if any(item.client == fixture.client for item in fixtures) or any(
                    item.get("client") == fixture.client for item in state.get("fixtures", [])
                ):
                    raise ValueError("deposit client already belongs to another fixture")
                fixtures.append(fixture)
                state["deposit_fixtures"] = [
                    item.model_dump(exclude_none=True) for item in fixtures
                ]
                deposit_fixtures(state)
            _, client = await validate_booking(db, fixture)
            if client.stripe_customer_id not in (None, fixture.customer):
                raise ValueError("registered deposit client customer changed")
            customer = await create_deposit_customer(
                path, state, fixture, account, client.name, client.email or ""
            )
            if client.stripe_customer_id not in (None, customer.id):
                raise ValueError("deposit DB customer ownership mismatch")
            fixture.customer = customer.id
            state["deposit_fixtures"] = [item.model_dump(exclude_none=True) for item in fixtures]
            save(path, state)
            client.stripe_customer_id = customer.id
            await db.commit()
        else:
            fixture = load_deposit(state, booking_id)
            if not fixture.customer or not invoice_id or fixture.invoice not in (None, invoice_id):
                raise ValueError("deposit invoice linkage incomplete or changed")
            fixture.invoice = invoice_id
            await validate_booking(db, fixture)
            state["deposit_fixtures"] = [
                fixture.model_dump(exclude_none=True)
                if item.booking == booking_id
                else item.model_dump(exclude_none=True)
                for item in fixtures
            ]
            save(path, state)
        return {
            "kind": "booking_deposit" if fixture.kind == "booking" else "enrolment_deposit",
            "bookingId": fixture.booking,
            "clientId": fixture.client,
            "account": account,
            "amountCents": fixture.amount_cents,
            "currency": fixture.currency,
        }


async def cleanup_deposits(
    db: AsyncSession, state: dict[str, object], account: str
) -> list[dict[str, object]]:
    fixtures = deposit_fixtures(state, complete=True)
    owned: list[tuple[stripe.PaymentIntent, dict[str, str]]] = []
    for fixture in fixtures:
        if fixture.customer is None:
            raise ValueError("deposit customer missing")
        expected = fixture_tags(str(state["run_id"]), fixture)
        if fixture.booking is None:
            intents = await stripe.PaymentIntent.list_async(
                customer=fixture.customer, stripe_account=account, limit=1
            )
            if intents.data:
                raise ValueError("an unbound enrolment's customer has an intent; bind it first")
            continue
        _, client = await validate_booking(db, fixture)
        if client.stripe_customer_id not in (None, fixture.customer):
            raise ValueError("deposit DB customer changed")
        customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
        if (
            customer.livemode
            or customer.id != fixture.customer
            or customer.to_dict().get("metadata") != expected
        ):
            raise ValueError("deposit customer tags changed")
        intents = await stripe.PaymentIntent.list_async(
            customer=customer.id, stripe_account=account
        )
        async for intent in intents.auto_paging_iter():
            validate_deposit_intent(intent, fixture)
            payment = await db.scalar(select(Payment).where(Payment.provider_ref == intent.id))
            if payment is not None and (
                payment.business_id != BUSINESS
                or payment.booking_id != fixture.booking
                or payment.kind != "deposit"
                or payment.invoice_id is not None
            ):
                raise ValueError("deposit provider intent maps to unrelated local payment")
            owned.append((intent, expected))
    for intent, metadata in owned:
        await cleanup_intent(account, intent, metadata, apply=False)
    return [await cleanup_intent(account, intent, metadata) for intent, metadata in owned]


async def deposits_main(argv: list[str]) -> None:
    """Register deposit fixtures, a booking or an enrolment's client, before any intent."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe deposits")
    parser.add_argument("action", choices=("register", "link", "register-client", "bind"))
    parser.add_argument("booking_id", help="the booking, or the client for register-client/bind")
    parser.add_argument("invoice_id", nargs="?", help="the invoice, or the booking for bind")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await deposit_action(args.action, args.booking_id, args.invoice_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()


def delivery_tags(state: dict[str, object], intent: dict[str, object]) -> dict[str, str]:
    metadata = intent.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("event lacks owned fixture metadata")
    if isinstance(booking_id := metadata.get("booking_id"), str):
        deposit = load_deposit(state, booking_id)
        if metadata.get("invoice_id") or not deposit.customer:
            raise ValueError("ambiguous deposit event lineage")
        customer = deposit.customer
        expected = fixture_tags(str(state["run_id"]), deposit)
    else:
        rows = state.get("fixtures")
        if not isinstance(rows, list):
            raise ValueError("invalid invoice fixture manifest")
        fixture = next((row for row in rows if row["invoice"] == metadata.get("invoice_id")), None)
        if fixture is None:
            raise ValueError("event does not belong to a registered invoice")
        customer = fixture.get("customer")
        expected = tags(str(state["run_id"]), fixture["invoice"], fixture["client"])
    if (
        not isinstance(customer, str)
        or metadata.get("business_id") != state["business"]
        or intent.get("customer") != customer
        or intent.get("amount") != 2000
        or intent.get("currency") != "cad"
    ):
        raise ValueError("event does not belong to the exact registered fixture")
    return expected


async def event_customer(account: str, owned: dict[str, object]) -> str:
    """The customer behind an event's object; only customer-owned objects can be redelivered."""
    kind = owned.get("object")
    if kind in ("payment_intent", "charge", "invoice", "subscription", "setup_intent"):
        customer = owned.get("customer")
    elif kind in ("refund", "dispute") and isinstance(intent := owned.get("payment_intent"), str):
        customer = (
            await stripe.PaymentIntent.retrieve_async(intent, stripe_account=account)
        ).customer
    else:
        raise ValueError("only events about a registered customer's objects can be redelivered")
    if not isinstance(customer, str):
        raise ValueError("event object has no customer")
    return customer


def registered_tags(state: dict[str, object], customer: str) -> dict[str, str]:
    run = str(state["run_id"])
    for row in cast(list[dict[str, str]], state.get("fixtures", [])):
        if row.get("customer") == customer:
            return tags(run, row["invoice"], row["client"])
    for deposit in deposit_fixtures(state):
        if deposit.customer == customer:
            return fixture_tags(run, deposit)
    for purchaser in client_fixtures(state):
        if purchaser.customer == customer:
            return client_tags(run, purchaser.client)
    raise ValueError("the customer is not a registered fixture of this run")


async def resend(event_id: str) -> None:
    account = guard()
    state = json.loads(state_path().read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("delivery manifest belongs to another run")
    event = await stripe.Event.retrieve_async(event_id, stripe_account=account)
    payload = event.to_dict()
    if event.livemode or event.type not in PAYMENT_EVENTS:
        raise ValueError("only a genuine sandbox payment event can be redelivered")
    owned = payload["data"]["object"]
    customer_id = await event_customer(account, owned)
    expected = registered_tags(state, customer_id)
    purchasers = {fixture.customer for fixture in client_fixtures(state)}
    if (
        owned.get("object") == "payment_intent"
        and customer_id not in purchasers
        and delivery_tags(state, owned) != expected
    ):
        raise ValueError("event does not belong to the exact registered fixture")
    customer = await stripe.Customer.retrieve_async(customer_id, stripe_account=account)
    if customer.livemode or customer.to_dict().get("metadata") != expected:
        raise ValueError("event customer does not carry exact run ownership")
    # Stripe defaults to the local CLI endpoint when no registered endpoint is specified.
    subprocess.run(
        ["stripe", "events", "resend", event_id, "--account", account, "--confirm"],
        env={**os.environ, "STRIPE_API_KEY": os.environ["STRIPE_TEST_SECRET_KEY"]},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=True,
    )


async def delivery_main(argv: list[str]) -> None:
    """Ask Stripe to resend only a genuine succeeded event of this browser fixture."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe delivery")
    parser.add_argument("event_id")
    args = parser.parse_args(argv)
    try:
        await resend(args.event_id)
    finally:
        await close_stripe_client()


async def raw_evidence(
    business: str, client: str, booking: str, invoice: str | None
) -> dict[str, object]:
    params = {"business": business, "client": client, "booking": booking, "invoice": invoice}
    owned_payments = "SELECT id FROM payments WHERE business_id=:business "
    owned_payments += "AND (client_id=:client OR booking_id=:booking OR invoice_id=:invoice)"
    journals = "SELECT DISTINCT journal_id FROM entries WHERE business_id=:business AND ("
    journals += "(subject_type='booking' AND subject_id IN "
    journals += "(SELECT id FROM bookings WHERE business_id=:business AND client_id=:client)) OR "
    journals += "(subject_type='invoice' AND subject_id IN "
    journals += "(SELECT id FROM invoices WHERE business_id=:business AND client_id=:client)) OR "
    journals += "(owner_type='client' AND owner_id=:client) OR "
    journals += f"(source_type='payment' AND source_id IN ({owned_payments})))"
    queries = {
        "documents": "SELECT id FROM invoices WHERE business_id=:business "
        "AND client_id=:client ORDER BY id",
        "owned_bookings": "SELECT id FROM bookings WHERE business_id=:business "
        "AND client_id=:client ORDER BY id",
        "booking": "SELECT id, business_id, client_id, invoice_id, deposit_amount_cents, "
        "deposit_status FROM bookings WHERE id=:booking",
        "invoice": "SELECT id, business_id, client_id, number, status, subtotal_cents, "
        "tax_total_cents, total_cents, currency FROM invoices WHERE id=:invoice",
        "lines": "SELECT id, item_id, booking_id, quantity, unit_amount_cents, tax_amount_cents, "
        "tax_class FROM lines WHERE invoice_id=:invoice ORDER BY id",
        "payments": "SELECT id, business_id, client_id, kind, status, method, provider, "
        "invoice_id, booking_id, parent_payment_id, amount_cents, tip_cents, currency, "
        f"provider_ref, credit_note FROM payments WHERE id IN ({owned_payments}) ORDER BY id",
        "entries": "SELECT e.id, e.business_id, e.journal_id, e.ref, e.leg, e.event, "
        "e.source_type, e.source_id, e.subject_type, e.subject_id, e.amount_cents, e.currency, "
        "e.owner_type AS entry_owner_type, e.owner_id AS entry_owner_id, e.account_id, "
        "a.business_id AS account_business_id, a.owner_type, a.owner_id, a.category, a.code "
        "FROM entries e JOIN accounts a ON a.id=e.account_id "
        f"WHERE e.journal_id IN ({journals}) ORDER BY e.ref, e.leg",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {"businessId": business}
        for key, query in queries.items():
            rows = [dict(row) for row in (await db.execute(text(query), params)).mappings()]
            if key in ("booking", "invoice"):
                if key == "invoice" and invoice is None:
                    result[key] = None
                    continue
                if (
                    len(rows) != 1
                    or rows[0]["business_id"] != business
                    or rows[0]["client_id"] != client
                ):
                    raise RuntimeError("owned booking/invoice lineage mismatch")
                result[key] = rows[0]
            else:
                result[key] = rows
        return result


async def provider_evidence(account: str, fixture: DepositFixture, run: str) -> dict[str, object]:
    if fixture.customer is None:
        raise ValueError("deposit customer must be registered before observation")
    customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
    if customer.livemode or customer.to_dict().get("metadata") != fixture_tags(run, fixture):
        raise ValueError("deposit customer ownership mismatch")
    intents: list[dict[str, object]] = []
    refunds: list[dict[str, object]] = []
    fees: dict[str, object] | None = None
    remote = await stripe.PaymentIntent.list_async(
        customer=fixture.customer, stripe_account=account
    )
    async for intent in remote.auto_paging_iter():
        metadata = intent.to_dict().get("metadata", {})
        if (
            intent.livemode
            or intent.customer != fixture.customer
            or metadata.get("business_id") != BUSINESS
            or metadata.get("booking_id") != fixture.booking
            or intent.amount != 2000
            or intent.currency != "cad"
        ):
            raise ValueError("deposit customer has an intent outside this owned booking")
        intents.append(
            {
                "id": intent.id,
                "status": intent.status,
                "amount": intent.amount,
                "currency": intent.currency,
                "livemode": intent.livemode,
                "metadata": metadata,
            }
        )
        if isinstance(intent.latest_charge, str):
            charge = await stripe.Charge.retrieve_async(
                intent.latest_charge, expand=["balance_transaction"], stripe_account=account
            )
            if charge.livemode or charge.payment_intent != intent.id or charge.amount != 2000:
                raise ValueError("deposit charge ownership mismatch")
            transaction = charge.balance_transaction
            if isinstance(transaction, str):
                transaction = await stripe.BalanceTransaction.retrieve_async(
                    transaction, stripe_account=account
                )
            if charge.paid and isinstance(transaction, stripe.BalanceTransaction):
                if fees is not None:
                    raise ValueError("more than one charged intent for the owned deposit")
                processing = sum(
                    d.amount for d in transaction.fee_details if d.type != "application_fee"
                )
                application = sum(
                    d.amount for d in transaction.fee_details if d.type == "application_fee"
                )
                if (
                    transaction.amount != 2000
                    or transaction.currency != "cad"
                    or transaction.fee != processing + application
                    or transaction.net != 2000 - processing - application
                    or (intent.application_fee_amount or 0) != application
                ):
                    raise ValueError("provider gross, fees and net do not reconcile")
                fees = {
                    "processingCents": processing,
                    "applicationCents": application,
                    "grossCents": transaction.amount,
                    "feeCents": transaction.fee,
                    "netCents": transaction.net,
                    "balanceTransactionId": transaction.id,
                    "chargeId": charge.id,
                }
        listed = await stripe.Refund.list_async(payment_intent=intent.id, stripe_account=account)
        async for refund in listed.auto_paging_iter():
            if refund.payment_intent != intent.id or refund.currency != "cad":
                raise ValueError("refund ownership mismatch")
            refunds.append(
                {
                    "id": refund.id,
                    "payment_intent": intent.id,
                    "status": refund.status,
                    "amount": refund.amount,
                    "currency": refund.currency,
                }
            )
    return {"intents": intents, "refunds": refunds, "fees": fees}


async def deposit_evidence(booking_id: str) -> dict[str, object]:
    account = guard()
    state = json.loads(state_path().read_text())
    expected = identity(account)
    if any(state.get(key) != value for key, value in expected.items()):
        raise ValueError("fixture manifest identity mismatch")
    fixture = load_deposit(state, booking_id)
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        ready = await db.scalar(
            text(
                "SELECT COUNT(*) FROM businesses b JOIN clients c ON c.business_id=b.id "
                "WHERE b.id=:business AND b.stripe_account_id=:account "
                "AND b.stripe_charges_enabled AND b.stripe_payouts_enabled "
                "AND c.id=:client AND c.stripe_customer_id=:customer"
            ),
            {
                "business": BUSINESS,
                "account": account,
                "client": fixture.client,
                "customer": fixture.customer,
            },
        )
        if ready != 1:
            raise ValueError("registered provider customer and local business do not match")
    result = await raw_evidence(BUSINESS, fixture.client, booking_id, fixture.invoice)
    result["provider"] = await provider_evidence(account, fixture, str(expected["run_id"]))
    return result


async def deposits_evidence_main(argv: list[str]) -> None:
    """Observe both subjects and every payment-source journal of one deposit journey."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe deposits-evidence")
    parser.add_argument("booking_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await deposit_evidence(args.booking_id), default=str))
    finally:
        await close_stripe_client()
        await engine.dispose()


class ClientFixture(BaseModel):
    """A client whose purchases have no invoice or booking: gift cards and memberships."""

    model_config = ConfigDict(extra="forbid")
    client: str
    customer: str | None = None
    clock: str | None = None


def client_fixtures(state: dict[str, object], *, complete: bool = False) -> list[ClientFixture]:
    fixtures = TypeAdapter(list[ClientFixture]).validate_python(state.get("client_fixtures", []))
    for field in ("client", "customer", "clock"):
        values = [value for f in fixtures if (value := getattr(f, field)) is not None]
        if len(values) != len(set(values)):
            raise ValueError("duplicate client fixture lineage; cannot prove cleanup")
    if complete and any(f.customer is None for f in fixtures):
        raise ValueError("incomplete client fixture lineage; cannot prove cleanup")
    return fixtures


def client_tags(run: str, client: str, environment: str | None = None) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": environment
        or os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_purchaser": client,
        "clientbridge_qa_client": client,
    }


def clock_name(run: str, client: str) -> str:
    return f"clientbridge-qa {run} {client}"


async def owned_subscriptions(
    account: str, fixture: ClientFixture, business: str
) -> list[stripe.Subscription]:
    if fixture.customer is None:
        raise ValueError("client fixture has no customer")
    listed = await stripe.Subscription.list_async(
        customer=fixture.customer, status="all", stripe_account=account
    )
    owned: list[stripe.Subscription] = []
    async for subscription in listed.auto_paging_iter():
        metadata = subscription.to_dict().get("metadata", {})
        if (
            subscription.livemode
            or metadata.get("business_id") != business
            or metadata.get("client_id") != fixture.client
        ):
            raise ValueError("client fixture customer has a subscription outside this run")
        owned.append(subscription)
    return owned


async def invoice_intents(
    account: str, subscriptions: list[stripe.Subscription], *, apply: bool = False
) -> set[str]:
    """The intents Stripe opened for the owned subscriptions' invoices, voiding unpaid ones."""
    intents: set[str] = set()
    for subscription in subscriptions:
        invoices = await stripe.Invoice.list_async(
            subscription=subscription.id, stripe_account=account
        )
        async for invoice in invoices.auto_paging_iter():
            # an invoice's own intent can't be canceled; voiding the invoice cancels it
            if apply and invoice.status == "open":
                await stripe.Invoice.void_invoice_async(invoice.id, stripe_account=account)
            payments = await stripe.InvoicePayment.list_async(
                invoice=invoice.id, stripe_account=account
            )
            async for payment in payments.auto_paging_iter():
                intent = payment.to_dict().get("payment", {}).get("payment_intent")
                if isinstance(intent, str):
                    intents.add(intent)
    return intents


async def clean_client(
    account: str,
    run: str,
    fixture: ClientFixture,
    *,
    apply: bool,
    environment: str | None = None,
    business: str = BUSINESS,
) -> list[dict[str, object]]:
    """Cancel the client's subscriptions, refund its charges, archive its prices, end its clock."""
    if fixture.customer is None:
        raise ValueError("client fixture has no customer")
    customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
    details = customer.to_dict()
    gone = bool(details.get("deleted"))
    if not gone and (
        customer.livemode
        or details.get("metadata") != client_tags(run, fixture.client, environment)
        or details.get("test_clock") != fixture.clock
    ):
        raise ValueError("client fixture customer ownership mismatch")
    if gone and fixture.clock is None:
        raise ValueError("a client fixture customer without a clock was deleted")
    subscriptions = [] if gone else await owned_subscriptions(account, fixture, business)
    from_invoices = await invoice_intents(account, subscriptions, apply=apply)
    owned: list[stripe.PaymentIntent] = []
    listed = await stripe.PaymentIntent.list_async(
        customer=fixture.customer, stripe_account=account
    )
    async for intent in listed.auto_paging_iter():
        metadata = intent.to_dict().get("metadata", {})
        if (
            intent.livemode
            or intent.customer != fixture.customer
            or intent.currency != "cad"
            or not (
                metadata.get("business_id") == business
                or intent.id in from_invoices
                or (gone and intent.status in ("succeeded", "canceled"))
            )
        ):
            raise ValueError("client fixture customer has an intent outside this run")
        owned.append(intent)
    tags = client_tags(run, fixture.client, environment)
    actions: list[dict[str, object]] = []
    for subscription in subscriptions:
        if subscription.status in ("canceled", "incomplete_expired"):
            continue
        if not apply:
            actions.append({"subscription": subscription.id, "status": "planned_cancel"})
            continue
        ended = await stripe.Subscription.cancel_async(subscription.id, stripe_account=account)
        actions.append({"subscription": ended.id, "status": ended.status})
    for intent in owned:
        if gone:
            planned = await cleanup_intent(account, intent, tags, apply=False)
            if not str(planned["status"]).startswith(("already_", "dispute_")):
                raise ValueError("a deleted clock customer left an unsettled charge")
            actions.append(planned)
        else:
            actions.append(await cleanup_intent(account, intent, tags, apply=apply))
    prices = {
        str(item["price"]["id"])
        for subscription in subscriptions
        for item in subscription.to_dict().get("items", {}).get("data", [])
    }
    for identity in sorted(prices):
        price = await stripe.Price.retrieve_async(identity, stripe_account=account)
        if price.livemode or not isinstance(price.product, str):
            raise ValueError("owned subscription price is not a sandbox product price")
        if not price.active:
            continue
        if not apply:
            actions.append({"price": price.id, "status": "planned_archive"})
            continue
        await stripe.Product.modify_async(
            price.product, default_price="", active=False, stripe_account=account
        )
        await stripe.Price.modify_async(price.id, active=False, stripe_account=account)
        actions.append({"price": price.id, "product": price.product, "status": "archived"})
    if fixture.clock is not None and not gone:
        clock_row = await stripe.test_helpers.TestClock.retrieve_async(
            fixture.clock, stripe_account=account
        )
        if clock_row.livemode or clock_row.name != clock_name(run, fixture.client):
            raise ValueError("client fixture clock ownership mismatch")
        if not apply:
            actions.append({"clock": fixture.clock, "status": "planned_delete"})
        else:
            await stripe.test_helpers.TestClock.delete_async(fixture.clock, stripe_account=account)
            actions.append({"clock": fixture.clock, "status": "deleted"})
    return actions


class Fixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice: str
    client: str
    customer: str | None = None


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: UUID
    account: str
    platform: str
    business: str = Field(pattern=r"^bz_birchbark(_\d{4})?$")
    database: dict[str, object]
    fixtures: list[Fixture]
    deposit_fixtures: list[DepositFixture] = []
    client_fixtures: list[ClientFixture] = []
    cleanup: list[dict[str, object]] = []

    @model_validator(mode="after")
    def complete_lineage(self) -> "Manifest":
        for fixture in [*self.fixtures, *self.deposit_fixtures, *self.client_fixtures]:
            if not fixture.customer:
                raise ValueError(
                    "incomplete registered customer lineage; recovery cannot prove clean"
                )
        for field in ("invoice", "client", "customer"):
            values = [getattr(fixture, field) for fixture in self.fixtures]
            if len(values) != len(set(values)):
                raise ValueError("duplicate fixture ownership")
        for field in ("booking", "client", "customer"):
            values = [getattr(fixture, field) for fixture in self.deposit_fixtures]
            values = [value for value in values if value is not None or field != "booking"]
            if len(values) != len(set(values)):
                raise ValueError("duplicate deposit fixture ownership")
        for field in ("client", "customer"):
            values = [
                getattr(fixture, field)
                for fixture in [*self.fixtures, *self.deposit_fixtures, *self.client_fixtures]
            ]
            if len(values) != len(set(values)):
                raise ValueError("invoice, deposit and client fixture ownership overlaps")
        return self


def recovery_credentials(mode: str, profile: str, merchants: Path) -> dict[str, str]:
    names = ("STRIPE_TEST_PLATFORM", "STRIPE_TEST_CONNECTED_ACCOUNT", "STRIPE_TEST_OTHER_ACCOUNT")
    if mode == "local":
        if os.environ.get("CI"):
            raise ValueError("CI recovery cannot read local CLI credentials")
        selected = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())[profile]
        if "clientbridge" not in selected.get("display_name", "").lower():
            raise ValueError("requires an explicitly named Clientbridge test profile")
        saved = json.loads(merchants.read_text())
        if saved["STRIPE_TEST_PLATFORM"] != selected["account_id"]:
            raise ValueError("merchant manifest and CLI profile platform differ")
        env = {name: saved[name] for name in names}
        env["STRIPE_TEST_SECRET_KEY"] = selected.get("test_mode_api_key", "")
    else:
        env = {name: os.environ.get(name, "") for name in (*names, "STRIPE_TEST_SECRET_KEY")}
    if not all(env.values()) or not env["STRIPE_TEST_SECRET_KEY"].startswith(
        ("sk_test_", "rk_test_")
    ):
        raise ValueError("recovery requires complete test-mode credentials and account identities")
    if env["STRIPE_TEST_CONNECTED_ACCOUNT"] == env["STRIPE_TEST_OTHER_ACCOUNT"]:
        raise ValueError("dedicated QA account identities must differ")
    return env


async def recover(
    manifest: Manifest,
    env: dict[str, str],
    environment: str,
    *,
    apply: bool,
    actions: list[dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    if environment not in ("local", "ci"):
        raise ValueError("unsupported recovery environment")
    if (
        manifest.platform != env["STRIPE_TEST_PLATFORM"]
        or manifest.account != env["STRIPE_TEST_CONNECTED_ACCOUNT"]
        or not env["STRIPE_TEST_SECRET_KEY"].startswith(("sk_test_", "rk_test_"))
    ):
        raise ValueError("recovery manifest does not match configured test platform/account")
    stripe.api_key = env["STRIPE_TEST_SECRET_KEY"]
    stripe.api_version = STRIPE_API_VERSION
    platform = await stripe.Account.retrieve_async()
    if platform.id != manifest.platform or (await stripe.Balance.retrieve_async()).livemode:
        raise ValueError("platform identity or test mode mismatch")
    for account, slot in (
        (manifest.account, "a"),
        (env["STRIPE_TEST_OTHER_ACCOUNT"], "b"),
    ):
        merchant = await stripe.Account.retrieve_async(account)
        metadata = merchant.to_dict().get("metadata", {})
        if (
            metadata.get("clientbridge_qa") != "payments"
            or metadata.get("clientbridge_qa_environment") != environment
            or metadata.get("clientbridge_qa_slot") != slot
            or (await stripe.Balance.retrieve_async(stripe_account=account)).livemode
        ):
            raise ValueError("merchant ownership or test mode mismatch")
    owned: list[tuple[stripe.PaymentIntent, dict[str, str], str, str]] = []
    for fixture in [*manifest.fixtures, *manifest.deposit_fixtures]:
        if fixture.customer is None:
            raise ValueError("incomplete customer lineage")
        expected = {
            "clientbridge_qa": "payments",
            "clientbridge_qa_environment": environment,
            "clientbridge_qa_run": str(manifest.run_id),
            "clientbridge_qa_client": fixture.client,
        }
        source = "booking" if isinstance(fixture, DepositFixture) else "invoice"
        target = fixture.booking if isinstance(fixture, DepositFixture) else fixture.invoice
        if isinstance(fixture, DepositFixture) and fixture.kind == "enrolment":
            expected["clientbridge_qa_enrolment"] = fixture.client
        elif target is not None:
            expected[f"clientbridge_qa_{source}"] = target
        customer = await stripe.Customer.retrieve_async(
            fixture.customer, stripe_account=manifest.account
        )
        if (
            customer.livemode
            or customer.id != fixture.customer
            or customer.to_dict().get("metadata") != expected
        ):
            raise ValueError("registered customer ownership mismatch")
        intents = await stripe.PaymentIntent.list_async(
            customer=customer.id, stripe_account=manifest.account
        )
        async for intent in intents.auto_paging_iter():
            if target is None:
                raise ValueError("an unbound enrolment's customer has an intent; cannot prove it")
            if isinstance(fixture, DepositFixture):
                validate_deposit_intent(intent, fixture)
            metadata = intent.to_dict().get("metadata", {})
            if (
                intent.livemode
                or intent.customer != fixture.customer
                or metadata.get(f"{source}_id") != target
                or (source == "booking" and metadata.get("invoice_id"))
                or metadata.get("business_id") != manifest.business
                or intent.amount != 2000
                or intent.currency != "cad"
            ):
                raise ValueError("registered customer has an intent outside this exact fixture")
            owned.append((intent, expected, source, target))
    # Validate every fixture before the first mutation, so conflicting ownership fails closed.
    results = actions if actions is not None else []
    plans = [
        await cleanup_intent(manifest.account, intent, metadata, apply=False)
        for intent, metadata, _, _ in owned
    ]
    run = str(manifest.run_id)
    for purchaser in manifest.client_fixtures:
        plans.extend(
            await clean_client(
                manifest.account,
                run,
                purchaser,
                apply=False,
                environment=environment,
                business=manifest.business,
            )
        )
    if not apply:
        results.extend(plans)
        return results
    for purchaser in manifest.client_fixtures:
        results.extend(
            await clean_client(
                manifest.account,
                run,
                purchaser,
                apply=True,
                environment=environment,
                business=manifest.business,
            )
        )
    for intent, metadata, source, target in owned:
        current = await stripe.PaymentIntent.retrieve_async(
            intent.id, stripe_account=manifest.account
        )
        current_tags = current.to_dict().get("metadata", {})
        if (
            current.id != intent.id
            or current.customer != intent.customer
            or current.amount != intent.amount
            or current.currency != intent.currency
            or current_tags.get(f"{source}_id") != target
            or (source == "booking" and current_tags.get("invoice_id"))
            or current_tags.get("business_id") != manifest.business
        ):
            raise ValueError("owned intent identity changed during recovery")
        results.append(await cleanup_intent(manifest.account, current, metadata))
    return results


async def recover_main(argv: list[str]) -> int:
    """Recover manifest-owned sandbox intents without the disposable app database."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe recover")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--credentials", choices=("local", "environment"), default="local")
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument(
        "--merchants", type=Path, default=ROOT / ".scratchpad/stripe-local-merchants-ready.json"
    )
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    state = args.state.resolve()
    if (
        args.state.is_symlink()
        or state.name != "stripe-fixtures.json"
        or state.parent.parent != ROOT / ".scratchpad"
        or re.fullmatch(r"e2e-[a-f0-9]{12}", state.parent.name) is None
    ):
        parser.error("requires one exact run manifest under repo .scratchpad/e2e-<12 hex>")
    destination = state.parent / "provider-recovery.json"
    attempt: dict[str, object] = {"started_at": clock.wall().isoformat(), "apply": args.apply}
    lease = (ROOT / ".scratchpad/stripe-qa.lock").open("a")
    held = False
    code = 1
    try:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        held = True
        original = json.loads((state.parent / "run.json").read_text())
        if original.get("surface") != "connect-stripe":
            raise ValueError("manifest does not belong to a provider browser run")
        attempt["original_outcome"] = original.get("outcome")
        manifest = Manifest.model_validate_json(state.read_text())
        attempt["run_id"] = str(manifest.run_id)
        attempt["account"] = manifest.account
        env = recovery_credentials(args.credentials, args.profile, args.merchants)
        actions: list[dict[str, object]] = []
        attempt["actions"] = actions
        await recover(
            manifest,
            env,
            "ci" if args.credentials == "environment" else "local",
            apply=args.apply,
            actions=actions,
        )
        attempt["status"] = (
            "planned"
            if any(str(action["status"]).startswith("planned_") for action in actions)
            else "verified_clean"
        )
        code = 0
    except Exception as error:
        attempt["status"] = "failed"
        attempt["error_type"] = type(error).__name__
    finally:
        await close_stripe_client()
        attempt["finished_at"] = clock.wall().isoformat()
        try:
            if held:
                previous = json.loads(destination.read_text()) if destination.exists() else []
                if not isinstance(previous, list):
                    raise ValueError("invalid recovery history")
                previous.append(attempt)
                temporary = destination.with_suffix(".tmp")
                temporary.write_text(json.dumps(previous, indent=2) + "\n")
                temporary.chmod(0o600)
                temporary.replace(destination)
        except Exception:
            code = 1
            attempt["status"] = "failed"
            attempt["error_type"] = "RecoveryRecordError"
        finally:
            lease.close()
        print(json.dumps(attempt))
    return code


def stack_credentials(
    profile: str, merchants: Path, publishable_file: Path, mode: str
) -> dict[str, str]:
    if mode == "environment":
        supplied = environment(None)
        publishable = supplied.get("STRIPE_PUBLISHABLE_KEY", "")
        if not publishable.startswith("pk_test_"):
            raise ValueError("protected environment requires a test publishable key")
        env = {
            name: supplied[name]
            for name in (
                "STRIPE_TEST_SECRET_KEY",
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
                "STRIPE_PUBLISHABLE_KEY",
            )
        }
        env["STRIPE_SECRET_KEY"] = env["STRIPE_TEST_SECRET_KEY"]
        env["STRIPE_BROWSER_ENVIRONMENT"] = "ci"
        asyncio.run(preflight(env))
        return env
    if os.environ.get("CI"):
        raise ValueError("local CLI profile onboarding credentials are forbidden in CI")
    selected = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())[profile]
    key = selected.get("test_mode_api_key", "")
    if (
        not key.startswith(("sk_test_", "rk_test_"))
        or "clientbridge" not in selected.get("display_name", "").lower()
    ):
        raise ValueError("requires an explicitly named Clientbridge test profile")
    saved = json.loads(merchants.read_text())
    if saved["STRIPE_TEST_PLATFORM"] != selected["account_id"]:
        raise ValueError("merchant manifest and profile platform differ")
    publishable = dotenv_values(publishable_file).get("STRIPE_PUBLISHABLE_KEY")
    if not publishable or not publishable.startswith("pk_test_"):
        raise ValueError("Connect environment file must contain a test publishable key")
    env = {
        "STRIPE_BROWSER_ENVIRONMENT": "local",
        "STRIPE_SECRET_KEY": key,
        "STRIPE_TEST_SECRET_KEY": key,
        "STRIPE_PUBLISHABLE_KEY": publishable,
        **{
            name: saved[name]
            for name in (
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
            )
        },
    }
    asyncio.run(preflight(env))
    return env


def listener(stack: Stack, processes: ExitStack) -> str:
    process = subprocess.Popen(
        [
            "stripe",
            "listen",
            "--latest",
            "--events-from",
            "@accounts",
            "--events",
            ",".join(PAYMENT_EVENTS),
            "--forward-to",
            stack.env.get("STRIPE_BROWSER_RELAY_URL", stack.api + "/webhooks/stripe")
            + ("/webhook" if "STRIPE_BROWSER_RELAY_URL" in stack.env else ""),
            "--skip-update",
            "--color",
            "off",
        ],
        env={**stack.env, "STRIPE_API_KEY": stack.env["STRIPE_TEST_SECRET_KEY"]},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    startup: queue.Queue[tuple[str, str]] = queue.Queue()
    deliveries: list[dict[str, object]] = []
    retries: dict[str, int] = {}
    stopping = threading.Event()
    cleanup_errors: list[BaseException] = []
    delivery_path = Path(stack.env["STRIPE_BROWSER_STATE_FILE"]).parent / "stripe-deliveries.json"

    def drain() -> None:
        if process.stdout is None:
            return
        for line in iter(process.stdout.readline, b""):
            secret = re.search(rb"whsec_[A-Za-z0-9]+", line)
            version = re.search(rb"\d{4}-\d{2}-\d{2}\.[a-z]+", line)
            if secret:
                startup.put(("secret", secret[0].decode()))
            if version:
                startup.put(("version", version[0].decode()))
            event = re.search(rb"\bevt_[A-Za-z0-9]+", line)
            status = re.search(rb"\[(\d{3})\]", line)
            if event and status:
                event_id, response = event[0].decode(), int(status[1])
                delivery: dict[str, object] = {"event": event_id, "status": response}
                deliveries.append(delivery)
                attempt = retries.get(event_id, 0)
                if response == 503 and attempt < 3:
                    retries[event_id] = attempt + 1
                    delivery["resend_attempt"] = attempt + 1
                    try:
                        if stopping.wait(2 * (attempt + 1)):
                            break
                        child = subprocess.Popen(
                            [sys.executable, "-m", "e2e.stripe", "delivery", event_id],
                            env=stack.env,
                            cwd=ROOT / "backend",
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            start_new_session=True,
                        )
                        try:
                            if child.wait(timeout=30) != 0:
                                raise subprocess.CalledProcessError(child.returncode, child.args)
                        finally:
                            try:
                                stop(child, grace_seconds=1)
                            except BaseException as error:
                                cleanup_errors.append(error)
                                raise
                        delivery["resend"] = "requested_from_stripe"
                    except (subprocess.SubprocessError, OSError):
                        delivery["resend"] = "failed"
                delivery_path.write_text(json.dumps(deliveries, indent=2) + "\n")
        startup.put(("exit", ""))

    thread = threading.Thread(target=drain, daemon=True)

    def finish() -> None:
        stopping.set()
        stop(process)
        thread.join(40)
        if thread.is_alive():
            raise RuntimeError("Stripe delivery worker did not stop")
        if cleanup_errors:
            raise RuntimeError("Stripe resend process cleanup failed") from cleanup_errors[0]

    processes.callback(finish)
    thread.start()
    found: dict[str, str] = {}
    while not {"secret", "version"}.issubset(found):
        try:
            kind, value = startup.get(timeout=30)
        except queue.Empty:
            raise RuntimeError(
                "Stripe listener did not confirm signing secret and API version"
            ) from None
        if kind == "exit":
            raise RuntimeError("Stripe listener exited before readiness")
        found[kind] = value
    if found["version"] != STRIPE_API_VERSION:
        raise RuntimeError("Stripe listener API version does not match the application")
    return found["secret"]


def run_lane(args: argparse.Namespace, directory: Path, lease: tier.Lease) -> None:
    stack = Stack(directory, lease)
    stack.configure()
    print(f"Stripe browser diagnostics: {directory}", flush=True)
    if args.configure_only:
        return
    record: dict[str, object] = {
        "project": stack.project,
        "started_at": clock.wall().isoformat(),
        "surface": "connect-stripe",
        "credentials_mode": args.credentials,
        "activation": args.activation,
        "source": source_snapshot(),
        "outcome": "running",
        "provider_cleanup": "not_started",
        "allow_source_changes": args.allow_source_changes,
        "cleanup": "pending",
        "data_cleanup": "pending",
        "process_cleanup": "pending",
        **stack.worker_checks,
    }
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(record, indent=2))
    try:
        with owned_processes(record) as processes, (directory / "setup.log").open("wb") as log:
            prepared = False
            relay: Relay | None = None

            def resend(event_id: str) -> None:
                stack.command([sys.executable, "-m", "e2e.stripe", "delivery", event_id], log)

            def before_api() -> None:
                nonlocal prepared, relay
                stack.env.update(
                    stack_credentials(
                        args.profile, args.merchants, args.publishable_file, args.credentials
                    )
                )
                stack.env.update(
                    {
                        "STRIPE_BROWSER_E2E": "1",
                        "STRIPE_BROWSER_ACTIVATION": args.activation,
                        "STRIPE_BROWSER_RUN_ID": str(uuid4()),
                        "STRIPE_BROWSER_STATE_FILE": str(directory / "stripe-fixtures.json"),
                    }
                )
                relay = Relay(directory / "stripe-fixtures.json", f"{stack.api}/webhooks/stripe")
                stack.env["STRIPE_BROWSER_RELAY_URL"] = relay.start()
                stack.env["STRIPE_BROWSER_RELAY_TOKEN"] = relay.token
                processes.callback(relay.close)
                stack.env["STRIPE_WEBHOOK_SECRET"] = listener(stack, processes)
                relay.secret = stack.env["STRIPE_WEBHOOK_SECRET"]

                def recover_held() -> None:
                    if relay is not None:
                        relay.recover(resend)

                processes.callback(recover_held)
                record["listener_api_version"] = STRIPE_API_VERSION
                stack.command([sys.executable, "-m", "e2e.stripe", "setup", "prepare"], log)
                prepared = True
                record["provider_cleanup"] = "pending"

            try:
                try:
                    stack.start(processes, log, before_api=before_api, browser_fixtures=False)
                    stack.use_builds(log)
                    with (directory / "browser.log").open("wb") as browser_log:
                        stack.command(
                            [
                                "pnpm",
                                "--filter",
                                "connect",
                                "exec",
                                "playwright",
                                "test",
                                "--config=playwright.stripe.config.ts",
                                *args.tests,
                            ],
                            browser_log,
                            frontend=True,
                        )
                    report = directory / "browser-results" / "results.json"
                    if args.tests:
                        Report.model_validate_json(report.read_text()).validate_evidence([])
                    else:
                        Report.model_validate_json(report.read_text()).validate_evidence(
                            REQUIRED_CASES["stripe"], browser_cases("stripe")
                        )
                finally:
                    record.update(stack.finish_worker())
                stack.require_worker()
                record["outcome"] = "passed"
            finally:
                if prepared:
                    try:
                        if relay is not None:
                            relay.recover(resend)
                    finally:
                        try:
                            stack.command(
                                [sys.executable, "-m", "e2e.stripe", "setup", "cleanup"], log
                            )
                            record["provider_cleanup"] = "passed"
                        except BaseException:
                            record["provider_cleanup"] = "failed"
                            raise
    except BaseException as error:
        record["outcome"] = (
            "interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed"
        )
        record["failure_type"] = type(error).__name__
        record["failure_frames"] = [
            {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(error.__traceback__)
        ]
        raise
    finally:
        try:
            stack.cleanup()
            record["data_cleanup"] = "passed"
        except BaseException:
            record["data_cleanup"] = "failed"
            record["cleanup"] = "failed"
            if record["outcome"] == "passed":
                record["outcome"] = "failed"
                record["failure_type"] = "CleanupFailed"
            raise
        finally:
            if stack.process_cleanup_failed:
                record["process_cleanup"] = "failed"
            record["cleanup"] = (
                "passed"
                if record["data_cleanup"] == "passed"
                and record["process_cleanup"] == "passed"
                and record["provider_cleanup"] in ("passed", "not_started")
                else "failed"
            )
            record["finished_at"] = clock.wall().isoformat()
            record["final_source"] = source_snapshot()
            record["source_stable"] = record["source"] == record["final_source"]
            changed = not record["source_stable"] and not args.allow_source_changes
            if changed:
                record["outcome"] = "failed"
                record["source_validation"] = "failed"
            metadata.write_text(json.dumps(record, indent=2))
            if changed:
                raise RuntimeError("source changed during provider run; evidence is not qualified")


def stack_main(argv: list[str]) -> int:
    """Run Stripe.js checkout with signed provider events and owned-fixture cleanup."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe stack")
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument("--credentials", choices=("local", "environment"), default="local")
    parser.add_argument(
        "--merchants", type=Path, default=ROOT / ".scratchpad/stripe-local-merchants-ready.json"
    )
    parser.add_argument(
        "--publishable-file", type=Path, default=ROOT / "frontend/apps/connect/.env"
    )
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--activation", choices=("pointer", "keyboard"), default="pointer")
    parser.add_argument("--allow-source-changes", action="store_true")
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.tests[:1] == ["--"]:
        args.tests = args.tests[1:]
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes")
    if args.activation != "pointer" and os.environ.get("CI"):
        parser.error("CI requires the pointer checkout journey")
    directory = ROOT / ".scratchpad" / f"e2e-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        with (ROOT / ".scratchpad/stripe-qa.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("another provider run holds the merchant lease") from None
            with tier.hold(), tier.lease() as lease:
                run_lane(args, directory, lease)
    except BaseException as error:
        print(f"Stripe browser run did not complete: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


async def reconciled_at_prepare(account: str) -> Audit:
    """The shared merchant holds earlier runs' money, so the run's business reconciles from now."""
    now = int(clock.wall().timestamp())
    newest = await stripe.BalanceTransaction.list_async(
        limit=1, created={"lte": now}, stripe_account=account
    )
    return Audit(
        id=new_id("audit"),
        business_id=BUSINESS,
        action="ledger.reconciled",
        entity_type="business",
        entity_id=BUSINESS,
        changes={"transaction_id": newest.data[0].id if newest.data else "", "created": now},
    )


def run_state(account: str) -> tuple[Path, dict[str, object]]:
    path = state_path()
    state: dict[str, object] = json.loads(path.read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("fixture manifest belongs to another run/database/merchant")
    return path, state


def save_clients(path: Path, state: dict[str, object], fixtures: list[ClientFixture]) -> None:
    state["client_fixtures"] = [fixture.model_dump(exclude_none=True) for fixture in fixtures]
    client_fixtures(state)
    save(path, state)


async def register_purchaser(
    path: Path, state: dict[str, object], account: str, client_id: str, *, clocked: bool
) -> ClientFixture:
    """File a client before the app makes its customer, on a test clock for memberships."""
    run = str(state["run_id"])
    fixtures = client_fixtures(state)
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None or business.stripe_account_id != account:
            raise ValueError("isolated business is not bound to the QA merchant")
        client = await db.get(Client, client_id)
        if client is None or client.business_id != BUSINESS or client.deleted_at is not None:
            raise ValueError("client does not belong to the fixture business")
        if client.stripe_customer_id is not None:
            raise ValueError("refusing to adopt a pre-existing provider customer")
        taken = [
            *(row.get("client") for row in cast(list[dict[str, str]], state["fixtures"])),
            *(fixture.client for fixture in deposit_fixtures(state)),
            *(fixture.client for fixture in fixtures),
        ]
        if client_id in taken:
            raise ValueError("client already belongs to a fixture")
        fixture = ClientFixture(client=client_id)
        fixtures.append(fixture)
        save_clients(path, state, fixtures)  # lineage before any provider write
        expected = client_tags(run, client_id)
        key = f"browser:{run}:client:{client_id}"
        if clocked:
            created = await stripe.test_helpers.TestClock.create_async(
                frozen_time=int(clock.wall().timestamp()),
                name=clock_name(run, client_id),
                stripe_account=account,
                idempotency_key=f"{key}:clock",
            )
            fixture.clock = created.id
            save_clients(path, state, fixtures)
            customer = await stripe.Customer.create_async(
                name=client.name,
                email=client.email or "",
                metadata=expected,
                test_clock=created.id,
                stripe_account=account,
                idempotency_key=f"{key}:customer",
            )
        else:
            customer = await stripe.Customer.create_async(
                name=client.name,
                email=client.email or "",
                metadata=expected,
                stripe_account=account,
                idempotency_key=f"{key}:customer",
            )
        if customer.livemode or customer.to_dict().get("metadata") != expected:
            raise ValueError("client fixture customer ownership mismatch")
        fixture.customer = customer.id
        save_clients(path, state, fixtures)
        client.stripe_customer_id = customer.id
        await db.commit()
        return fixture


async def advance_clock(account: str, run: str, fixture: ClientFixture, seconds: int) -> int:
    if fixture.clock is None or seconds <= 0:
        raise ValueError("only a clock-bound client fixture can move forward")
    current = await stripe.test_helpers.TestClock.retrieve_async(
        fixture.clock, stripe_account=account
    )
    if (
        current.livemode
        or current.name != clock_name(run, fixture.client)
        or current.status != "ready"
    ):
        raise ValueError("the client fixture clock is not this run's or is still moving")
    target = current.frozen_time + seconds
    await stripe.test_helpers.TestClock.advance_async(
        fixture.clock, frozen_time=target, stripe_account=account
    )
    deadline = time.monotonic() + 300
    while current.status != "ready" or current.frozen_time != target:
        if current.status == "internal_failure" or time.monotonic() > deadline:
            raise TimeoutError("the sandbox test clock did not finish advancing")
        await asyncio.sleep(2)
        current = await stripe.test_helpers.TestClock.retrieve_async(
            fixture.clock, stripe_account=account
        )
    return target


def transaction_row(row: dict[str, object]) -> dict[str, object]:
    details = row.get("fee_details")
    return {
        **{key: row.get(key) for key in ("id", "type", "reporting_category", "source")},
        **{key: row.get(key) for key in ("amount", "fee", "net", "created")},
        "fee_details": [
            {"type": fee.get("type"), "amount": fee.get("amount")}
            for fee in cast(list[dict[str, object]], details if isinstance(details, list) else [])
        ],
    }


async def charge_evidence(account: str, charge_id: str) -> dict[str, object]:
    """A charge with every balance transaction Stripe booked for it, its refunds and disputes."""
    charge = await stripe.Charge.retrieve_async(
        charge_id, expand=["balance_transaction"], stripe_account=account
    )
    if charge.livemode:
        raise ValueError("live charge evidence is forbidden")
    found = charge.to_dict()
    transactions: list[dict[str, object]] = []
    if isinstance(own := found.get("balance_transaction"), dict):
        transactions.append(transaction_row(cast(dict[str, object], own)))
    refunds: list[dict[str, object]] = []
    listed = await stripe.Refund.list_async(charge=charge_id, stripe_account=account)
    async for refund in listed.auto_paging_iter():
        details = refund.to_dict()
        refunds.append(
            {key: details.get(key) for key in ("id", "amount", "status", "failure_reason")}
        )
        for key in ("balance_transaction", "failure_balance_transaction"):
            if isinstance(identity := details.get(key), str):
                row = await stripe.BalanceTransaction.retrieve_async(
                    identity, stripe_account=account
                )
                transactions.append(transaction_row(row.to_dict()))
    disputes: list[dict[str, object]] = []
    listed_disputes = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
    async for dispute in listed_disputes.auto_paging_iter():
        details = dispute.to_dict()
        disputes.append({key: details.get(key) for key in ("id", "status", "amount", "reason")})
        for row in cast(list[dict[str, object]], details.get("balance_transactions") or []):
            transactions.append(transaction_row(row))
    return {
        "charge": {
            "id": charge.id,
            "amount": charge.amount,
            "amount_refunded": charge.amount_refunded,
            "disputed": found.get("disputed"),
            "application_fee_amount": found.get("application_fee_amount"),
        },
        "refunds": refunds,
        "disputes": disputes,
        "transactions": sorted(transactions, key=lambda row: str(row["id"])),
        "net_cents": sum(int(cast(int, row["net"])) for row in transactions),
    }


async def owned_intent(account: str, state: dict[str, object], intent_id: str) -> str:
    """The charge of an intent this run's fixtures own."""
    intent = await stripe.PaymentIntent.retrieve_async(intent_id, stripe_account=account)
    if intent.livemode or not isinstance(intent.customer, str):
        raise ValueError("intent is not a sandbox intent of a customer")
    registered_tags(state, intent.customer)
    if not isinstance(intent.latest_charge, str):
        raise ValueError("the owned intent has no charge")
    return intent.latest_charge


async def client_action(action: str, client_id: str, seconds: int) -> dict[str, object]:
    account = await validate_context()
    path, state = run_state(account)
    run = str(state["run_id"])
    if action in ("register", "register-clock"):
        fixture = await register_purchaser(
            path, state, account, client_id, clocked=action == "register-clock"
        )
        return {**fixture.model_dump(), "account": account}
    matches = [f for f in client_fixtures(state, complete=True) if f.client == client_id]
    if len(matches) != 1:
        raise ValueError("client is not one registered client fixture")
    fixture = matches[0]
    if action == "advance":
        return {
            "clock": fixture.clock,
            "frozen_time": await advance_clock(account, run, fixture, seconds),
        }
    subscriptions = await owned_subscriptions(account, fixture, BUSINESS)
    if action == "decline":
        live = [s for s in subscriptions if s.status in ("active", "past_due")]
        if len(live) != 1 or fixture.customer is None:
            raise ValueError("the client fixture has no single live membership")
        # Stripe's always-declining test card stands in for a card the issuer starts refusing
        method = await stripe.PaymentMethod.attach_async(
            "pm_card_chargeCustomerFail", customer=fixture.customer, stripe_account=account
        )
        updated = await stripe.Subscription.modify_async(
            live[0].id, default_payment_method=method.id, stripe_account=account
        )
        return {"subscription": updated.id, "payment_method": method.id}
    renewals: list[dict[str, object]] = []
    for subscription in subscriptions:
        invoices = await stripe.Invoice.list_async(
            subscription=subscription.id, stripe_account=account
        )
        async for invoice in invoices.auto_paging_iter():
            details = invoice.to_dict()
            charges: list[dict[str, object]] = []
            payments = await stripe.InvoicePayment.list_async(
                invoice=invoice.id, stripe_account=account
            )
            async for payment in payments.auto_paging_iter():
                intent_id = payment.to_dict().get("payment", {}).get("payment_intent")
                if not isinstance(intent_id, str):
                    continue
                intent = await stripe.PaymentIntent.retrieve_async(
                    intent_id, stripe_account=account
                )
                charge = (
                    await charge_evidence(account, intent.latest_charge)
                    if isinstance(intent.latest_charge, str)
                    else None
                )
                charges.append({"intent": intent.id, "status": intent.status, "charge": charge})
            renewals.append(
                {
                    **{key: details.get(key) for key in ("id", "status", "billing_reason")},
                    **{
                        key: details.get(key)
                        for key in ("amount_due", "amount_paid", "attempt_count")
                    },
                    **{key: details.get(key) for key in ("period_start", "period_end", "created")},
                    "subscription": subscription.id,
                    "payments": charges,
                }
            )
    return {
        "subscriptions": [{"id": s.id, "status": s.status} for s in subscriptions],
        "invoices": sorted(renewals, key=lambda row: int(cast(int, row["created"]))),
    }


async def clients_main(argv: list[str]) -> None:
    """Register a gift card or membership client, move its test clock, or read its renewals."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe clients")
    parser.add_argument(
        "action", choices=("register", "register-clock", "advance", "decline", "evidence")
    )
    parser.add_argument("client_id")
    parser.add_argument("--seconds", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await client_action(args.action, args.client_id, args.seconds)))
    finally:
        await close_stripe_client()
        await engine.dispose()


async def dispute_action(action: str, intent_id: str) -> dict[str, object]:
    account = await validate_context()
    _, state = run_state(account)
    charge_id = await owned_intent(account, state, intent_id)
    if action in ("lose", "escalate"):
        listed = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
        disputes = [dispute async for dispute in listed.auto_paging_iter()]
        if len(disputes) != 1:
            raise ValueError("the owned charge does not have exactly one dispute")
        await submit_evidence(
            account, disputes[0], "lose" if action == "lose" else "escalate", str(state["run_id"])
        )
    return await charge_evidence(account, charge_id)


async def disputes_main(argv: list[str]) -> None:
    """Escalate or lose the dispute on an owned charge with Stripe's evidence values, or read it."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe disputes")
    parser.add_argument("action", choices=("show", "escalate", "lose"))
    parser.add_argument("intent_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await dispute_action(args.action, args.intent_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()


ACTIVE_FINDINGS = """
SELECT f.entity_id AS source, f.action, f.changes FROM (
    SELECT DISTINCT ON (entity_id) id, entity_id, action, changes FROM audits
    WHERE business_id = :business AND entity_type = 'stripe_source'
    AND action IN ('ledger.transaction_drift', 'ledger.transaction_failed')
    ORDER BY entity_id, id DESC
) f WHERE NOT EXISTS (
    SELECT 1 FROM audits r WHERE r.business_id = :business AND r.entity_type = 'audit'
    AND r.action = 'ledger.drift_resolved' AND r.entity_id = f.id
) ORDER BY f.entity_id
"""


async def run_sources(account: str, state: dict[str, object]) -> set[str]:
    """Every Stripe source the run created: its customers' charges, refunds and disputes."""
    customers = [
        *(row["customer"] for row in cast(list[dict[str, str]], state["fixtures"])),
        *(f.customer for f in deposit_fixtures(state, complete=True) if f.customer),
        *(f.customer for f in client_fixtures(state, complete=True) if f.customer),
    ]
    sources: set[str] = set()
    for customer in customers:
        intents = await stripe.PaymentIntent.list_async(customer=customer, stripe_account=account)
        async for intent in intents.auto_paging_iter():
            if not isinstance(intent.latest_charge, str):
                continue
            evidence = await charge_evidence(account, intent.latest_charge)
            sources.add(intent.latest_charge)
            for kind in ("refunds", "disputes"):
                sources.update(
                    str(row["id"]) for row in cast(list[dict[str, object]], evidence[kind])
                )
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        payouts = await db.scalars(
            text(
                "SELECT DISTINCT source_id FROM entries WHERE business_id = :business "
                "AND source_type = 'stripe_payout'"
            ),
            {"business": BUSINESS},
        )
        recorded = [str(payout) for payout in payouts]
    for payout in recorded:
        # the seeded demo ledger names payouts Stripe never made; only real ones are sources
        with suppress(stripe.InvalidRequestError):
            found = await stripe.Payout.retrieve_async(payout, stripe_account=account)
            if not found.livemode:
                sources.add(found.id)
    return sources


async def reconcile_run() -> dict[str, object]:
    """Reconcile the run's business with the job's own code, then judge only the run's sources."""
    account = await validate_context()
    _, state = run_state(account)
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None or business.stripe_account_id != account:
            raise ValueError("isolated business is not bound to the QA merchant")
        drifted = await reconcile_stripe_transactions(db, gateway, BUSINESS, account)
    sources = await run_sources(account, state)
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        findings = [
            dict(row)
            for row in (await db.execute(text(ACTIVE_FINDINGS), {"business": BUSINESS})).mappings()
        ]
        ledger_cents = await db.scalar(
            text(
                "SELECT COALESCE(SUM(e.amount_cents), 0) FROM entries e "
                "JOIN accounts a ON a.id = e.account_id WHERE a.business_id = :business "
                "AND a.owner_type = 'business' AND a.owner_id = :business AND a.category = 'stripe'"
            ),
            {"business": BUSINESS},
        )
    stripe_cents = await gateway.get_balance_cents(account, currency="CAD")
    return {
        "drifted": drifted,
        "sources": sorted(sources),
        "findings": [row for row in findings if row["source"] in sources],
        "other_findings": sum(row["source"] not in sources for row in findings),
        # the shared merchant's balance also holds every earlier run's money
        "balance": {"stripe_cents": stripe_cents, "ledger_cents": int(ledger_cents or 0)},
    }


async def reconcile_main(argv: list[str]) -> None:
    """Run reconciliation for the run's business and report findings on the run's own sources."""
    argparse.ArgumentParser(prog="python -m e2e.stripe reconcile").parse_args(argv)
    try:
        print(json.dumps(await reconcile_run(), default=str))
    finally:
        await close_stripe_client()
        await engine.dispose()


async def plan_main(argv: list[str]) -> None:
    """Set the run's business plan status, so a case can lapse it and put it back."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe plan")
    parser.add_argument("status")
    args = parser.parse_args(argv)
    status = TypeAdapter(PlanStatus).validate_python(args.status)
    try:
        account = await validate_context()
        run_state(account)
        async with SessionLocal() as db:
            business = await db.get(Business, BUSINESS)
            if business is None or business.stripe_account_id != account:
                raise ValueError("isolated business is not bound to the QA merchant")
            before = business.plan_status
            business.plan_status = status
            await db.commit()
        print(json.dumps({"business": BUSINESS, "before": before, "plan_status": status}))
    finally:
        await close_stripe_client()
        await engine.dispose()


COMMANDS: dict[str, Callable[[list[str]], int | None]] = {
    "browser": lambda argv: asyncio.run(browser_main(argv)),
    "setup": lambda argv: asyncio.run(setup_main(argv)),
    "deposits": lambda argv: asyncio.run(deposits_main(argv)),
    "deposits-evidence": lambda argv: asyncio.run(deposits_evidence_main(argv)),
    "delivery": lambda argv: asyncio.run(delivery_main(argv)),
    "recover": lambda argv: asyncio.run(recover_main(argv)),
    "clients": lambda argv: asyncio.run(clients_main(argv)),
    "disputes": lambda argv: asyncio.run(disputes_main(argv)),
    "reconcile": lambda argv: asyncio.run(reconcile_main(argv)),
    "plan": lambda argv: asyncio.run(plan_main(argv)),
    "stack": stack_main,
}


def main() -> int | None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        raise SystemExit(f"usage: python -m e2e.stripe {{{','.join(COMMANDS)}}} ...")
    return COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    sys.exit(main())
