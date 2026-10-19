from collections.abc import Callable
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from clientbridge.integrations.google_business import (
    BUSINESS_SCOPE,
    GoogleBusinessError,
    HttpGoogleBusinessGateway,
    review_name,
    review_parent,
)


def _transport(
    monkeypatch: pytest.MonkeyPatch, respond: Callable[[httpx.Request], httpx.Response]
) -> None:
    client_type = httpx.AsyncClient

    def client(*, timeout: float) -> httpx.AsyncClient:
        return client_type(transport=httpx.MockTransport(respond), timeout=timeout)

    monkeypatch.setattr(httpx, "AsyncClient", client)


def _gateway() -> HttpGoogleBusinessGateway:
    return HttpGoogleBusinessGateway("client-id", "client-secret", "https://api.example/callback")


def test_google_authorization_requests_offline_business_scope_and_pkce() -> None:
    query = parse_qs(urlsplit(_gateway().authorization_url("state", "verifier")).query)
    assert query["scope"] == [BUSINESS_SCOPE]
    assert query["access_type"] == ["offline"] and query["prompt"] == ["consent"]
    assert query["state"] == ["state"] and query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"] != ["verifier"]
    assert "client_secret" not in query


@pytest.mark.parametrize(
    "account,location",
    [
        ("https://attacker.example", "locations/1"),
        ("accounts/1", "locations/../other"),
        ("accounts/1?other", "locations/1"),
    ],
)
def test_google_resources_cannot_change_the_upstream_destination(
    account: str, location: str
) -> None:
    with pytest.raises(GoogleBusinessError):
        review_parent(account, location)
    with pytest.raises(GoogleBusinessError):
        review_name("accounts/1/locations/2", "../../other")


async def test_google_list_and_reply_contracts(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer access"
        if request.method == "PUT":
            return httpx.Response(
                200, json={"comment": "Thanks", "updateTime": "2026-10-01T12:00:00Z"}
            )
        if request.method == "DELETE":
            return httpx.Response(200, json={})
        return httpx.Response(
            200,
            json={
                "reviews": [
                    {
                        "reviewId": "review-1",
                        "starRating": "FIVE",
                        "comment": "Helpful",
                        "reviewer": {"displayName": "Alex"},
                        "createTime": "2026-10-01T12:00:00Z",
                        "updateTime": "2026-10-01T12:00:00Z",
                    }
                ],
                "averageRating": 4.7,
                "totalReviewCount": 60,
                "nextPageToken": "next",
            },
        )

    _transport(monkeypatch, respond)
    gateway = _gateway()
    page = await gateway.reviews("access", "accounts/1/locations/2", "page")
    assert page.total_count == 60 and page.average_rating == 4.7
    assert page.reviews[0].reviewer.display_name == "Alex"
    assert requests[0].url.params["pageToken"] == "page"
    assert requests[0].url.params["pageSize"] == "50"
    reply = await gateway.put_reply("access", "accounts/1/locations/2/reviews/review-1", "Thanks")
    assert reply.comment == "Thanks"
    assert requests[-1].url.path.endswith("/reviews/review-1/reply")
    await gateway.delete_reply("access", "accounts/1/locations/2/reviews/review-1")
    assert requests[-1].method == "DELETE"


@pytest.mark.parametrize(
    "status,payload,code",
    [
        (400, {"error": "invalid_grant"}, "google_reconnect_required"),
        (401, {}, "google_reconnect_required"),
        (403, {}, "google_access_denied"),
        (404, {}, "google_not_found"),
        (429, {}, "google_rate_limited"),
        (503, {}, "google_unavailable"),
    ],
)
async def test_google_errors_do_not_leak_credentials_or_provider_payloads(
    monkeypatch: pytest.MonkeyPatch, status: int, payload: dict[str, str], code: str
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "oauth2.googleapis.com"
        return httpx.Response(status, json={**payload, "secret": "private-value"})

    _transport(monkeypatch, respond)
    with pytest.raises(GoogleBusinessError) as error:
        await _gateway().refresh("refresh-secret")
    assert error.value.code == code
    assert "private-value" not in str(error.value) and "refresh-secret" not in str(error.value)


async def test_google_accounts_locations_and_token_exchange(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "access",
                    "refresh_token": "refresh",
                    "expires_in": 3600,
                    "scope": BUSINESS_SCOPE,
                },
            )
        if request.url.path == "/revoke":
            return httpx.Response(200)
        if request.url.path == "/v1/accounts":
            return httpx.Response(
                200,
                json={
                    "accounts": [{"name": "accounts/1", "accountName": "Studio"}],
                    "nextPageToken": "next",
                },
            )
        location = {
            "name": "locations/2",
            "title": "Downtown",
            "metadata": {"newReviewUri": "https://g.page/r/example/review"},
        }
        if request.url.path.endswith("/locations"):
            return httpx.Response(200, json={"locations": [location]})
        return httpx.Response(200, json=location)

    _transport(monkeypatch, respond)
    gateway = _gateway()
    tokens = await gateway.exchange("code", "verifier")
    body = parse_qs(requests[-1].content.decode())
    assert body["code_verifier"] == ["verifier"]
    assert body["redirect_uri"] == ["https://api.example/callback"]
    assert tokens.refresh_token == "refresh"
    assert "refresh" not in repr(tokens)
    accounts = await gateway.accounts("access", "previous")
    assert accounts.accounts[0].title == "Studio"
    assert requests[-1].url.params["pageToken"] == "previous"
    locations = await gateway.locations("access", "accounts/1", "next")
    assert locations.locations[0].title == "Downtown"
    assert requests[-1].url.params["readMask"] == "name,title,metadata"
    location = await gateway.location("access", "locations/2")
    assert location.metadata.new_review_uri == "https://g.page/r/example/review"
    await gateway.revoke("refresh")
    assert parse_qs(requests[-1].content.decode()) == {"token": ["refresh"]}


@pytest.mark.parametrize("content", [b"not JSON", b"{}", b"x" * (4 * 1024 * 1024 + 1)])
async def test_google_malformed_or_oversized_responses_fail_closed(
    monkeypatch: pytest.MonkeyPatch, content: bytes
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=content)

    _transport(monkeypatch, respond)
    with pytest.raises(GoogleBusinessError) as error:
        await _gateway().exchange("code", "verifier")
    assert error.value.code == "google_unavailable"


async def test_google_transport_failure_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private upstream detail", request=request)

    _transport(monkeypatch, respond)
    with pytest.raises(GoogleBusinessError) as error:
        await _gateway().refresh("refresh-secret")
    assert str(error.value) == "Google request failed"
