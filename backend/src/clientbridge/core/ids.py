"""Prefixed-ULID identifiers. See .docs/architecture.md for the prefix catalog."""

from ulid import ULID

PREFIXES: dict[str, str] = {
    "business": "bz",
    "user": "us",
    "staff": "st",
    "client": "cl",
    "subject": "sj",
    "note": "nt",
    "consent": "cns",
    "item": "it",
    "stock_movement": "stk",
    "package": "pkg",
    "subscription": "sub",
    "gift_card": "gc",
    "slot": "ses",
    "booking": "bk",
    "addon": "bka",
    "hours": "av",
    "resource": "rs",
    "recurrence": "sch",
    "invoice": "inv",
    "estimate": "est",
    "order": "ord",
    "line": "ln",
    "payment": "pay",
    "payment_method": "pm",
    "payment_setup_link": "psl",
    "account": "acc",
    "entry": "ent",
    "journal": "jrn",
    "thread": "th",
    "message": "msg",
    "broadcast": "bro",
    "form": "frm",
    "form_field": "ff",
    "form_response": "fr",
    "contract": "con",
    "signature": "sig",
    "review": "rv",
    "file": "fl",
    "audit": "aud",
    "device": "dvt",
    "webhook": "wh",
    "idempotency_key": "idk",
    "auth_session": "ase",
    "auth_token": "atk",
    "returning_challenge": "rtc",
}


def new_id(entity: str) -> str:
    """Generate a sortable, prefixed id, e.g. new_id('booking') -> 'bk_01J...'."""
    return f"{PREFIXES[entity]}_{ULID()}"
