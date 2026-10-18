"""SMS: the Twilio sender, and a console no-op until it is configured."""

import base64
import hashlib
import hmac
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError
from clientbridge.integrations.http import http_session

_TWILIO_API = "https://api.twilio.com/2010-04-01"


@dataclass(frozen=True)
class Sms:
    to: str
    body: str
    from_number: str | None = None


class SmsSender(Protocol):
    async def send(self, sms: Sms) -> str | None: ...


class ConsoleSmsSender:
    """Default — no real delivery (used until Twilio creds are configured)."""

    async def send(self, sms: Sms) -> str | None:
        return None


class TwilioSmsSender:
    def __init__(self, account_sid: str, auth_token: str) -> None:
        self._sid = account_sid
        self._auth = auth_token

    async def send(self, sms: Sms) -> str | None:
        if sms.from_number is None:
            raise AppError(
                "business has no assigned SMS number", code="sms_unassigned", status_code=503
            )
        url = f"{_TWILIO_API}/Accounts/{self._sid}/Messages.json"
        form = {"To": sms.to, "From": sms.from_number, "Body": sms.body}
        async with http_session() as client:
            response = await client.post(url, data=form, auth=(self._sid, self._auth))
            response.raise_for_status()
            body = response.json()
            sid = body.get("sid") if isinstance(body, dict) else None
            return str(sid) if sid else None


def get_sms_sender() -> SmsSender:
    s = get_settings()
    if s.twilio_account_sid and s.twilio_auth_token:
        return TwilioSmsSender(s.twilio_account_sid, s.twilio_auth_token)
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
    expected = twilio_signature(auth_token, url, params).encode()
    return hmac.compare_digest(expected, signature.encode("latin-1", "replace"))
