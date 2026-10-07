from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Consent


async def record_consent(
    db: AsyncSession,
    business_id: str,
    client_id: str,
    *,
    channel: str,
    status: str,
    source: str,
    recorded_by: str | None,
    expires_at: datetime | None = None,
) -> Consent:
    row = Consent(
        id=new_id("consent"),
        business_id=business_id,
        client_id=client_id,
        channel=channel,
        status=status,
        source=source,
        recorded_by=recorded_by,
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return row


async def latest_consents(
    db: AsyncSession, business_id: str, client_ids: Sequence[str], channel: str
) -> dict[str, Consent]:
    """The newest consent row per client on one channel (no row means never asked)."""
    rows = (
        (
            await db.execute(
                scoped(Consent, business_id)
                .where(Consent.client_id.in_(client_ids), Consent.channel == channel)
                .order_by(Consent.client_id, Consent.created_at.desc(), Consent.id.desc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, Consent] = {}
    for row in rows:
        latest.setdefault(row.client_id, row)
    return latest


def allows_marketing(consent: Consent | None, now: datetime | None = None) -> bool:
    if consent is None or consent.status == "withdrawn":
        return False
    if consent.status == "implied" and consent.expires_at is not None:
        return consent.expires_at > (now or datetime.now(UTC))
    return True


async def set_marketing_consent(
    db: AsyncSession, business_id: str, client_id: str, *, agreed: bool, recorded_by: str | None
) -> None:
    """Record an in-person yes or no on both channels, only where it changes the current state."""
    for channel in ("sms", "email"):
        current = (await latest_consents(db, business_id, [client_id], channel)).get(client_id)
        if allows_marketing(current) == agreed:
            continue
        await record_consent(
            db,
            business_id,
            client_id,
            channel=channel,
            status="granted" if agreed else "withdrawn",
            source="in_person",
            recorded_by=recorded_by,
        )
