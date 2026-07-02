"""The public brand builder validates owner-set JSON before it reaches the customer client."""

from clientbridge.models.identity import Business
from clientbridge.services.public_common import public_brand


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
