"""Email: the Postmark sender, an SMTP sender for Mailpit in dev, and a console no-op."""

import asyncio
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlsplit

from clientbridge.core.config import get_settings

_POSTMARK_URL = "https://api.postmarkapp.com/email"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class EmailSender(Protocol):
    async def send(self, email: Email) -> None: ...


class ConsoleEmailSender:
    """Default — no real delivery (used until a Postmark token + from-address are configured)."""

    async def send(self, email: Email) -> None:
        return None


class PostmarkEmailSender:
    def __init__(self, server_token: str, from_address: str) -> None:
        self._token = server_token
        self._from = from_address

    async def send(self, email: Email) -> None:
        import httpx

        payload = {
            "From": self._from,
            "To": email.to,
            "Subject": email.subject,
            "TextBody": email.body,
            "MessageStream": "outbound",
        }
        headers = {"X-Postmark-Server-Token": self._token, "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(_POSTMARK_URL, json=payload, headers=headers)
            response.raise_for_status()


class SmtpEmailSender:
    def __init__(self, url: str, from_address: str) -> None:
        parts = urlsplit(url)
        self._host = parts.hostname or "localhost"
        self._port = parts.port or 25
        self._from = from_address

    async def send(self, email: Email) -> None:
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = self._from, email.to, email.subject
        message.set_content(email.body)
        await asyncio.to_thread(self._deliver, message)

    def _deliver(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
            smtp.send_message(message)


def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.postmark_server_token and s.email_from:
        return PostmarkEmailSender(s.postmark_server_token, s.email_from)
    if s.smtp_url:
        return SmtpEmailSender(s.smtp_url, s.email_from or "no-reply@clientbridge.ca")
    return ConsoleEmailSender()
