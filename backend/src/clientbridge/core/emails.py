"""Email address handling shared by sign-in, invites and deliveries."""

import string

_ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)
_RESERVED_DOMAINS = ("example.com", "example.net", "example.org")
_RESERVED_TLDS = frozenset({"test", "example", "invalid", "localhost"})


def normalize_email(address: str) -> str:
    """ASCII lowercasing only: Unicode folding would match `straße@` with `strasse@`."""
    return address.strip().translate(_ASCII_LOWER)


def reserved_email(address: str) -> bool:
    """A domain RFC 2606 and RFC 6761 set aside, which no real mailbox can use."""
    domain = normalize_email(address).rpartition("@")[2].rstrip(".")
    return domain.rpartition(".")[2] in _RESERVED_TLDS or any(
        domain == name or domain.endswith(f".{name}") for name in _RESERVED_DOMAINS
    )
