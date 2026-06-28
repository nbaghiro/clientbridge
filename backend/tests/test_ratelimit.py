from starlette.requests import Request

from clientbridge.core.ratelimit import RateLimiter, _client_ip


def _request(headers: dict[str, str], client: tuple[str, int] | None) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
        "client": client,
    }
    return Request(scope)


def test_client_ip_prefers_forwarded_for() -> None:
    req = _request({"x-forwarded-for": "1.2.3.4, 5.6.7.8"}, ("10.0.0.1", 0))
    assert _client_ip(req) == "1.2.3.4"


def test_client_ip_falls_back_to_peer() -> None:
    assert _client_ip(_request({}, ("10.0.0.1", 0))) == "10.0.0.1"
    assert _client_ip(_request({}, None)) == "unknown"


def test_sweep_prunes_aged_buckets() -> None:
    rl = RateLimiter(limit=5, window_s=10.0, sweep_at=2)
    rl.check("a", 0.0)
    rl.check("b", 0.0)
    rl.check("c", 0.0)  # 3 keys > sweep_at
    rl.check("d", 100.0)  # triggers the sweep; a/b/c aged out
    assert "a" not in rl._hits
    assert "d" in rl._hits


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
