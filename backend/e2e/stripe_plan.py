"""Which real-Stripe jobs a CI run starts, and the pool pair each one leases."""

import argparse
import json
import re
import sys

from e2e.stripe_pool import pairs

# the browser lane's shards, balanced by backend/e2e/seconds.json under stripe
SHARDS = 2
# what the browser lane depends on: payments services, its screens and the helpers it shares
BROWSER_PATHS = re.compile(
    r"^backend/src/clientbridge/(integrations/stripe|services/(payments|ledger|billing|orders"
    r"|entitlements|earnings|public|public_orders|remittances))\.py$"
    r"|^backend/(e2e/stripe|tests/sandbox/|scripts/stripe_qa)"
    r"|^frontend/(packages/(app-core/src|ui/src/web)|apps/(web/src|connect/src|web/e2e/support"
    r"|connect/e2e))/"
    r"|^\.github/workflows/e2e(-stripe)?\.yml$"
)


def touches_browser_lane(changed: list[str]) -> bool:
    return any(BROWSER_PATHS.search(path) for path in changed)


def plan(run: int, browser: bool, ready: bool = True) -> dict[str, object]:
    """The API job's pair, and the browser shards when asked; no two of one run share a pair."""
    if not ready:
        return {"api": "", "browser": []}
    size = len(pairs())
    per_run = 1 + SHARDS
    if per_run > size:
        raise ValueError("the pool has fewer pairs than one run's jobs")

    def leased(slot: int) -> str:
        return f"ci-{(run * per_run + slot) % size + 1}"

    shards = [
        {
            "name": f"browser ({index}/{SHARDS})",
            "artifact": f"stripe-browser-{index}",
            "shard": f"{index}/{SHARDS}",
            "pair": leased(index),
        }
        for index in range(1, SHARDS + 1)
    ]
    return {"api": leased(0), "browser": shards if browser else []}


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe_plan", description=__doc__)
    parser.add_argument("--run", type=int, required=True, help="the workflow's run number")
    parser.add_argument("--ready", action="store_true", help="the sandbox key is available")
    parser.add_argument(
        "--every-path", action="store_true", help="run the browser lane whatever changed"
    )
    args = parser.parse_args()
    changed = [line.strip() for line in sys.stdin if line.strip()]
    browser = args.every_path or touches_browser_lane(changed)
    planned = plan(args.run, browser, args.ready)
    print(f"api={planned['api']}")
    print(f"browser={json.dumps(planned['browser'])}")


if __name__ == "__main__":
    main()
