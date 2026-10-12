"""Email address handling shared by sign-in and invites."""

import string

_ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)


def normalize_email(address: str) -> str:
    """ASCII lowercasing only: Unicode folding would match `straße@` with `strasse@`."""
    return address.strip().translate(_ASCII_LOWER)
