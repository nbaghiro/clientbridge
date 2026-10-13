"""Email: the Resend sender, an SMTP sender for Mailpit in dev, and a console no-op."""

import asyncio
import base64
import hashlib
import hmac
import smtplib
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from clientbridge.core.config import get_settings

_RESEND_URL = "https://api.resend.com/emails"
_SIGNATURE_WINDOW = timedelta(minutes=5)
_SEND_ATTEMPTS = 2
_RETRY_CAP_SECONDS = 2  # a send runs inside the caller's transaction, so waits stay short

Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str
    reply_to: str | None = None
    idempotency_key: str | None = None
    tags: Mapping[str, str] = field(default_factory=dict)


class EmailSender(Protocol):
    async def send(self, email: Email) -> str | None: ...


class ConsoleEmailSender:
    """No real delivery: the default until a Resend key and a from-address are configured."""

    async def send(self, email: Email) -> str | None:
        return None


class ResendEmailSender:
    def __init__(self, api_key: str, from_address: str, *, sleep: Sleep = asyncio.sleep) -> None:
        self._key = api_key
        self._from = from_address
        self._sleep = sleep

    async def send(self, email: Email) -> str | None:
        payload: dict[str, object] = {
            "from": self._from,
            "to": [email.to],
            "subject": email.subject,
            "text": email.body,
        }
        if email.reply_to:
            payload["reply_to"] = [email.reply_to]
        if email.tags:
            payload["tags"] = [{"name": name, "value": value} for name, value in email.tags.items()]
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
            "User-Agent": "clientbridge",
        }
        if email.idempotency_key:
            headers["Idempotency-Key"] = email.idempotency_key
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await self._post(client, payload, headers)
            response.raise_for_status()
            body = response.json()
            email_id = body.get("id") if isinstance(body, dict) else None
            return str(email_id) if email_id else None

    async def _post(
        self, client: httpx.AsyncClient, payload: dict[str, object], headers: dict[str, str]
    ) -> httpx.Response:
        """Post once more after a 429, waiting for Resend's retry-after, then give up."""
        for _ in range(_SEND_ATTEMPTS - 1):
            response = await client.post(_RESEND_URL, json=payload, headers=headers)
            if response.status_code != 429:
                return response
            await self._sleep(_retry_after(response.headers.get("retry-after")))
        return await client.post(_RESEND_URL, json=payload, headers=headers)


def _retry_after(header: str | None) -> float:
    try:
        seconds = int(header or "")
    except ValueError:
        seconds = 1
    return float(min(max(seconds, 1), _RETRY_CAP_SECONDS))


class SmtpEmailSender:
    """Dev transport: hands mail to the SMTP host in SMTP_URL (Mailpit under make dev-api)."""

    def __init__(self, url: str, from_address: str) -> None:
        parts = urlsplit(url)
        self._host = parts.hostname or "localhost"
        self._port = parts.port or 25
        self._from = from_address

    async def send(self, email: Email) -> str | None:
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = self._from, email.to, email.subject
        if email.reply_to:
            message["Reply-To"] = email.reply_to
        message.set_content(email.body)
        await asyncio.to_thread(self._deliver, message)
        return None

    def _deliver(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
            smtp.send_message(message)


def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.smtp_url:  # local transport wins; a dev checkout holding Resend keys sends no real mail
        return SmtpEmailSender(s.smtp_url, s.email_from or "no-reply@clientbridge.ca")
    if s.resend_api_key and s.email_from:
        return ResendEmailSender(s.resend_api_key, s.email_from)
    return ConsoleEmailSender()


def resend_signature(secret: str, msg_id: str, timestamp: str, body: bytes) -> str:
    """Svix's scheme: base64 HMAC-SHA256 over the id, timestamp and raw body joined by periods."""
    key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
    signed = b".".join((msg_id.encode(), timestamp.encode(), body))
    return base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()


def valid_resend_signature(
    secret: str, msg_id: str, timestamp: str, body: bytes, header: str, *, now: datetime
) -> bool:
    if not secret or not msg_id or not timestamp or not header:
        return False
    try:
        sent_at = datetime.fromtimestamp(int(timestamp), tz=UTC)
        expected = resend_signature(secret, msg_id, timestamp, body).encode()
    except (ValueError, OverflowError, OSError):
        return False
    if abs(now - sent_at) > _SIGNATURE_WINDOW:
        return False
    return any(
        hmac.compare_digest(expected, entry.removeprefix("v1,").encode("latin-1", "replace"))
        for entry in header.split()
        if entry.startswith("v1,")
    )
