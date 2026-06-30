from datetime import UTC, datetime

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.email import get_email_sender
from clientbridge.integrations.sms import get_sms_sender
from clientbridge.services.message_service import run_due_broadcasts


async def send_due_broadcasts(ctx: dict[str, object]) -> int:
    """arq cron entry — fan out scheduled broadcasts whose send time has arrived."""
    async with SessionLocal() as db:
        return await run_due_broadcasts(db, get_sms_sender(), get_email_sender(), datetime.now(UTC))
