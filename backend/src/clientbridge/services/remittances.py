from datetime import UTC, date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business
from clientbridge.models.ledger import Account, Entry
from clientbridge.schemas.payments import (
    FiledReturn,
    FilingPeriod,
    RemittanceIn,
    RemittanceOut,
    TaxFamily,
    TaxFilings,
)
from clientbridge.services import ledger
from clientbridge.services.ledger import Leg
from clientbridge.services.reports import (
    ReportService,
    add_months,
    due_date,
    period_bounds,
    period_of,
)
from clientbridge.services.tax import rates_for_province

FAMILY_CODES: dict[str, tuple[str, ...]] = {
    "federal": ("GST", "HST"),
    "provincial": ("PST", "QST"),
}
_HISTORY_YEARS = 2


def _covers(meta: dict[str, object], family: str | None) -> bool:
    filed = meta.get("family")
    return family is None or filed is None or filed == family


class RemittanceService:
    """Filing a sales-tax return: the period's net tax leaves tax payable for the bank."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        assert_role(principal, "owner", "admin", message="only an owner or admin can file tax")
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.reports = ReportService(db, principal)

    async def _business(self) -> Business:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        return business

    async def record(self, data: RemittanceIn, idempotency_key: str | None) -> RemittanceOut:
        if data.period_end < data.period_start:
            raise AppError(
                "the period ends before it starts", status_code=422, code="invalid_period"
            )
        if data.itc_cents and data.family == "provincial":
            raise AppError(
                "input tax credits are claimed on the GST/HST return",
                status_code=422,
                code="invalid_itc",
            )
        business = await self._business()
        tz = ZoneInfo(business.timezone)
        today = datetime.now(tz).date()
        if data.period_end >= today:
            raise AppError(
                "a return can only cover days that have ended",
                status_code=422,
                code="invalid_period",
            )
        filed_on = data.filed_on or today
        if filed_on > today:
            raise AppError(
                "the filing date can't be in the future", status_code=422, code="invalid_filed_on"
            )
        lo, hi = period_bounds(data.period_start, data.period_end, tz)
        family = data.family

        async def run(cmd: Command) -> RemittanceOut:
            await self.db.execute(
                select(Business.id).where(Business.id == self.biz).with_for_update()
            )
            if await self._overlaps(data.period_start, data.period_end, family):
                raise Conflict("this period overlaps a return that was already filed")
            owed = await self._owed(lo, hi, family)
            total = sum(owed.values())
            if total <= 0:
                raise Conflict("no tax is owed for this period")
            federal = sum(owed.get(code, 0) for code in FAMILY_CODES["federal"])
            if data.itc_cents > federal:
                raise AppError(
                    "input tax credits can't be more than the GST/HST collected",
                    status_code=422,
                    code="invalid_itc",
                )
            paid = total - data.itc_cents
            credit_code = next((c for c in FAMILY_CODES["federal"] if c in owed), "GST")
            scope = family or "all"
            await ledger.post(
                self.db,
                self.biz,
                event="remittance",
                ref=f"remittance:{self.biz}:{scope}:{data.period_start}:{data.period_end}",
                legs=[
                    *(
                        Leg("business", self.biz, "tax", cents, code)
                        for code, cents in sorted(owed.items())
                    ),
                    Leg("business", self.biz, "itc", -data.itc_cents, credit_code),
                    Leg("business", self.biz, "bank", -paid),
                ],
                meta={
                    "start": data.period_start.isoformat(),
                    "end": data.period_end.isoformat(),
                    "family": family,
                    "itc_cents": data.itc_cents,
                    "confirmation": data.confirmation,
                    "filed_on": filed_on.isoformat(),
                },
                occurred_at=datetime.now(UTC),
            )
            cmd.record("tax.remit", entity_type="business", entity_id=self.biz)
            return RemittanceOut(
                period_start=data.period_start,
                period_end=data.period_end,
                family=family,
                by_code=owed,
                itc_cents=data.itc_cents,
                total_cents=paid,
                confirmation=data.confirmation,
                filed_on=filed_on,
            )

        return await run_command(
            self.db,
            self.principal,
            action="tax.remit",
            run=run,
            response_model=RemittanceOut,
            idempotency_key=idempotency_key,
        )

    async def _ranges(self, business: Business, today: date) -> list[tuple[date, date]]:
        """Every filing period from the first tax booked (two years at most), oldest first."""
        tz = ZoneInfo(business.timezone)
        first = await self._first_tax_day(tz)
        earliest = date(today.year - _HISTORY_YEARS + 1, 1, 1)
        start = period_of(max(first or today, earliest), business.filing_frequency)[0]
        ranges: list[tuple[date, date]] = []
        while start <= today:
            ranges.append(period_of(start, business.filing_frequency))
            start = add_months(ranges[-1][1], 1)
        return ranges

    async def next_due(self) -> date | None:
        """The oldest ended period without a GST/HST return, else the one in progress."""
        business = await self._business()
        if not business.tax_registered:
            return None
        today = datetime.now(ZoneInfo(business.timezone)).date()
        filed = await self.filed_returns()
        ranges = await self._ranges(business, today)
        for start, end in ranges:
            done = any(
                r.family in (None, "federal") and r.period_start <= end and start <= r.period_end
                for r in filed
            )
            if end < today and not done:
                return due_date(end, business.filing_frequency)
        return due_date(ranges[-1][1], business.filing_frequency) if ranges else None

    async def filings(self) -> TaxFilings:
        business = await self._business()
        tz = ZoneInfo(business.timezone)
        today = datetime.now(tz).date()
        frequency = business.filing_frequency
        rates = rates_for_province(business.province)
        federal = next((r for r in rates if r.jurisdiction in FAMILY_CODES["federal"]), None)
        provincial = next((r for r in rates if r.jurisdiction in FAMILY_CODES["provincial"]), None)
        filed = await self.filed_returns()
        periods = [
            await self._period(start, end, frequency, today, tz, filed)
            for start, end in reversed(await self._ranges(business, today))
        ]
        set_aside = await self._set_aside()
        return TaxFilings(
            frequency=frequency,
            registered=business.tax_registered,
            federal_code=federal.jurisdiction if federal else None,
            provincial_code=provincial.jurisdiction if provincial else None,
            provincial_rate_bps=provincial.rate_bps if provincial else None,
            gst_hst_number=business.gst_hst_number,
            qst_number=business.qst_number,
            federal_set_aside_cents=sum(set_aside.get(code, 0) for code in FAMILY_CODES["federal"]),
            provincial_set_aside_cents=sum(
                set_aside.get(code, 0) for code in FAMILY_CODES["provincial"]
            ),
            next_due=await self.next_due(),
            periods=periods,
        )

    async def filed_returns(self) -> list[FiledReturn]:
        rows = await self.db.execute(
            scoped(Entry, self.biz)
            .add_columns(Account)
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.event == "remittance")
            .order_by(Entry.occurred_at, Entry.leg)
        )
        grouped: dict[str, FiledReturn] = {}
        for entry, account in rows.tuples().all():
            meta = entry.meta
            found = grouped.get(entry.journal_id)
            if found is None:
                fam = meta.get("family")
                found = FiledReturn(
                    id=entry.journal_id,
                    family="federal" if fam == "federal" else "provincial" if fam else None,
                    period_start=date.fromisoformat(str(meta.get("start"))),
                    period_end=date.fromisoformat(str(meta.get("end"))),
                    by_code={},
                    itc_cents=int(str(meta.get("itc_cents") or 0)),
                    paid_cents=0,
                    confirmation=str(meta["confirmation"]) if meta.get("confirmation") else None,
                    filed_on=date.fromisoformat(
                        str(meta.get("filed_on") or entry.occurred_at.date().isoformat())
                    ),
                )
                grouped[entry.journal_id] = found
            if account.category == "tax":
                found.by_code[account.code] = entry.amount_cents
            elif account.category == "bank":
                found.paid_cents = -entry.amount_cents
        return list(grouped.values())

    async def _period(
        self,
        start: date,
        end: date,
        frequency: str,
        today: date,
        tz: ZoneInfo,
        filed: list[FiledReturn],
    ) -> FilingPeriod:
        lo, hi = period_bounds(start, end, tz)
        owed = await self._owed(lo, hi, None)
        returns = [r for r in filed if r.period_start <= end and start <= r.period_end]

        def status(family: TaxFamily) -> Literal["open", "due", "filed"]:
            if any(r.family in (None, family) for r in returns):
                return "filed"
            return "open" if end >= today else "due"

        provincial_cents = sum(owed.get(c, 0) for c in FAMILY_CODES["provincial"])
        provincial = status("provincial")
        return FilingPeriod(
            start=start,
            end=end,
            due=due_date(end, frequency),
            federal_cents=sum(owed.get(c, 0) for c in FAMILY_CODES["federal"]),
            provincial_cents=provincial_cents,
            taxable_cents=await self.reports.taxable_sales(lo, hi),
            provincial_taxable_cents=await self.reports.provincial_base(lo, hi),
            federal_status=status("federal"),
            provincial_status="none"
            if provincial_cents == 0 and provincial != "filed"
            else provincial,
            returns=returns,
        )

    async def _owed(self, lo: datetime, hi: datetime, family: str | None) -> dict[str, int]:
        stmt = (
            scoped(Entry, self.biz)
            .with_only_columns(Account.code, func.sum(Entry.amount_cents))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(
                Account.category == "tax",
                Entry.event != "remittance",
                Entry.occurred_at >= lo,
                Entry.occurred_at < hi,
            )
            .group_by(Account.code)
        )
        if family is not None:
            stmt = stmt.where(Account.code.in_(FAMILY_CODES[family]))
        rows = await self.db.execute(stmt)
        return {code: -int(cents) for code, cents in rows.tuples().all() if cents != 0}

    async def _set_aside(self) -> dict[str, int]:
        rows = await self.db.execute(
            scoped(Account, self.biz)
            .with_only_columns(Account.code, func.sum(Account.balance_cents))
            .where(Account.category == "tax")
            .group_by(Account.code)
        )
        return {code: -int(cents) for code, cents in rows.tuples().all()}

    async def _first_tax_day(self, tz: ZoneInfo) -> date | None:
        first = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(func.min(Entry.occurred_at))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(Account.category == "tax")
        )
        at = first.scalar_one()
        return at.astimezone(tz).date() if at is not None else None

    async def _overlaps(self, start: date, end: date, family: str | None) -> bool:
        filed = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(Entry.meta)
            .where(Entry.event == "remittance", Entry.leg == 0)
        )
        lo, hi = start.isoformat(), end.isoformat()
        return any(
            str(meta.get("start")) <= hi and lo <= str(meta.get("end")) and _covers(meta, family)
            for meta in filed.scalars().all()
        )
