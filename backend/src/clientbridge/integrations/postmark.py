"""Email: the Postmark sender, and a console no-op until it is configured."""

from dataclasses import dataclass
from typing import Protocol

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


class PostmarkEmailSender:  # pragma: no cover - real Postmark, faked in tests
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
            await client.post(_POSTMARK_URL, json=payload, headers=headers)


def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.postmark_server_token and s.email_from:
        return PostmarkEmailSender(s.postmark_server_token, s.email_from)
    return ConsoleEmailSender()
