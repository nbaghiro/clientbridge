"""Outreach adapters — the three notification channels (email · SMS · push).

Each is the same external-service boundary: a `Protocol` + a no-op Console default + a real provider
swapped in when configured + a `get_*` FastAPI dependency tests override with a recording fake. Prod
delivery is covered up to the wire without the network.
"""

from dataclasses import dataclass
from typing import Protocol

from clientbridge.core.config import get_settings

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class EmailSender(Protocol):
    async def send(self, email: Email) -> None: ...


class ConsoleEmailSender:
    """Default impl — no real delivery (a real provider is not wired yet)."""

    async def send(self, email: Email) -> None:
        return None


def get_email_sender() -> EmailSender:
    """FastAPI dependency; tests override it with a recording fake."""
    return ConsoleEmailSender()


@dataclass(frozen=True)
class Sms:
    to: str
    body: str


class SmsSender(Protocol):
    async def send(self, sms: Sms) -> None: ...


class ConsoleSmsSender:
    """Default — no real delivery (used until Twilio creds are configured)."""

    async def send(self, sms: Sms) -> None:
        return None


class TwilioSmsSender:  # pragma: no cover - real Twilio, faked in tests
    def __init__(self, account_sid: str, auth_token: str, from_number: str) -> None:
        self._sid = account_sid
        self._auth = auth_token
        self._from = from_number

    async def send(self, sms: Sms) -> None:
        from twilio.rest import Client  # type: ignore[import-not-found]  # optional, prod-only dep

        Client(self._sid, self._auth).messages.create(to=sms.to, from_=self._from, body=sms.body)


def get_sms_sender() -> SmsSender:
    s = get_settings()
    if s.twilio_account_sid and s.twilio_auth_token and s.twilio_sms_from:
        return TwilioSmsSender(s.twilio_account_sid, s.twilio_auth_token, s.twilio_sms_from)
    return ConsoleSmsSender()


@dataclass(frozen=True)
class Push:
    tokens: list[str]
    title: str
    body: str
    data: dict[str, str]


class PushSender(Protocol):
    async def send(self, push: Push) -> None: ...


class ConsolePushSender:
    """Default — no real delivery (used until Expo is configured)."""

    async def send(self, push: Push) -> None:
        return None


class ExpoPushSender:  # pragma: no cover - real Expo push, faked in tests
    def __init__(self, access_token: str) -> None:
        self._token = access_token

    async def send(self, push: Push) -> None:
        import httpx

        messages = [
            {"to": token, "title": push.title, "body": push.body, "data": push.data}
            for token in push.tokens
        ]
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(_EXPO_PUSH_URL, json=messages, headers=headers)


def get_push_sender() -> PushSender:
    s = get_settings()
    if s.expo_access_token:
        return ExpoPushSender(s.expo_access_token)
    return ConsolePushSender()
