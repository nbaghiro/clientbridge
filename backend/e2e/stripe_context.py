"""The Stripe lane's guards and run state: the fixture business, its merchant and saved objects."""

import fcntl
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import stripe
from scripts.demo_context import FIXTURE_BUSINESS, run_id
from scripts.stripe_qa import preflight

from clientbridge.core.config import get_settings
from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
)

BUSINESS = run_id(FIXTURE_BUSINESS)


def guard() -> str:
    settings = get_settings()
    database = urlparse(settings.database_url)
    if (
        os.environ.get("STRIPE_BROWSER_E2E") != "1"
        or settings.env != "dev"
        or database.hostname not in ("localhost", "127.0.0.1")
        or database.path != "/clientbridge_test_e2e"
        or urlparse(settings.smtp_url or "").hostname not in ("localhost", "127.0.0.1", "mailpit")
        or not settings.stripe_secret_key.startswith(("sk_test_", "rk_test_"))
        or settings.stripe_secret_key != os.environ.get("STRIPE_TEST_SECRET_KEY")
        or not settings.stripe_webhook_secret.startswith("whsec_")
    ):
        raise ValueError(
            "requires isolated local provider API/database, test credentials and Mailpit"
        )
    account = os.environ["STRIPE_TEST_CONNECTED_ACCOUNT"]
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = STRIPE_API_VERSION
    return account


def state_path() -> Path:
    requested = Path(os.environ["STRIPE_BROWSER_STATE_FILE"])
    path = requested.resolve()
    scratch = Path(__file__).resolve().parents[2] / ".scratchpad"
    if not path.is_relative_to(scratch) or requested.is_symlink():
        raise ValueError("fixture manifest must be a run-owned path under repo .scratchpad")
    return path


def identity(account: str) -> dict[str, object]:
    run = str(UUID(os.environ["STRIPE_BROWSER_RUN_ID"]))
    database = urlparse(get_settings().database_url)
    return {
        "run_id": run,
        "account": account,
        "platform": os.environ["STRIPE_TEST_PLATFORM"],
        "business": BUSINESS,
        "database": {
            "host": database.hostname,
            "port": database.port,
            "name": database.path,
        },
    }


def save(path: Path, state: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def tags(run: str, invoice: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_invoice": invoice,
        "clientbridge_qa_client": client,
    }


async def validate_context() -> str:
    account = guard()
    lease = Path(__file__).resolve().parents[2] / ".scratchpad/stripe-qa.lock"
    with lease.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass  # The parent runner must hold this lease until cleanup finishes.
        else:
            fcntl.flock(lock, fcntl.LOCK_UN)
            raise ValueError("runner must hold the shared Stripe QA merchant lease")
    await preflight(dict(os.environ))
    environment = os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local")
    if environment not in ("local", "ci"):
        raise ValueError("browser fixtures require a dedicated local or CI merchant environment")
    for merchant_id, slot in (
        (account, "a"),
        (os.environ["STRIPE_TEST_OTHER_ACCOUNT"], "b"),
    ):
        merchant = await stripe.Account.retrieve_async(merchant_id)
        metadata = merchant.to_dict().get("metadata", {})
        if (
            metadata.get("clientbridge_qa_environment") != environment
            or metadata.get("clientbridge_qa_slot") != slot
        ):
            raise ValueError("browser fixture merchant environment/slot ownership mismatch")
    return account


def run_state(account: str) -> tuple[Path, dict[str, object]]:
    path = state_path()
    state: dict[str, object] = json.loads(path.read_text())
    if any(state.get(key) != value for key, value in identity(account).items()):
        raise ValueError("fixture manifest belongs to another run/database/merchant")
    return path, state
