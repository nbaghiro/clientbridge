"""SMS adapter (outreach channel) — same boundary pattern as `email.py`. Prod swaps in Twilio when
configured; dev/test use the no-op Console sender or a recording fake."""

from dataclasses import dataclass
from typing import Protocol

from clientbridge.core.config import get_settings


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
