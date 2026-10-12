"""Real HTTP adapters must expose provider rejections to the delivery failure path."""

import json

import httpx
import pytest

from clientbridge.integrations.expo import ExpoPushSender, Push
from clientbridge.integrations.resend import Email, ResendEmailSender


def _capture(monkeypatch: pytest.MonkeyPatch, statuses: list[int]) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        status = statuses[min(len(requests), len(statuses)) - 1]
        headers = {"retry-after": "2"} if status == 429 else {}
        return httpx.Response(
            status, json={"id": "email_1", "data": [{"status": "ok"}]}, headers=headers
        )

    client_type = httpx.AsyncClient

    def client(*, timeout: float) -> httpx.AsyncClient:
        return client_type(transport=httpx.MockTransport(respond), timeout=timeout)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return requests


class _Sleeper:
    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


@pytest.mark.parametrize("provider", ["resend", "expo"])
@pytest.mark.parametrize("status", [200, 422, 429, 500])
async def test_delivery_checks_the_provider_http_status(
    monkeypatch: pytest.MonkeyPatch, provider: str, status: int
) -> None:
    requests = _capture(monkeypatch, [status])
    sleeper = _Sleeper()
    if provider == "resend":
        sender = ResendEmailSender("re_test_key", "Clientbridge <from@example.com>", sleep=sleeper)
        send = sender.send(Email(to="to@example.com", subject="Test", body="Hello"))
    else:
        send = ExpoPushSender("test-token").send(
            Push(tokens=["ExpoToken"], title="Test", body="Hello", data={"type": "test"})
        )
    if status >= 400:
        with pytest.raises(httpx.HTTPStatusError):
            await send
    else:
        result = await send
        assert result == ("email_1" if provider == "resend" else None)
    retried = provider == "resend" and status == 429
    assert len(requests) == (3 if retried else 1)
    assert sleeper.waits == ([2.0, 2.0] if retried else [])
    payload = json.loads(requests[0].content)
    if provider == "resend":
        assert str(requests[0].url) == "https://api.resend.com/emails"
        assert requests[0].headers["Authorization"] == "Bearer re_test_key"
        assert requests[0].headers["User-Agent"] == "clientbridge"
        assert "Idempotency-Key" not in requests[0].headers
        assert payload == {
            "from": "Clientbridge <from@example.com>",
            "to": ["to@example.com"],
            "subject": "Test",
            "text": "Hello",
        }
    else:
        assert payload[0]["to"] == "ExpoToken"
        assert requests[0].headers["Authorization"] == "Bearer test-token"


async def test_a_rate_limited_send_waits_for_retry_after_and_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _capture(monkeypatch, [429, 200])
    sleeper = _Sleeper()
    sender = ResendEmailSender("re_test_key", "from@example.com", sleep=sleeper)
    ref = await sender.send(Email(to="to@example.com", subject="Test", body="Hello"))
    assert ref == "email_1" and len(requests) == 2 and sleeper.waits == [2.0]


async def test_a_success_without_an_id_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    client_type = httpx.AsyncClient

    def client(*, timeout: float) -> httpx.AsyncClient:
        return client_type(transport=httpx.MockTransport(respond), timeout=timeout)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    sender = ResendEmailSender("re_test_key", "from@example.com")
    assert await sender.send(Email(to="to@example.com", subject="Test", body="Hello")) is None


async def test_resend_carries_reply_to_tags_and_the_idempotency_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = _capture(monkeypatch, [200])
    ref = await ResendEmailSender("re_test_key", "from@example.com").send(
        Email(
            to="to@example.com",
            subject="Test",
            body="Hello",
            reply_to="owner@example.com",
            idempotency_key="msg_01",
            tags={"business": "bz_01", "message": "msg_01"},
        )
    )
    assert ref == "email_1"
    assert requests[0].headers["Idempotency-Key"] == "msg_01"
    payload = json.loads(requests[0].content)
    assert payload["reply_to"] == ["owner@example.com"]
    assert payload["tags"] == [
        {"name": "business", "value": "bz_01"},
        {"name": "message", "value": "msg_01"},
    ]
