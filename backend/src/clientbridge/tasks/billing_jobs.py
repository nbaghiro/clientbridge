from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.email import get_email_sender
from clientbridge.integrations.push import get_push_sender
from clientbridge.integrations.sms import get_sms_sender
from clientbridge.models.billing import Invoice
from clientbridge.services.notification_service import Notifier


async def run_overdue_sweep(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Flag each sent invoice past its due date with an outstanding balance `overdue` and notify the
    client once. Idempotent — the status transition is the dedup marker (an `overdue` row no longer
    matches `status == "sent"`), so a re-run never re-notifies."""
    invoices = (
        (
            await db.execute(
                select(Invoice).where(
                    Invoice.status == "sent",
                    Invoice.due_at < now,
                    Invoice.balance_cents > 0,
                )
            )
        )
        .scalars()
        .all()
    )
    for invoice in invoices:
        invoice.status = "overdue"
        await notifier.on_invoice_overdue(db, invoice.id)
    await db.commit()
    return len(invoices)


async def sweep_overdue_invoices(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan; each overdue notice resolves its own business + locale."""
    async with SessionLocal() as db:
        notifier = Notifier(get_email_sender(), get_sms_sender(), get_push_sender())
        return await run_overdue_sweep(db, notifier, datetime.now(UTC))
