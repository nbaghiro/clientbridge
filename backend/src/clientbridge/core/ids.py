"""Prefixed-ULID identifiers. See docs/data-model.md for the prefix catalog."""

from ulid import ULID

PREFIXES: dict[str, str] = {
    "business": "bz",
    "user": "us",
    "staff": "st",
    "client": "cl",
    "subject": "sj",
    "consent": "cns",
    "note": "nt",
    "item": "it",
    "package": "pkg",
    "subscription": "sub",
    "gift_card": "gc",
    "session": "ses",
    "booking": "bk",
    "availability": "av",
    "resource": "rs",
    "schedule": "sch",
    "invoice": "inv",
    "estimate": "est",
    "line": "ln",
    "tax_rate": "tx",
    "payment": "pay",
    "payment_method": "pm",
    "payout": "po",
    "payout_allocation": "pal",
    "thread": "th",
    "message": "msg",
    "broadcast": "bro",
    "form": "frm",
    "form_field": "ff",
    "form_response": "fr",
    "contract": "con",
    "signature": "sig",
    "review": "rv",
    "review_request": "rvr",
    "file": "fl",
    "audit_log": "aud",
    "webhook_event": "wh",
    "auth_session": "ase",
    "auth_token": "atk",
}


def new_id(entity: str) -> str:
    """Generate a sortable, prefixed id, e.g. new_id('booking') -> 'bk_01J...'."""
    return f"{PREFIXES[entity]}_{ULID()}"
