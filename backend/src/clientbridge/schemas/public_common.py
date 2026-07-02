from pydantic import BaseModel


class PublicBrand(BaseModel):
    """A business's public-facing brand, rendered across the customer surfaces (book/pay/form/…).

    Fields are None when unset or malformed; `primary` is a validated hex colour and `logo_url` an
    http(s) URL, so the client can apply them directly without re-validating.
    """

    logo_url: str | None = None
    primary: str | None = None
    tagline: str | None = None
