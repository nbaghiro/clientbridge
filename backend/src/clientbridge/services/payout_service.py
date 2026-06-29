from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.models.payments import PayoutAllocation
from clientbridge.schemas.payouts import PayoutAllocationOut


class PayoutService:
    """Manual payout-allocation lifecycle: pending → approved → paid (no Stripe transfer)."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def approve_allocation(
        self, allocation_id: str, idempotency_key: str | None = None
    ) -> PayoutAllocationOut:
        self._assert_admin()
        alloc = await self._allocation(allocation_id)

        async def run(cmd: Command) -> PayoutAllocationOut:
            if alloc.status != "pending":
                raise Conflict("only a pending allocation can be approved")
            alloc.status = "approved"
            await self.db.flush()
            cmd.record("payout.approve", entity_type="payout_allocation", entity_id=alloc.id)
            return _out(alloc)

        return await run_command(
            self.db,
            self.principal,
            action="payout.approve",
            run=run,
            response_model=PayoutAllocationOut,
            idempotency_key=idempotency_key,
        )

    async def pay_allocation(
        self, allocation_id: str, idempotency_key: str | None = None
    ) -> PayoutAllocationOut:
        self._assert_admin()
        alloc = await self._allocation(allocation_id)

        async def run(cmd: Command) -> PayoutAllocationOut:
            if alloc.status != "approved":
                raise Conflict("only an approved allocation can be paid")
            alloc.status = "paid"
            await self.db.flush()
            cmd.record("payout.pay", entity_type="payout_allocation", entity_id=alloc.id)
            return _out(alloc)

        return await run_command(
            self.db,
            self.principal,
            action="payout.pay",
            run=run,
            response_model=PayoutAllocationOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can manage payouts")

    async def _allocation(self, allocation_id: str) -> PayoutAllocation:
        row = (
            await self.db.execute(
                scoped(PayoutAllocation, self.biz).where(PayoutAllocation.id == allocation_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("payout allocation not found")
        return row


def _out(alloc: PayoutAllocation) -> PayoutAllocationOut:
    return PayoutAllocationOut(
        id=alloc.id, staff_id=alloc.staff_id, amount_cents=alloc.amount_cents, status=alloc.status
    )
