"""The public brand builder validates owner-set JSON before it reaches the customer client."""

from clientbridge.models.business import Business
from clientbridge.services.public import public_brand


def _business(brand: dict[str, object]) -> Business:
    return Business(id="bz_x", name="X", slug="x", brand=brand)


def test_valid_brand_passes_through() -> None:
    out = public_brand(
        _business({"logo_url": "https://cdn/x.png", "primary": "#3F5E80", "tagline": " Hi "})
    )
    assert out.logo_url == "https://cdn/x.png"
    assert out.primary == "#3F5E80"
    assert out.tagline == "Hi"  # trimmed


def test_malformed_values_are_dropped() -> None:
    out = public_brand(
        _business(
            {
                "logo_url": "javascript:alert(1)",  # not http(s)
                "primary": "red; } body{display:none}",  # not a hex colour
                "tagline": 42,  # not a string
            }
        )
    )
    assert out.logo_url is None
    assert out.primary is None
    assert out.tagline is None


def test_empty_brand_is_all_none() -> None:
    out = public_brand(_business({}))
    assert out.logo_url is None and out.primary is None and out.tagline is None


def test_avatar_keeps_square_mark_separate_from_letterhead() -> None:
    out = public_brand(_business({"logo_file_id": "fl_wordmark", "avatar_file_id": "fl_square"}))
    assert out.logo_url is not None and out.logo_url.endswith("/media/fl_wordmark")
    assert out.avatar_url is not None and out.avatar_url.endswith("/media/fl_square")
    fallback = public_brand(_business({"logo_url": "https://cdn/logo.png"}))
    assert fallback.avatar_url == fallback.logo_url
