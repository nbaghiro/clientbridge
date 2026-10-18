import pytest
from starlette.requests import Request

from clientbridge.core.config import get_settings
from clientbridge.core.ratelimit import RateLimiter, requester_ip


def _request(headers: dict[str, str], client: tuple[str, int] | None) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
        "client": client,
    }
    return Request(scope)


def test_without_trusted_proxies_the_forwarded_header_is_ignored() -> None:
    req = _request({"x-forwarded-for": "1.2.3.4, 5.6.7.8"}, ("10.0.0.1", 0))
    assert requester_ip(req) == "10.0.0.1"


def test_behind_two_proxies_the_client_is_second_from_the_right(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 2)
    honest = _request({"x-forwarded-for": "203.0.113.7, 130.211.0.1"}, ("10.0.0.1", 0))
    spoofed = _request({"x-forwarded-for": "6.6.6.6, 203.0.113.7, 130.211.0.1"}, ("10.0.0.1", 0))
    assert requester_ip(honest) == requester_ip(spoofed) == "203.0.113.7"


def test_a_chain_shorter_than_the_trusted_hops_falls_back_to_the_peer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 2)
    assert requester_ip(_request({"x-forwarded-for": "1.2.3.4"}, ("10.0.0.1", 0))) == "10.0.0.1"


def test_client_ip_falls_back_to_peer() -> None:
    assert requester_ip(_request({}, ("10.0.0.1", 0))) == "10.0.0.1"
    assert requester_ip(_request({}, None)) == "unknown"


def test_sweep_prunes_aged_buckets() -> None:
    rl = RateLimiter(limit=5, window_s=10.0, sweep_at=2)
    rl.check("a", 0.0)
    rl.check("b", 0.0)
    rl.check("c", 0.0)  # 3 keys > sweep_at
    rl.check("d", 100.0)  # triggers the sweep; a/b/c aged out
    assert "a" not in rl
    assert "d" in rl


def test_allows_up_to_limit_then_blocks() -> None:
    rl = RateLimiter(limit=2, window_s=60.0)
    assert rl.check("ip", 0.0) is True
    assert rl.check("ip", 0.1) is True
    assert rl.check("ip", 0.2) is False  # 3rd within the window


def test_evicts_after_window() -> None:
    rl = RateLimiter(limit=1, window_s=10.0)
    assert rl.check("ip", 0.0) is True
    assert rl.check("ip", 5.0) is False
    assert rl.check("ip", 11.0) is True  # window has passed


def test_keys_are_independent() -> None:
    rl = RateLimiter(limit=1, window_s=60.0)
    assert rl.check("a", 0.0) is True
    assert rl.check("b", 0.0) is True
    assert rl.check("a", 0.1) is False


async def test_deployed_limit_is_shared_between_api_processes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import secrets

    from clientbridge.core import ratelimit
    from clientbridge.core.errors import TooManyRequests

    monkeypatch.setattr(get_settings(), "env", "staging")
    request = _request({}, (f"test-{secrets.token_hex(12)}", 0))
    monkeypatch.setattr(ratelimit, "_public_pay_limiter", RateLimiter(limit=1, window_s=60))
    await ratelimit.public_pay_rate_limit(request)
    monkeypatch.setattr(ratelimit, "_public_pay_limiter", RateLimiter(limit=1, window_s=60))
    with pytest.raises(TooManyRequests):
        await ratelimit.public_pay_rate_limit(request)


async def test_deployed_limit_refuses_with_503_while_redis_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clientbridge.core import ratelimit
    from clientbridge.core.errors import AppError

    monkeypatch.setattr(get_settings(), "env", "staging")
    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    with pytest.raises(AppError) as refused:
        await ratelimit.public_pay_rate_limit(_request({}, ("203.0.113.9", 0)))
    assert refused.value.status_code == 503
