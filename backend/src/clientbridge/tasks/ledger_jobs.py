from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.ids import new_id
from clientbridge.integrations.payments import PaymentGateway, get_payment_gateway
from clientbridge.models.identity import Business
from clientbridge.models.platform import Audit
from clientbridge.services import ledger_service as ledger


async def run_reconcile_ledger(db: AsyncSession, gateway: PaymentGateway) -> int:
    """Compare every connected account's Stripe balance with the ledger's; audit each drift."""
    businesses = (
        (await db.execute(select(Business).where(Business.stripe_account_id.is_not(None))))
        .scalars()
        .all()
    )
    drifted = 0
    for business in businesses:
        assert business.stripe_account_id is not None
        ours = await ledger.balance(
            db, business.id, owner_type="business", owner_id=business.id, category="stripe"
        )
        theirs = await gateway.get_balance_cents(business.stripe_account_id, currency="CAD")
        if ours != theirs:
            drifted += 1
            db.add(
                Audit(
                    id=new_id("audit"),
                    business_id=business.id,
                    action="ledger.drift",
                    entity_type="business",
                    entity_id=business.id,
                    changes={"ledger_cents": ours, "stripe_cents": theirs},
                )
            )
    await db.commit()
    return drifted


async def reconcile_ledger(ctx: dict[str, object]) -> int:
    """arq cron entry — the nightly ledger vs Stripe balance check."""
    async with SessionLocal() as db:
        return await run_reconcile_ledger(db, get_payment_gateway())
