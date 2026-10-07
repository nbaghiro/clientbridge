import csv
import io
import zipfile
from calendar import monthrange
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.schemas.reports import (
    DashboardSummary,
    ExportKind,
    GstHstReport,
    IncomeReport,
    IncomeSummary,
    MonthNet,
    PayoutRow,
    ProvincialReport,
    ReportRate,
    ReportSummary,
    SalesByItemRow,
    T4APayee,
    T4ARow,
)
from clientbridge.services import ledger
from clientbridge.services.tax import rates_for_province

_CASH = ("stripe", "bank", "cash")
_UNNAMED_PAYEE = "Unnamed payee"


def period_bounds(start: date, end: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """The [start, end] days in the business timezone, as UTC instants."""
    return (
        datetime.combine(start, time.min, tzinfo=tz).astimezone(UTC),
        datetime.combine(end, time.max, tzinfo=tz).astimezone(UTC),
    )


_PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "annual": 12}


def add_months(day: date, months: int) -> date:
    """The first of the month `months` after day's month."""
    month = day.month - 1 + months
    return date(day.year + month // 12, month % 12 + 1, 1)


def month_end(day: date) -> date:
    return date(day.year, day.month, monthrange(day.year, day.month)[1])


def period_of(day: date, frequency: str) -> tuple[date, date]:
    """The filing period that contains `day` under a monthly, quarterly or annual frequency."""
    months = _PERIOD_MONTHS[frequency]
    first = date(day.year, (day.month - 1) // months * months + 1, 1)
    return first, month_end(add_months(first, months - 1))


def due_date(end: date, frequency: str) -> date:
    """A return is due at the end of the month after the period (three months for annual)."""
    return month_end(add_months(end, 3 if frequency == "annual" else 1))


class ReportService:
    """Read-only CRA-filing aggregates (income, GST/HST, T4A) for owners and admins."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        assert_role(principal, "owner", "admin", message="only an owner or admin can view reports")
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def _business(self) -> Business:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        return business

    async def income_summary(self, start: date, end: date) -> IncomeReport:
        lo, hi = period_bounds(start, end, ZoneInfo((await self._business()).timezone))
        return await self.income_summary_between(lo, hi)

    async def income_summary_between(self, lo: datetime, hi: datetime) -> IncomeReport:
        rows = await self.db.execute(
            self._legs(Account.category.in_(_CASH), Entry.event.in_(("payment", "refund")), lo, hi)
            .with_only_columns(Entry.event, Payment.method, func.sum(Entry.amount_cents))
            .join(Payment, Payment.id == Entry.source_id)
            .group_by(Entry.event, Payment.method)
        )
        gross = refunds = 0
        by_method: dict[str, int] = {}
        for entry_type, method, cents in rows.tuples().all():
            if entry_type == "refund":
                refunds -= int(cents)
            else:
                gross += int(cents)
            by_method[method] = by_method.get(method, 0) + int(cents)
        return IncomeReport(
            gross_cents=gross, refunds_cents=refunds, net_cents=gross - refunds, by_method=by_method
        )

    async def gst_hst_return(self, start: date, end: date) -> GstHstReport:
        business = await self._business()
        lo, hi = period_bounds(start, end, ZoneInfo(business.timezone))
        tax = await self._tax_by_code(lo, hi)
        return GstHstReport(
            tax_collected_cents=tax.get("GST", 0) + tax.get("HST", 0),
            pst_cents=tax.get("PST", 0),
            qst_cents=tax.get("QST", 0),
            taxable_sales_cents=await self.taxable_sales(lo, hi),
            gst_hst_number=business.gst_hst_number,
        )

    async def taxable_sales(self, lo: datetime, hi: datetime) -> int:
        """Sales before tax booked in the window (GST/HST line 101)."""
        sales = await self.db.execute(
            self._legs(
                Account.category.in_(("revenue", "deferred")),
                Entry.event.in_(("invoice", "payment", "refund", "forfeit", "reversal")),
                lo,
                hi,
            ).with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
        )
        return -int(sales.scalar_one())

    async def t4a_summary(self, year: int) -> list[T4ARow]:
        tz = ZoneInfo((await self._business()).timezone)
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
        paid = (
            self._legs(
                (Account.category == "payable") & (Account.code == "approved"),
                Entry.event == "staff_payment",
                start,
                end,
            )
            .with_only_columns(Account.owner_id, func.sum(Entry.amount_cents).label("total"))
            .group_by(Account.owner_id)
            .subquery()
        )
        rows = await self.db.execute(
            select(paid.c.owner_id, User.name, paid.c.total)
            .join(Staff, Staff.id == paid.c.owner_id)
            .join(User, User.id == Staff.user_id, isouter=True)
            .order_by(paid.c.owner_id)
        )
        return [
            T4ARow(staff_id=staff_id, name=name or _UNNAMED_PAYEE, total_cents=int(total))
            for staff_id, name, total in rows.tuples().all()
            if total
        ]

    def _legs(
        self,
        account: ColumnElement[bool],
        entry: ColumnElement[bool] | None,
        lo: datetime,
        hi: datetime,
    ) -> Select[tuple[Entry]]:
        stmt = (
            scoped(Entry, self.biz)
            .join(Account, Account.id == Entry.account_id)
            .where(account, Entry.occurred_at >= lo, Entry.occurred_at < hi)
        )
        return stmt if entry is None else stmt.where(entry)

    async def sales_by_item(self, start: date, end: date) -> list[SalesByItemRow]:
        """Catalog lines on paid sales and invoices in the period, with full refunds apart."""
        lo, hi = period_bounds(start, end, ZoneInfo((await self._business()).timezone))
        sold: dict[str, list[float]] = {}
        for fk, parent, status, at in (
            (Line.order_id, Order, ledger.order_status_expr(), ledger.order_paid_at_expr()),
            (Line.invoice_id, Invoice, ledger.invoice_status_expr(), Invoice.issued_at),
        ):
            rows = await self.db.execute(
                scoped(Line, self.biz)
                .with_only_columns(
                    Line.item_id, Line.quantity, Line.amount_cents, Line.tax_amount_cents, status
                )
                .join(parent, parent.id == fk)
                .where(
                    Line.item_id.isnot(None),
                    status.in_(("paid", "refunded")),
                    at >= lo,
                    at <= hi,
                )
            )
            for item_id, quantity, amount, tax, parent_status in rows.tuples().all():
                assert item_id is not None
                totals = sold.setdefault(item_id, [0.0, 0, 0, 0])
                totals[0] += float(quantity)
                totals[1] += amount
                totals[2] += tax
                if parent_status == "refunded":
                    totals[3] += amount
        if not sold:
            return []
        items = await self.db.execute(scoped(Item, self.biz).where(Item.id.in_(sold)))
        names = {item.id: (item.name, item.kind) for item in items.scalars().all()}
        out = [
            SalesByItemRow(
                item_id=item_id,
                name=names[item_id][0],
                kind=names[item_id][1],
                quantity=t[0],
                sales_cents=int(t[1]),
                tax_cents=int(t[2]),
                refunded_cents=int(t[3]),
            )
            for item_id, t in sold.items()
        ]
        return sorted(out, key=lambda r: (-r.sales_cents, r.name))

    async def sales_by_item_csv(self, start: date, end: date) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["item", "kind", "quantity", "sales_cents", "tax_cents", "refunded_cents"])
        for r in await self.sales_by_item(start, end):
            writer.writerow(
                [r.name, r.kind, f"{r.quantity:g}", r.sales_cents, r.tax_cents, r.refunded_cents]
            )
        return buf.getvalue()

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
        writer.writerow(
            [
                "tax_collected_cents",
                "pst_cents",
                "qst_cents",
                "taxable_sales_cents",
                "gst_hst_number",
            ]
        )
        writer.writerow(
            [
                report.tax_collected_cents,
                report.pst_cents,
                report.qst_cents,
                report.taxable_sales_cents,
                report.gst_hst_number,
            ]
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

    async def summary(self, start: date, end: date) -> ReportSummary:
        """Every report for one period in a single read, plus net sales by month."""
        business = await self._business()
        tz = ZoneInfo(business.timezone)
        lo, hi = period_bounds(start, end, tz)
        rates = rates_for_province(business.province)
        provincial = next((r for r in rates if r.jurisdiction in ("PST", "QST")), None)
        tax = await self._tax_by_code(lo, hi)
        return ReportSummary(
            start=start,
            end=end,
            income=await self._income(lo, hi, tax),
            sales_by_item=await self.sales_by_item(start, end),
            gst_hst=await self.gst_hst_return(start, end),
            provincial=ProvincialReport(
                code=provincial.jurisdiction if provincial else None,
                rate_bps=provincial.rate_bps if provincial else None,
                taxable_cents=await self.provincial_base(lo, hi) if provincial else 0,
                collected_cents=tax.get(provincial.jurisdiction, 0) if provincial else 0,
                number=business.qst_number
                if provincial is not None and provincial.jurisdiction == "QST"
                else None,
            ),
            t4a_year=end.year,
            t4a=await self.t4a_payees(end.year),
            months=await self._months(end, tz),
            payouts=await self.payouts(lo, hi),
            rates=[
                ReportRate(code=r.jurisdiction, name=r.name, rate_bps=r.rate_bps) for r in rates
            ],
        )

    async def _tax_by_code(self, lo: datetime, hi: datetime) -> dict[str, int]:
        rows = await self.db.execute(
            self._legs(Account.category == "tax", Entry.event != "remittance", lo, hi)
            .with_only_columns(Account.code, func.sum(Entry.amount_cents))
            .group_by(Account.code)
        )
        return {code: -int(cents) for code, cents in rows.tuples().all() if cents}

    async def _income(self, lo: datetime, hi: datetime, tax: dict[str, int]) -> IncomeSummary:
        is_refund = Entry.event == "refund"
        revenue = await self.db.execute(
            self._legs(Account.category == "revenue", None, lo, hi)
            .with_only_columns(is_refund, func.sum(Entry.amount_cents))
            .group_by(is_refund)
        )
        net = refunds = 0
        for refund, cents in revenue.tuples().all():
            net -= int(cents)
            if refund:
                refunds += int(cents)
        tips = await self.db.execute(
            self._legs(
                Account.category == "payable", Entry.event == "tip", lo, hi
            ).with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
        )
        received = await self.income_summary_between(lo, hi)
        return IncomeSummary(
            sales_cents=net + refunds,
            refunds_cents=refunds,
            net_cents=net,
            tax_by_code=tax,
            tips_cents=-int(tips.scalar_one()),
            received_cents=received.net_cents,
            by_method=received.by_method,
        )

    async def provincial_base(self, lo: datetime, hi: datetime) -> int:
        """Lines that carried PST or QST on issued invoices and paid sales in the period."""
        total = 0
        for fk, parent, status, at in (
            (Line.order_id, Order, ledger.order_status_expr(), ledger.order_paid_at_expr()),
            (Line.invoice_id, Invoice, ledger.invoice_status_expr(), Invoice.issued_at),
        ):
            value = await self.db.execute(
                scoped(Line, self.biz)
                .with_only_columns(func.coalesce(func.sum(Line.amount_cents), 0))
                .join(parent, parent.id == fk)
                .where(
                    Line.tax_class == "standard",
                    Line.tax_amount_cents > 0,
                    status.notin_(("draft", "void", "open")),
                    at >= lo,
                    at <= hi,
                )
            )
            total += int(value.scalar_one())
        return total

    async def _months(self, end: date, tz: ZoneInfo) -> list[MonthNet]:
        lo, hi = period_bounds(date(end.year, 1, 1), end, tz)
        month = func.to_char(func.timezone(tz.key, Entry.occurred_at), "YYYY-MM")
        rows = await self.db.execute(
            self._legs(Account.category == "revenue", None, lo, hi)
            .with_only_columns(month, func.sum(Entry.amount_cents))
            .group_by(month)
        )
        net = {str(key): -int(cents) for key, cents in rows.tuples().all()}
        return [
            MonthNet(month=key, net_cents=net.get(key, 0))
            for key in (f"{end.year}-{m:02d}" for m in range(1, end.month + 1))
        ]

    async def payouts(self, lo: datetime, hi: datetime) -> list[PayoutRow]:
        rows = await self.db.execute(
            self._legs(Account.category == "bank", Entry.event == "payout", lo, hi)
            .with_only_columns(Entry.journal_id, Entry.ref, Entry.amount_cents, Entry.available_at)
            .order_by(Entry.occurred_at.desc())
        )
        payouts = rows.tuples().all()
        failed = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(Entry.ref)
            .where(Entry.ref.in_([f"{ref}:failed" for _, ref, _, _ in payouts]))
        )
        returned = set(failed.scalars().all())
        return [
            PayoutRow(
                id=journal_id,
                amount_cents=int(cents),
                arrival_at=arrival,
                status="failed" if f"{ref}:failed" in returned else "paid",
            )
            for journal_id, ref, cents, arrival in payouts
        ]

    async def export_zip(self, kinds: list[ExportKind], start: date, end: date) -> bytes:
        """One ZIP of CSVs, a file per chosen report, named for the period."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for kind in dict.fromkeys(kinds):
                zf.writestr(f"{kind}-{start}-to-{end}.csv", await self.csv(kind, start, end))
        return buf.getvalue()

    async def csv(self, kind: ExportKind, start: date, end: date) -> str:
        if kind == "income":
            return await self.income_csv(start, end)
        if kind == "sales-by-item":
            return await self.sales_by_item_csv(start, end)
        if kind == "gst-hst":
            return await self.gst_hst_csv(start, end)
        if kind == "pst":
            return await self.pst_csv(start, end)
        if kind == "t4a":
            return await self.t4a_csv(end.year)
        return await self.payouts_csv(start, end)

    async def pst_csv(self, start: date, end: date) -> str:
        provincial = (await self.summary(start, end)).provincial
        return _csv(
            ["code", "rate_bps", "taxable_sales_cents", "collected_cents", "number"],
            [
                [
                    provincial.code or "",
                    provincial.rate_bps or 0,
                    provincial.taxable_cents,
                    provincial.collected_cents,
                    provincial.number or "",
                ]
            ],
        )

    async def payouts_csv(self, start: date, end: date) -> str:
        lo, hi = period_bounds(start, end, ZoneInfo((await self._business()).timezone))
        return _csv(
            ["payout", "arrival", "amount_cents", "status"],
            [
                [
                    p.id,
                    p.arrival_at.date().isoformat() if p.arrival_at else "",
                    p.amount_cents,
                    p.status,
                ]
                for p in await self.payouts(lo, hi)
            ],
        )

    async def t4a_payees(self, year: int) -> list[T4APayee]:
        tz = ZoneInfo((await self._business()).timezone)
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
        rows = await self.db.execute(
            self._legs(
                (Account.category == "payable") & (Account.code == "approved"),
                Entry.event == "staff_payment",
                start,
                end,
            )
            .with_only_columns(
                Account.owner_id,
                func.count(func.distinct(Entry.journal_id)),
                func.sum(Entry.amount_cents),
            )
            .group_by(Account.owner_id)
        )
        paid = {owner: (int(n), int(total)) for owner, n, total in rows.tuples().all() if total}
        if not paid:
            return []
        names = await self.db.execute(
            select(Staff.id, func.coalesce(Staff.name, User.name))
            .join(User, User.id == Staff.user_id, isouter=True)
            .where(Staff.id.in_(paid), Staff.business_id == self.biz)
        )
        named = {staff_id: name for staff_id, name in names.tuples().all()}
        return [
            T4APayee(
                staff_id=staff_id,
                name=named.get(staff_id) or _UNNAMED_PAYEE,
                payments=count,
                total_cents=total,
            )
            for staff_id, (count, total) in sorted(paid.items())
        ]


class DashboardService:
    """Read-only money aggregates for the Today dashboard, for owners and admins."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        assert_role(principal, "owner", "admin", message="only an owner or admin can view reports")
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def summary(self) -> DashboardSummary:
        # deferred: remittances builds on this module's period helpers
        from clientbridge.services.remittances import RemittanceService

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
            gst_hst_filing_due=await RemittanceService(self.db, self.principal).next_due(),
        )


def _csv(header: list[str], rows: list[list[object]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue()
