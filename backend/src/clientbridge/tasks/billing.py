from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.messaging import (
    get_email_sender,
    get_push_sender,
    get_sms_sender,
)
from clientbridge.models.billing import Invoice
from clientbridge.services.ledger import invoice_status_expr
from clientbridge.services.notifications import Notifier


async def run_overdue_sweep(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Notify the client once for each sent, unpaid invoice past due."""
    invoices = (
        (
            await db.execute(
                select(Invoice).where(
                    Invoice.due_at < now,
                    Invoice.overdue_notified_at.is_(None),
                    invoice_status_expr() == "sent",
                )
            )
        )
        .scalars()
        .all()
    )
    for invoice in invoices:
        invoice.overdue_notified_at = now
        await notifier.on_invoice_overdue(db, invoice.id)
    await db.commit()
    return len(invoices)


async def sweep_overdue_invoices(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan; each overdue notice resolves its own business + locale."""
    async with SessionLocal() as db:
        notifier = Notifier(get_email_sender(), get_sms_sender(), get_push_sender())
        return await run_overdue_sweep(db, notifier, datetime.now(UTC))
