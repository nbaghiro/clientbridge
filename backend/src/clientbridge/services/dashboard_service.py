from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.schemas.dashboard import DashboardSummary

_OUTSTANDING = ("sent", "partial", "overdue")


class DashboardService:
    """Read-only money aggregates for the Today dashboard (owner/admin — gated at the route)."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.biz = principal.business_id

    async def summary(self) -> DashboardSummary:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        day_start = datetime.now(ZoneInfo(business.timezone)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        received = await self._payments_since(day_start, ("payment", "deposit"))
        refunded = await self._payments_since(day_start, ("refund",))
        return DashboardSummary(
            today_revenue_cents=received - refunded,
            awaiting_payment_cents=await self._invoice_sum("balance_cents", _OUTSTANDING),
            gst_hst_set_aside_cents=await self._invoice_sum("tax_total_cents", ("paid",)),
        )

    async def _payments_since(self, day_start: datetime, kinds: Sequence[str]) -> int:
        sub = (
            scoped(Payment, self.biz)
            .where(
                Payment.status == "succeeded",
                Payment.kind.in_(kinds),
                Payment.paid_at >= day_start,
            )
            .subquery()
        )
        total = await self.db.execute(select(func.coalesce(func.sum(sub.c.amount_cents), 0)))
        return int(total.scalar_one())

    async def _invoice_sum(self, column: str, statuses: Sequence[str]) -> int:
        sub = scoped(Invoice, self.biz).where(Invoice.status.in_(statuses)).subquery()
        total = await self.db.execute(select(func.coalesce(func.sum(sub.c[column]), 0)))
        return int(total.scalar_one())
