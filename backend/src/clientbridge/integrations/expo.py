"""Push: the Expo sender, and a console no-op until it is configured."""

from dataclasses import dataclass
from typing import Protocol

from clientbridge.core.config import get_settings

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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


class ExpoPushSender:
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
            response = await client.post(_EXPO_PUSH_URL, json=messages, headers=headers)
            response.raise_for_status()


def get_push_sender() -> PushSender:
    s = get_settings()
    if s.expo_access_token:
        return ExpoPushSender(s.expo_access_token)
    return ConsolePushSender()
