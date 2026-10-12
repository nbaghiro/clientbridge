"""SMS: the Twilio sender, and a console no-op until it is configured."""

import base64
import hashlib
import hmac
from collections.abc import Sequence
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


def twilio_signature(auth_token: str, url: str, params: Sequence[tuple[str, str]]) -> str:
    """Twilio's request signature: HMAC-SHA1 of the URL plus each sorted name and value, base64."""
    payload = url + "".join(name + value for name, value in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def valid_twilio_signature(
    auth_token: str, url: str, params: Sequence[tuple[str, str]], signature: str
) -> bool:
    if not auth_token or not signature:
        return False
    return hmac.compare_digest(twilio_signature(auth_token, url, params), signature)
