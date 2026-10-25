"""Hold one owned genuine Stripe event in memory without changing its signed bytes."""

import json
import secrets
import socket
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import stripe
from pydantic import BaseModel


class Target(BaseModel):
    invoice: str
    intent: str


class Fixture(BaseModel):
    invoice: str
    client: str
    customer: str


class Manifest(BaseModel):
    account: str
    business: str
    fixtures: list[Fixture]


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
            manifest = Manifest.model_validate_json(self.manifest.read_text())
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
                        manifest = Manifest.model_validate_json(self.manifest.read_text())
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
