import csv
import io
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import Item
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.schemas.payments import RemittanceSummary
from clientbridge.schemas.reports import GstHstReport, IncomeReport, SalesByItemRow, T4ARow
from clientbridge.services import ledger_service as ledger

_CASH = ("stripe", "bank", "cash")
_UNNAMED_PAYEE = "Unnamed payee"


def period_bounds(start: date, end: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """`[start, end]` day window in the business tz (00:00 to 23:59:59), as UTC instants for the
    ledger's `occurred_at` — a late-evening sale near a quarter edge must file in the business's
    local period, not UTC's."""
    return (
        datetime.combine(start, time.min, tzinfo=tz).astimezone(UTC),
        datetime.combine(end, time.max, tzinfo=tz).astimezone(UTC),
    )


def next_gst_filing(today: date) -> date:
    """Next CRA GST/HST remittance due date — quarterly filers remit one month after each quarter
    end (Apr 30 · Jul 31 · Oct 31 · Jan 31). A sensible default until filing frequency is stored."""
    due = [
        date(today.year, 1, 31),
        date(today.year, 4, 30),
        date(today.year, 7, 31),
        date(today.year, 10, 31),
        date(today.year + 1, 1, 31),
    ]
    return next(d for d in due if d >= today)


class ReportService:
    """Read-only CRA-filing aggregates (income, GST/HST, T4A) — owner/admin, gated at the route."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def _business(self) -> Business:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        return business

    async def remittance_summary(self) -> RemittanceSummary:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can view remittance"
        )
        return RemittanceSummary(
            tax_collected_cents=-await ledger.account_total(
                self.db, self.biz, Account.kind == "tax"
            )
        )

    async def income_summary(self, start: date, end: date) -> IncomeReport:
        lo, hi = period_bounds(start, end, ZoneInfo((await self._business()).timezone))
        rows = await self.db.execute(
            self._legs(Account.kind.in_(_CASH), Entry.type.in_(("payment", "refund")), lo, hi)
            .with_only_columns(Entry.type, Payment.method, func.sum(Entry.amount_cents))
            .join(Payment, Payment.id == Entry.source_id)
            .group_by(Entry.type, Payment.method)
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
        rows = await self.db.execute(
            self._legs(Account.kind == "tax", Entry.type != "remittance", lo, hi)
            .with_only_columns(Account.code, func.sum(Entry.amount_cents))
            .group_by(Account.code)
        )
        tax = {code: -int(cents) for code, cents in rows.tuples().all()}
        sales = await self.db.execute(
            self._legs(
                Account.kind.in_(("revenue", "deferred")),
                Entry.type.in_(("invoice", "payment", "refund", "forfeit", "reversal")),
                lo,
                hi,
            ).with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
        )
        return GstHstReport(
            tax_collected_cents=tax.get("GST", 0) + tax.get("HST", 0),
            pst_cents=tax.get("PST", 0),
            qst_cents=tax.get("QST", 0),
            taxable_sales_cents=-int(sales.scalar_one()),
            gst_hst_number=business.gst_hst_number,
        )

    async def t4a_summary(self, year: int) -> list[T4ARow]:
        tz = ZoneInfo((await self._business()).timezone)
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
        paid = (
            self._legs(
                (Account.kind == "payable") & (Account.code == "approved"),
                Entry.type == "staff_payment",
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
        """What sold: catalog lines on paid sales (by payment time) and paid invoices (by issue
        time, like the GST/HST return), with full refunds shown apart."""
        lo, hi = period_bounds(start, end, ZoneInfo((await self._business()).timezone))
        sold: dict[str, list[float]] = {}
        for parent_type, parent, status, at in (
            ("order", Order, Order.status, Order.paid_at),
            ("invoice", Invoice, Invoice.status, Invoice.issued_at),
        ):
            rows = await self.db.execute(
                scoped(Line, self.biz)
                .with_only_columns(
                    Line.item_id, Line.quantity, Line.amount_cents, Line.tax_amount_cents, status
                )
                .join(parent, parent.id == Line.parent_id)
                .where(
                    Line.parent_type == parent_type,
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
