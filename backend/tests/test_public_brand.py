from clientbridge.models.business import Business
from clientbridge.services.public import public_brand


def _business(brand: dict[str, object]) -> Business:
    return Business(id="bz_x", name="X", slug="x", brand=brand)


def test_brand_passes_through_trimmed() -> None:
    out = public_brand(_business({"primary": "#3F5E80", "tagline": " Hi "}))
    assert out.primary == "#3F5E80"
    assert out.tagline == "Hi"


def test_empty_brand_is_all_none() -> None:
    out = public_brand(_business({}))
    assert out.logo_url is None and out.primary is None and out.tagline is None


def test_avatar_keeps_square_mark_separate_from_letterhead() -> None:
    out = public_brand(_business({"logo_file_id": "fl_wordmark", "avatar_file_id": "fl_square"}))
    assert out.logo_url is not None and out.logo_url.endswith("/media/fl_wordmark")
    assert out.avatar_url is not None and out.avatar_url.endswith("/media/fl_square")
    fallback = public_brand(_business({"logo_file_id": "fl_wordmark"}))
    assert fallback.avatar_url == fallback.logo_url


def test_public_navigation_identifies_active_business_only() -> None:
    business = _business({})
    brand = public_brand(business)
    assert brand.public_slug == "x"
    assert brand.business_name == "X"
    business.status = "closed"
    assert public_brand(business).public_slug is None
