from clientbridge.core.ratelimit import RateLimiter


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
