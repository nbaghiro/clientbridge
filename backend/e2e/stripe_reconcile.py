"""Reconcile the run's Stripe objects against the ledger, and plan what a run would touch."""

import argparse
import json
from contextlib import suppress
from typing import cast

import stripe
from pydantic import TypeAdapter
from sqlalchemy import text

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.ids import new_id
from clientbridge.integrations.stripe import (
    StripeGateway,
    close_stripe_client,
)
from clientbridge.models.business import Business, PlanStatus
from clientbridge.models.platform import Audit
from clientbridge.services.payments import reconcile_stripe_transactions
from e2e.stripe_clients import client_fixtures
from e2e.stripe_context import BUSINESS, run_state, validate_context
from e2e.stripe_deposits import deposit_fixtures
from e2e.stripe_evidence import charge_evidence


async def reconciled_at_prepare(account: str) -> Audit:
    """The shared merchant holds earlier runs' money, so the run's business reconciles from now."""
    now = int(clock.wall().timestamp())
    newest = await stripe.BalanceTransaction.list_async(
        limit=1, created={"lte": now}, stripe_account=account
    )
    return Audit(
        id=new_id("audit"),
        business_id=BUSINESS,
        action="ledger.reconciled",
        entity_type="business",
        entity_id=BUSINESS,
        changes={"transaction_id": newest.data[0].id if newest.data else "", "created": now},
    )


ACTIVE_FINDINGS = """
SELECT f.entity_id AS source, f.action, f.changes FROM (
    SELECT DISTINCT ON (entity_id) id, entity_id, action, changes FROM audits
    WHERE business_id = :business AND entity_type = 'stripe_source'
    AND action IN ('ledger.transaction_drift', 'ledger.transaction_failed')
    ORDER BY entity_id, id DESC
) f WHERE NOT EXISTS (
    SELECT 1 FROM audits r WHERE r.business_id = :business AND r.entity_type = 'audit'
    AND r.action = 'ledger.drift_resolved' AND r.entity_id = f.id
) ORDER BY f.entity_id
"""


async def run_sources(account: str, state: dict[str, object]) -> set[str]:
    """Every Stripe source the run created: its customers' charges, refunds and disputes."""
    customers = [
        *(row["customer"] for row in cast(list[dict[str, str]], state["fixtures"])),
        *(f.customer for f in deposit_fixtures(state, complete=True) if f.customer),
        *(f.customer for f in client_fixtures(state, complete=True) if f.customer),
    ]
    sources: set[str] = set()
    for customer in customers:
        intents = await stripe.PaymentIntent.list_async(customer=customer, stripe_account=account)
        async for intent in intents.auto_paging_iter():
            if not isinstance(intent.latest_charge, str):
                continue
            evidence = await charge_evidence(account, intent.latest_charge)
            sources.add(intent.latest_charge)
            for kind in ("refunds", "disputes"):
                sources.update(
                    str(row["id"]) for row in cast(list[dict[str, object]], evidence[kind])
                )
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        payouts = await db.scalars(
            text(
                "SELECT DISTINCT source_id FROM entries WHERE business_id = :business "
                "AND source_type = 'stripe_payout'"
            ),
            {"business": BUSINESS},
        )
        recorded = [str(payout) for payout in payouts]
    for payout in recorded:
        # the seeded demo ledger names payouts Stripe never made; only real ones are sources
        with suppress(stripe.InvalidRequestError):
            found = await stripe.Payout.retrieve_async(payout, stripe_account=account)
            if not found.livemode:
                sources.add(found.id)
    return sources


async def reconcile_run() -> dict[str, object]:
    """Reconcile the run's business with the job's own code, then judge only the run's sources."""
    account = await validate_context()
    _, state = run_state(account)
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None or business.stripe_account_id != account:
            raise ValueError("isolated business is not bound to the QA merchant")
        drifted = await reconcile_stripe_transactions(db, gateway, BUSINESS, account)
    sources = await run_sources(account, state)
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        findings = [
            dict(row)
            for row in (await db.execute(text(ACTIVE_FINDINGS), {"business": BUSINESS})).mappings()
        ]
        ledger_cents = await db.scalar(
            text(
                "SELECT COALESCE(SUM(e.amount_cents), 0) FROM entries e "
                "JOIN accounts a ON a.id = e.account_id WHERE a.business_id = :business "
                "AND a.owner_type = 'business' AND a.owner_id = :business AND a.category = 'stripe'"
            ),
            {"business": BUSINESS},
        )
    stripe_cents = await gateway.get_balance_cents(account, currency="CAD")
    return {
        "drifted": drifted,
        "sources": sorted(sources),
        "findings": [row for row in findings if row["source"] in sources],
        "other_findings": sum(row["source"] not in sources for row in findings),
        # the shared merchant's balance also holds every earlier run's money
        "balance": {"stripe_cents": stripe_cents, "ledger_cents": int(ledger_cents or 0)},
    }


async def reconcile_main(argv: list[str]) -> None:
    """Run reconciliation for the run's business and report findings on the run's own sources."""
    argparse.ArgumentParser(prog="python -m e2e.stripe reconcile").parse_args(argv)
    try:
        print(json.dumps(await reconcile_run(), default=str))
    finally:
        await close_stripe_client()
        await engine.dispose()


async def plan_main(argv: list[str]) -> None:
    """Set the run's business plan status, so a case can lapse it and put it back."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe plan")
    parser.add_argument("status")
    args = parser.parse_args(argv)
    status = TypeAdapter(PlanStatus).validate_python(args.status)
    try:
        account = await validate_context()
        run_state(account)
        async with SessionLocal() as db:
            business = await db.get(Business, BUSINESS)
            if business is None or business.stripe_account_id != account:
                raise ValueError("isolated business is not bound to the QA merchant")
            before = business.plan_status
            business.plan_status = status
            await db.commit()
        print(json.dumps({"business": BUSINESS, "before": before, "plan_status": status}))
    finally:
        await close_stripe_client()
        await engine.dispose()
