"""A stand-in Stripe for the native lane, answering only what a bank authorization link needs."""

import hashlib
import hmac
import json
import re
import secrets
import threading
import urllib.parse
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import count
from pathlib import Path

from clientbridge.core import clock
from clientbridge.integrations.stripe import STRIPE_API_VERSION

# a key the API accepts as a test key; only this stand-in ever sees it
FAKE_KEY = "sk_test_native_lane"
# the Connect endpoint's signing secret the lane gives the API, so the events it sends verify
FAKE_WEBHOOK_SECRET = "whsec_native_lane"
BANK_NAME = "Lane Test Bank"
BANK_LAST4 = "6789"


def customer(identity: str) -> dict[str, object]:
    return {"id": identity, "object": "customer", "livemode": False, "metadata": {}}


def account(identity: str) -> dict[str, object]:
    capability = {"status": "active", "status_details": []}
    return {
        "id": identity,
        "object": "v2.core.account",
        "livemode": False,
        "configuration": {"merchant": {"capabilities": {"acss_debit_payments": capability}}},
    }


@dataclass
class SetupIntent:
    id: str
    account: str
    customer: str
    status: str = "requires_payment_method"
    payment_method: dict[str, object] | None = None
    mandate: str | None = None

    def shown(self) -> dict[str, object]:
        return {
            "id": self.id,
            "object": "setup_intent",
            "client_secret": f"{self.id}_secret_lane",
            "customer": self.customer,
            "status": self.status,
            "payment_method": self.payment_method,
            "payment_method_types": ["acss_debit"],
            "mandate": self.mandate,
            "next_action": None,
            "livemode": False,
        }


@dataclass
class StandIn:
    url: str = ""
    intents: dict[str, SetupIntent] = field(default_factory=dict[str, SetupIntent])
    mandates: dict[str, dict[str, object]] = field(default_factory=dict[str, dict[str, object]])

    def authorize(self, intent_id: str) -> list[bytes]:
        """The client finishing Stripe's bank form, as the events Stripe would then send."""
        intent = self.intents.get(intent_id)
        if intent is None:
            raise LookupError(f"no setup intent {intent_id}")
        # the tier keeps processed events between runs, so every id here is new
        n = secrets.token_hex(6)
        pm: dict[str, object] = {
            "id": f"pm_lane_{n}",
            "object": "payment_method",
            "type": "acss_debit",
            "customer": intent.customer,
            "acss_debit": {"last4": BANK_LAST4, "bank_name": BANK_NAME},
            "billing_details": {"name": None},
        }
        mandate = f"mandate_lane_{n}"
        self.mandates[mandate] = {
            "id": mandate,
            "object": "mandate",
            "status": "active",
            "payment_method": pm["id"],
        }
        intent.status, intent.payment_method, intent.mandate = "succeeded", pm, mandate
        return [
            event(intent.account, "payment_method.attached", pm, f"evt_lane_pm_{n}"),
            event(intent.account, "setup_intent.succeeded", intent.shown(), f"evt_lane_si_{n}"),
        ]


def event(account_id: str, kind: str, obj: dict[str, object], identity: str) -> bytes:
    return json.dumps(
        {
            "id": identity,
            "object": "event",
            "type": kind,
            "account": account_id,
            "api_version": STRIPE_API_VERSION,
            "created": int(clock.wall().timestamp()),
            "data": {"object": obj},
        }
    ).encode()


def signature(payload: bytes) -> str:
    """Stripe's v1 header over the timestamp and body, under the lane's signing secret."""
    stamp = int(clock.wall().timestamp())
    signed = f"{stamp}.".encode() + payload
    digest = hmac.new(FAKE_WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


@contextmanager
def fake_stripe(log: Path) -> Iterator[StandIn]:
    """Customers, the debit capability and bank SetupIntents; anything else is refused, logged."""
    customers = count(1)
    stand_in = StandIn()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            form = urllib.parse.parse_qs(self.rfile.read(length).decode())
            path = self.path.split("?", 1)[0]
            body: dict[str, object] | None = None
            if path == "/v1/customers":
                body = customer(f"cus_native_{next(customers)}")
            elif found := re.fullmatch(r"/v1/customers/(cus_\w+)", path):
                body = customer(found[1])
            elif found := re.fullmatch(r"/v2/core/accounts/(acct_\w+)", path):
                body = account(found[1])
            elif path == "/v1/setup_intents":
                intent = SetupIntent(
                    id=f"seti_lane_{secrets.token_hex(6)}",
                    account=self.headers.get("Stripe-Account") or "",
                    customer=form.get("customer", [""])[0],
                )
                stand_in.intents[intent.id] = intent
                body = intent.shown()
            self.record("POST", path, body)

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            body: dict[str, object] | None = None
            found = re.fullmatch(r"/v1/(setup_intents|mandates)/(\w+)", path)
            if found and found[1] == "setup_intents" and found[2] in stand_in.intents:
                body = stand_in.intents[found[2]].shown()
            elif found and found[1] == "mandates":
                body = stand_in.mandates.get(found[2])
            self.record("GET", path, body)

        def record(self, method: str, path: str, body: dict[str, object] | None) -> None:
            with log.open("a") as record:
                record.write(f"{clock.wall().isoformat()} {method} {path} {body is not None}\n")
            if body is None:
                error = {"type": "invalid_request_error", "message": f"not faked: {path}"}
                self.answer(404, {"error": error})
                return
            self.answer(200, body)

        def answer(self, status: int, body: dict[str, object]) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    stand_in.url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield stand_in
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)
