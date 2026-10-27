"""The test tier's relay: Kratos's courier and PowerSync's key fetches reach their own run."""

import json
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RUNS = Path("/runs")
# every address an e2e run writes ends its local part in +<the run's four digits>
NAMESPACE = re.compile(r"\+(\d{4})@")
FORWARDED = ("X-Webhook-Secret", "Content-Type")


def runs() -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for path in RUNS.glob("*.json"):
        try:
            found[path.stem] = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
    return found


class Relay(BaseHTTPRequestHandler):
    def reply(self, status: int, body: bytes = b"", content_type: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.reply(200, b"ok")
            return
        if self.path != "/keys":
            self.reply(404)
            return
        keys: list[object] = []
        for run in runs().values():
            if not run.get("keys"):
                continue
            try:
                with urllib.request.urlopen(f"{run['api']}/sync/keys", timeout=5) as response:
                    keys.extend(json.loads(response.read())["keys"])
            except (OSError, ValueError, KeyError):
                continue
        self.reply(200, json.dumps({"keys": keys}).encode(), "application/json")

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            recipient = str(json.loads(body)["to"])
        except (ValueError, KeyError, TypeError):
            self.reply(400, b"the courier body names no recipient")
            return
        match = NAMESPACE.search(recipient)
        run = runs().get(match.group(1)) if match else None
        if run is None:
            # nobody is waiting for this mail; accepting it stops the courier retrying forever
            print(f"dropped auth mail to {recipient}: no live run owns it", flush=True)
            self.reply(202)
            return
        request = urllib.request.Request(
            f"{run['api']}/webhooks/auth-email",
            data=body,
            method="POST",
            headers={name: self.headers[name] for name in FORWARDED if self.headers[name]},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                self.reply(response.status, response.read())
        except urllib.error.HTTPError as error:
            self.reply(error.code, error.read())
        except OSError as error:
            self.reply(502, str(error).encode())

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Relay).serve_forever()
