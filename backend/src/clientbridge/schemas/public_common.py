import re

from pydantic import BaseModel

# Shared hex-colour rule for the brand (write-validated in `BrandInput`, read-validated in
# `public_brand`). `\Z` (not `$`) so a trailing newline can't slip through.
HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\Z")


class PublicBrand(BaseModel):
    """A business's public-facing brand, rendered across the customer surfaces (book/pay/form/…).

    Fields are None when unset or malformed; `primary` is a validated hex colour and `logo_url` an
    http(s) URL, so the client can apply them directly without re-validating.
    """

    logo_url: str | None = None
    primary: str | None = None
    tagline: str | None = None
