"""Shared builders for the unauthenticated customer surfaces (#4)."""

import re

from clientbridge.models.identity import Business
from clientbridge.schemas.public_common import PublicBrand

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def public_brand(business: Business) -> PublicBrand:
    """A business's brand as a validated public DTO — malformed values are dropped, not surfaced.

    The brand is owner-set free JSON; validating here means the customer client can apply `primary`
    as a colour and `logo_url` as an image src without re-checking (and can't be fed a `javascript:`
    logo or a CSS-breaking colour).
    """
    brand = business.brand or {}
    logo_url = brand.get("logo_url")
    primary = brand.get("primary")
    tagline = brand.get("tagline")
    return PublicBrand(
        logo_url=logo_url if isinstance(logo_url, str) and _is_http(logo_url) else None,
        primary=primary if isinstance(primary, str) and _HEX.match(primary) is not None else None,
        tagline=(tagline.strip() or None) if isinstance(tagline, str) else None,
    )


def _is_http(url: str) -> bool:
    return url.startswith(("http://", "https://"))
