from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.identity import Business
from clientbridge.models.ledger import Account, Entry
from clientbridge.schemas.dashboard import DashboardSummary
from clientbridge.services import ledger_service as ledger
from clientbridge.services.report_service import next_gst_filing


class DashboardService:
    """Read-only money aggregates for the Today dashboard (owner/admin — gated at the route)."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.biz = principal.business_id

    async def summary(self) -> DashboardSummary:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        now = datetime.now(ZoneInfo(business.timezone))
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        received = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(
                Account.category.in_(("stripe", "bank", "cash")),
                Entry.event.in_(("payment", "refund")),
                Entry.occurred_at >= day_start,
            )
        )
        return DashboardSummary(
            today_revenue_cents=int(received.scalar_one()),
            awaiting_payment_cents=await ledger.account_total(
                self.db, self.biz, Account.category == "receivable"
            ),
            gst_hst_set_aside_cents=-await ledger.account_total(
                self.db, self.biz, Account.category == "tax"
            ),
            gst_hst_filing_due=next_gst_filing(now.date()) if business.tax_registered else None,
        )
