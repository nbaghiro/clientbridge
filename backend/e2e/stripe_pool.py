"""The QA merchant pairs a Stripe run leases: a developer's local pair or one of the CI pool."""

import json
from pathlib import Path

from scripts.stripe_qa_accounts import QA_ENVIRONMENT

from e2e.tier import ROOT

POOL = Path(__file__).with_name("stripe_pool.json")


def checked(environment: str) -> str:
    if not QA_ENVIRONMENT.fullmatch(environment):
        raise ValueError("a Stripe run needs the local or a pool merchant environment")
    return environment


def pair(name: str) -> dict[str, str]:
    """A pool pair's platform and accounts, as the run's STRIPE_TEST_* settings."""
    pool = json.loads(POOL.read_text())
    accounts = pool["pairs"].get(checked(name))
    if not isinstance(accounts, dict):
        raise ValueError(f"the pool has no pair {name}")
    return {
        "STRIPE_TEST_PLATFORM": str(pool["platform"]),
        "STRIPE_TEST_CONNECTED_ACCOUNT": str(accounts["a"]),
        "STRIPE_TEST_OTHER_ACCOUNT": str(accounts["b"]),
    }


def pairs() -> list[str]:
    return sorted(json.loads(POOL.read_text())["pairs"])


def lease_file(environment: str, root: Path = ROOT) -> Path:
    """One lock per merchant pair, so runs on different pairs never wait on each other."""
    suffix = "" if environment == "local" else f"-{checked(environment)}"
    return root / ".scratchpad" / f"stripe-qa{suffix}.lock"
