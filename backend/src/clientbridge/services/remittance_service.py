from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.identity import Business
from clientbridge.models.ledger import Account, Entry
from clientbridge.schemas.payments import RemittanceIn, RemittanceOut
from clientbridge.services import ledger_service as ledger
from clientbridge.services.ledger_service import Leg
from clientbridge.services.report_service import period_bounds


class RemittanceService:
    """Filing a sales-tax return: the period's net tax leaves tax payable for the bank."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def record(self, data: RemittanceIn, idempotency_key: str | None) -> RemittanceOut:
        assert_role(self.principal, "owner", "admin", message="only an owner or admin can file tax")
        if data.period_end < data.period_start:
            raise AppError(
                "the period ends before it starts", status_code=422, code="invalid_period"
            )
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        tz = ZoneInfo(business.timezone)
        if data.period_end >= datetime.now(tz).date():
            raise AppError(
                "a return can only cover days that have ended",
                status_code=422,
                code="invalid_period",
            )
        lo, hi = period_bounds(data.period_start, data.period_end, tz)

        async def run(cmd: Command) -> RemittanceOut:
            await self.db.execute(
                select(Business.id).where(Business.id == self.biz).with_for_update()
            )
            if await self._overlaps(data):
                raise Conflict("this period overlaps a return that was already filed")
            owed = await self._owed(lo, hi)
            total = sum(owed.values())
            if total <= 0:
                raise Conflict("no tax is owed for this period")
            await ledger.post(
                self.db,
                self.biz,
                type="remittance",
                ref=f"remittance:{self.biz}:{data.period_start}:{data.period_end}",
                legs=[
                    *(
                        Leg("business", self.biz, "tax", cents, code)
                        for code, cents in owed.items()
                    ),
                    Leg("business", self.biz, "bank", -total),
                ],
                meta={"start": data.period_start.isoformat(), "end": data.period_end.isoformat()},
                occurred_at=datetime.now(UTC),
            )
            cmd.record("tax.remit", entity_type="business", entity_id=self.biz)
            return RemittanceOut(
                period_start=data.period_start,
                period_end=data.period_end,
                by_code=owed,
                total_cents=total,
            )

        return await run_command(
            self.db,
            self.principal,
            action="tax.remit",
            run=run,
            response_model=RemittanceOut,
            idempotency_key=idempotency_key,
        )

    async def _owed(self, lo: datetime, hi: datetime) -> dict[str, int]:
        rows = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(Account.code, func.sum(Entry.amount_cents))
            .join_from(Entry, Account, Account.id == Entry.account_id)
            .where(
                Account.kind == "tax",
                Entry.type != "remittance",
                Entry.occurred_at >= lo,
                Entry.occurred_at < hi,
            )
            .group_by(Account.code)
        )
        return {code: -int(cents) for code, cents in rows.tuples().all() if cents != 0}

    async def _overlaps(self, data: RemittanceIn) -> bool:
        filed = await self.db.execute(
            scoped(Entry, self.biz)
            .with_only_columns(Entry.meta)
            .where(Entry.type == "remittance", Entry.leg == 0)
        )
        start, end = data.period_start.isoformat(), data.period_end.isoformat()
        return any(
            str(meta.get("start")) <= end and start <= str(meta.get("end"))
            for meta in filed.scalars().all()
        )
