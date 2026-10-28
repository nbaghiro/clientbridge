"""Relay the merchant's signed events to the run that owns them, and redeliver missed ones."""

import argparse
import json
import os
import secrets
import socket
import subprocess
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

import stripe
from pydantic import BaseModel

from clientbridge.integrations.stripe import (
    PAYMENT_EVENTS,
    close_stripe_client,
)
from e2e.stripe_clients import client_fixtures, client_tags
from e2e.stripe_context import guard, identity, state_path, tags
from e2e.stripe_deposits import deposit_fixtures, fixture_tags, load_deposit


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
