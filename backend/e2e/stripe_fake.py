"""A stand-in Stripe for the native lane, answering only what a bank authorization link needs."""

import json
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import count
from pathlib import Path

from clientbridge.core import clock

# a key the API accepts as a test key; only this stand-in ever sees it
FAKE_KEY = "sk_test_native_lane"


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


@contextmanager
def fake_stripe(log: Path) -> Iterator[str]:
    """Customers and the debit capability; any other call is refused and logged, so it shows."""
    customers = count(1)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            path = self.path.split("?", 1)[0]
            body: dict[str, object] | None = None
            if path == "/v1/customers":
                body = customer(f"cus_native_{next(customers)}")
            elif found := re.fullmatch(r"/v1/customers/(cus_\w+)", path):
                body = customer(found[1])
            elif found := re.fullmatch(r"/v2/core/accounts/(acct_\w+)", path):
                body = account(found[1])
            with log.open("a") as record:
                record.write(f"{clock.wall().isoformat()} POST {path} {body is not None}\n")
            if body is None:
                error = {"type": "invalid_request_error", "message": f"not faked: {path}"}
                self.answer(404, {"error": error})
                return
            self.answer(200, body)

        def do_GET(self) -> None:
            with log.open("a") as record:
                record.write(f"{clock.wall().isoformat()} GET {self.path} False\n")
            self.answer(404, {"error": {"type": "invalid_request_error", "message": "not faked"}})

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
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)
