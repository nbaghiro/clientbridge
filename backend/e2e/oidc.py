"""The test tier's Google stand-in: an OpenID provider signing in whatever address a test types."""

import base64
import hashlib
import html
import json
import secrets
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KEY = json.loads(Path("/config/oidc.json").read_text())
ISSUER = "http://oidc:8080"
# the browser reaches the stand-in through the tier's published port, Kratos through the network
BROWSER = KEY["browser_url"]
CLIENT = KEY["client_id"]
# SHA-256's DigestInfo prefix, which RS256 signs ahead of the digest
SHA256_INFO = bytes.fromhex("3031300d060960864801650304020105000420")
codes: dict[str, dict[str, object]] = {}


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def as_bytes(number: int) -> bytes:
    return number.to_bytes((number.bit_length() + 7) // 8, "big")


def signed(claims: dict[str, object]) -> str:
    header = {"alg": "RS256", "kid": "e2e", "typ": "JWT"}
    message = f"{b64(json.dumps(header).encode())}.{b64(json.dumps(claims).encode())}"
    n, d = int(KEY["n"]), int(KEY["d"])
    size = (n.bit_length() + 7) // 8
    digest = SHA256_INFO + hashlib.sha256(message.encode()).digest()
    padded = b"\x00\x01" + b"\xff" * (size - len(digest) - 3) + b"\x00" + digest
    signature = pow(int.from_bytes(padded, "big"), d, n).to_bytes(size, "big")
    return f"{message}.{b64(signature)}"


class Provider(BaseHTTPRequestHandler):
    def reply(self, status: int, body: bytes, content_type: str, **headers: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def json_reply(self, data: object, status: int = 200) -> None:
        self.reply(status, json.dumps(data).encode(), "application/json")

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/health":
            self.reply(200, b"ok", "text/plain")
        elif url.path == "/.well-known/openid-configuration":
            self.json_reply(
                {
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{BROWSER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/jwks",
                    "userinfo_endpoint": f"{ISSUER}/userinfo",
                    "response_types_supported": ["code"],
                    "subject_types_supported": ["public"],
                    "id_token_signing_alg_values_supported": ["RS256"],
                }
            )
        elif url.path == "/jwks":
            e, n = int(KEY["e"]), int(KEY["n"])
            key = {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "e2e"}
            self.json_reply({"keys": [{**key, "n": b64(as_bytes(n)), "e": b64(as_bytes(e))}]})
        elif url.path == "/authorize":
            fields = "".join(
                f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">'
                for k, v in query.items()
            )
            page = (
                "<!doctype html><title>Google stand-in</title><form method=post action=/authorize>"
                f'{fields}<label>Email <input name="login_email" type="email"></label>'
                '<label>Name <input name="login_name"></label><button>Continue</button></form>'
            )
            self.reply(200, page.encode(), "text/html")
        elif url.path == "/userinfo":
            claims = next((c for c in codes.values() if c.get("token") == self.bearer()), None)
            self.json_reply(claims or {"error": "invalid_token"}, 200 if claims else 401)
        else:
            self.reply(404, b"not found", "text/plain")

    def bearer(self) -> str:
        return (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()

    def form(self) -> dict[str, str]:
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        return dict(urllib.parse.parse_qsl(body))

    def do_POST(self) -> None:
        if self.path == "/authorize":
            form = self.form()
            code = secrets.token_urlsafe(16)
            email = form["login_email"]
            codes[code] = {
                "sub": hashlib.sha256(email.encode()).hexdigest()[:24],
                "email": email,
                "email_verified": True,
                "name": form.get("login_name") or email.split("@")[0],
                "nonce": form.get("nonce"),
            }
            target = urllib.parse.urlencode({"code": code, "state": form.get("state", "")})
            self.reply(302, b"", "text/plain", Location=f"{form['redirect_uri']}?{target}")
        elif self.path == "/token":
            claims = codes.get(self.form().get("code", ""))
            if claims is None:
                self.json_reply({"error": "invalid_grant"}, 400)
                return
            now = int(time.time())
            token = secrets.token_urlsafe(16)
            claims["token"] = token
            identity = {k: v for k, v in claims.items() if k != "token" and v is not None}
            id_token = signed(
                {**identity, "iss": ISSUER, "aud": CLIENT, "iat": now, "exp": now + 600}
            )
            self.json_reply(
                {
                    "access_token": token,
                    "token_type": "Bearer",
                    "expires_in": 600,
                    "id_token": id_token,
                }
            )
        else:
            self.reply(404, b"not found", "text/plain")

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Provider).serve_forever()
