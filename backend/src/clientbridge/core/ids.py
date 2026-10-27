"""Prefixed-ULID identifiers. See .docs/architecture.md for the prefix catalog."""

from ulid import ULID

from clientbridge.core.config import get_settings
from clientbridge.core.namespaces import in_namespace

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
    "delivery": "dlv",
    "broadcast": "bro",
    "form": "frm",
    "form_field": "ff",
    "form_response": "fr",
    "contract": "con",
    "signature": "sig",
    "review_request": "rrq",
    "google_connection": "gbc",
    "google_operation": "gbo",
    "file": "fl",
    "audit": "aud",
    "device": "dvt",
    "webhook": "wh",
    "idempotency_key": "idk",
    "returning_challenge": "rtc",
    "sync_receipt": "sur",
}


def new_id(entity: str) -> str:
    """Generate a sortable, prefixed id, e.g. new_id('booking') -> 'bk_01J...'."""
    value = str(ULID())
    namespace = get_settings().run_namespace
    if namespace:
        value = in_namespace(value, namespace)
    return f"{PREFIXES[entity]}_{value}"
