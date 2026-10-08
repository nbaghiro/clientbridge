from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, PublicPrincipal, run_command
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.billing import Order
from clientbridge.schemas.orders import PublicOrderAlerts, PublicOrderStatus
from clientbridge.services import ledger
from clientbridge.services.lines import fetch_lines
from clientbridge.services.payments import has_pending_order_refund, refund_online_order
from clientbridge.services.public import (
    business_or_404,
    public_brand,
    public_doc_lines,
    resolve_by_token,
)


class PublicOrderService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def resolve(self, token: str) -> Order:
        order = await resolve_by_token(
            self.db, Order, Order.status_token == token, "order not found"
        )
        if order.source != "online":
            raise NotFound("order not found")
        return order

    async def view(self, token: str) -> PublicOrderStatus:
        order = await self.resolve(token)
        business = await business_or_404(self.db, order.business_id, "order not found")
        lines = await fetch_lines(self.db, order.business_id, "order", order.id)
        doc_lines, taxes = await public_doc_lines(self.db, order.business_id, lines)
        status, _ = await ledger.order_state(self.db, order)
        pending = await has_pending_order_refund(self.db, order)
        return PublicOrderStatus(
            pickup_from=order.pickup_from,
            pickup_to=order.pickup_to,
            address=str(business.brand.get("address")) if business.brand.get("address") else None,
            phone=str(business.brand.get("phone")) if business.brand.get("phone") else None,
            number=order.number,
            business_name=business.name,
            brand=public_brand(business),
            status=status,
            pickup_status=order.pickup_status,
            created_at=order.created_at,
            preparing_at=order.preparing_at,
            ready_at=order.ready_at,
            picked_up_at=order.picked_up_at,
            notify_sms=order.notify_sms,
            refund_pending=pending,
            can_cancel=status == "paid" and order.pickup_status == "unfulfilled" and not pending,
            receipt_token=order.receipt_token
            if status in ("paid", "partly_refunded", "refunded")
            else None,
            currency=order.currency,
            subtotal_cents=order.subtotal_cents,
            tax_total_cents=order.tax_total_cents,
            total_cents=order.total_cents,
            lines=[line for line, _ in doc_lines],
            taxes=taxes,
        )

    async def alerts(self, token: str, data: PublicOrderAlerts) -> PublicOrderStatus:
        order = await self.resolve(token)
        order.notify_sms = data.notify_sms
        await self.db.commit()
        return await self.view(token)

    async def cancel(self, token: str, gateway: PaymentGateway, key: str) -> PublicOrderStatus:
        order = await self.resolve(token)

        async def run(cmd: Command) -> PublicOrderStatus:
            locked = (
                await self.db.execute(
                    scoped(Order, order.business_id)
                    .where(Order.id == order.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one()
            status, _ = await ledger.order_state(self.db, locked)
            if status != "paid" or locked.pickup_status != "unfulfilled":
                raise Conflict("only a paid order that has not started preparation can be canceled")
            await refund_online_order(self.db, gateway, locked)
            cmd.record("order.cancel", entity_type="order", entity_id=locked.id)
            return await self.view(token)

        return await run_command(
            self.db,
            PublicPrincipal(order.business_id),
            action=f"order.cancel.{order.id}",
            run=run,
            response_model=PublicOrderStatus,
            idempotency_key=key,
        )
