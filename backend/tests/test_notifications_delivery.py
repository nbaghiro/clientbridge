"""Real HTTP adapters must expose provider rejections to the delivery failure path."""

import json

import httpx
import pytest

from clientbridge.integrations.expo import ExpoPushSender, Push
from clientbridge.integrations.postmark import Email, PostmarkEmailSender


@pytest.mark.parametrize("provider", ["postmark", "expo"])
@pytest.mark.parametrize("status", [200, 422, 500])
async def test_delivery_checks_the_provider_http_status(
    monkeypatch: pytest.MonkeyPatch, provider: str, status: int
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json={"data": [{"status": "ok"}]})

    client_type = httpx.AsyncClient

    def client(*, timeout: float) -> httpx.AsyncClient:
        return client_type(transport=httpx.MockTransport(respond), timeout=timeout)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    if provider == "postmark":
        send = PostmarkEmailSender("test-token", "from@example.com").send(
            Email(to="to@example.com", subject="Test", body="Hello")
        )
    else:
        send = ExpoPushSender("test-token").send(
            Push(tokens=["ExpoToken"], title="Test", body="Hello", data={"type": "test"})
        )
    if status >= 400:
        with pytest.raises(httpx.HTTPStatusError):
            await send
    else:
        await send
    assert len(requests) == 1
    payload = json.loads(requests[0].content)
    if provider == "postmark":
        assert payload["To"] == "to@example.com"
        assert requests[0].headers["X-Postmark-Server-Token"] == "test-token"
    else:
        assert payload[0]["to"] == "ExpoToken"
        assert requests[0].headers["Authorization"] == "Bearer test-token"
