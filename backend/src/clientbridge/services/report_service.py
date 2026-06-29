import csv
import io
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.payments import Payment, PayoutAllocation
from clientbridge.schemas.reports import GstHstReport, IncomeReport, T4ARow

_INCOME_KINDS = ("payment", "deposit")
_PAYABLE = ("approved", "paid")
_UNNAMED_PAYEE = "Unnamed payee"


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """Inclusive `[start, end]` day bounds as UTC instants (start at 00:00, end at 23:59:59)."""
    return (
        datetime.combine(start, time.min, tzinfo=UTC),
        datetime.combine(end, time.max, tzinfo=UTC),
    )


class ReportService:
    """Read-only CRA-filing aggregates (income, GST/HST, T4A) — owner/admin, gated at the route."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.biz = principal.business_id

    async def income_summary(self, start: date, end: date) -> IncomeReport:
        lo, hi = _bounds(start, end)
        sub = (
            scoped(Payment, self.biz)
            .where(Payment.status == "succeeded", Payment.paid_at >= lo, Payment.paid_at <= hi)
            .subquery()
        )
        gross_expr = case((sub.c.kind.in_(_INCOME_KINDS), sub.c.amount_cents), else_=0)
        refund_expr = case((sub.c.kind == "refund", sub.c.amount_cents), else_=0)
        totals = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(gross_expr), 0), func.coalesce(func.sum(refund_expr), 0)
                )
            )
        ).one()
        gross_cents, refunds_cents = int(totals[0]), int(totals[1])

        net_expr = case((sub.c.kind == "refund", -sub.c.amount_cents), else_=sub.c.amount_cents)
        method_rows = (
            await self.db.execute(
                select(sub.c.method, func.coalesce(func.sum(net_expr), 0)).group_by(sub.c.method)
            )
        ).all()
        return IncomeReport(
            gross_cents=gross_cents,
            refunds_cents=refunds_cents,
            net_cents=gross_cents - refunds_cents,
            by_method={method: int(net) for method, net in method_rows},
        )

    async def gst_hst_return(self, start: date, end: date) -> GstHstReport:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        lo, hi = _bounds(start, end)
        sub = (
            scoped(Invoice, self.biz)
            .where(Invoice.status == "paid", Invoice.paid_at >= lo, Invoice.paid_at <= hi)
            .subquery()
        )
        row = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(sub.c.tax_total_cents), 0),
                    func.coalesce(func.sum(sub.c.total_cents - sub.c.tax_total_cents), 0),
                )
            )
        ).one()
        return GstHstReport(
            tax_collected_cents=int(row[0]),
            taxable_sales_cents=int(row[1]),
            gst_hst_number=business.gst_hst_number,
        )

    async def t4a_summary(self, year: int) -> list[T4ARow]:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        tz = ZoneInfo(business.timezone)
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
        sub = (
            scoped(PayoutAllocation, self.biz)
            .where(
                PayoutAllocation.status.in_(_PAYABLE),
                PayoutAllocation.created_at >= start,
                PayoutAllocation.created_at < end,
            )
            .subquery()
        )
        totals = (
            select(sub.c.staff_id, func.sum(sub.c.amount_cents).label("total"))
            .group_by(sub.c.staff_id)
            .subquery()
        )
        stmt = (
            select(totals.c.staff_id, User.name, totals.c.total)
            .join(Staff, Staff.id == totals.c.staff_id)
            .join(User, User.id == Staff.user_id, isouter=True)
            .order_by(totals.c.staff_id)
        )
        rows = (await self.db.execute(stmt)).all()
        return [
            T4ARow(staff_id=staff_id, name=name or _UNNAMED_PAYEE, total_cents=int(total))
            for staff_id, name, total in rows
            if total
        ]

    async def income_csv(self, start: date, end: date) -> str:
        report = await self.income_summary(start, end)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["metric", "amount_cents"])
        writer.writerow(["gross", report.gross_cents])
        writer.writerow(["refunds", report.refunds_cents])
        writer.writerow(["net", report.net_cents])
        for method, net in report.by_method.items():
            writer.writerow([f"method:{method}", net])
        return buf.getvalue()

    async def gst_hst_csv(self, start: date, end: date) -> str:
        report = await self.gst_hst_return(start, end)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["tax_collected_cents", "taxable_sales_cents", "gst_hst_number"])
        writer.writerow(
            [report.tax_collected_cents, report.taxable_sales_cents, report.gst_hst_number]
        )
        return buf.getvalue()

    async def t4a_csv(self, year: int) -> str:
        rows = await self.t4a_summary(year)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["staff_id", "name", "total_cents"])
        for row in rows:
            writer.writerow([row.staff_id, row.name, row.total_cents])
        return buf.getvalue()
