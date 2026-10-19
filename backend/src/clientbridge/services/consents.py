import base64
import csv
import hashlib
import hmac
import io
from collections.abc import Sequence
from datetime import datetime
from typing import get_args

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business, User
from clientbridge.models.clients import Channel, Client, Consent, ConsentSource, ConsentStatus
from clientbridge.schemas.consents import ConsentExport


async def record_consent(
    db: AsyncSession,
    business_id: str,
    client_id: str,
    *,
    channel: Channel,
    status: ConsentStatus,
    source: ConsentSource,
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
    db: AsyncSession, business_id: str, client_ids: Sequence[str], channel: Channel
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
        return consent.expires_at > (now or clock.now())
    return True


async def set_marketing_consent(
    db: AsyncSession, business_id: str, client_id: str, *, agreed: bool, recorded_by: str | None
) -> None:
    """Record an in-person yes or no on both channels, only where it changes the current state."""
    stopped = await stopped_clients(db, business_id, [client_id])
    for channel in get_args(Channel):
        if agreed and channel == "sms" and client_id in stopped:
            continue  # only the client's own START reply lifts a STOP
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


async def set_channel_consent(
    db: AsyncSession, client: Client, channel: Channel, *, agreed: bool, source: ConsentSource
) -> bool:
    """Record a yes or no on one channel when it changes the current state; True if it did."""
    if agreed and channel == "sms" and await texts_stopped(db, client.business_id, client.id):
        return False
    current = (await latest_consents(db, client.business_id, [client.id], channel)).get(client.id)
    if allows_marketing(current) == agreed:
        return False
    await record_consent(
        db,
        client.business_id,
        client.id,
        channel=channel,
        status="granted" if agreed else "withdrawn",
        source=source,
        recorded_by=None,
    )
    return True


async def stopped_clients(
    db: AsyncSession, business_id: str, client_ids: Sequence[str]
) -> set[str]:
    """Clients whose newest text reply was STOP: only their START reply lifts it."""
    rows = (
        await db.execute(
            scoped(Consent, business_id)
            .with_only_columns(Consent.client_id, Consent.status)
            .where(
                Consent.client_id.in_(client_ids),
                Consent.channel == "sms",
                Consent.source == "reply",
            )
            .order_by(Consent.client_id, Consent.created_at.desc(), Consent.id.desc())
        )
    ).all()
    newest: dict[str, str] = {}
    for client_id, status in rows:
        newest.setdefault(client_id, status)
    return {client_id for client_id, status in newest.items() if status == "withdrawn"}


async def emails_withdrawn(db: AsyncSession, business_id: str, client_id: str) -> bool:
    latest = (await latest_consents(db, business_id, [client_id], "email")).get(client_id)
    return latest is not None and latest.status == "withdrawn"


async def texts_stopped(db: AsyncSession, business_id: str, client_id: str) -> bool:
    """A STOP reply blocks every text to the client until they reply START."""
    return client_id in await stopped_clients(db, business_id, [client_id])


async def record_text_reply(db: AsyncSession, client: Client, *, stop: bool) -> bool:
    """A STOP reply blocks texts until START; True when it changed the client's state."""
    if stop == await texts_stopped(db, client.business_id, client.id):
        return False
    await record_consent(
        db,
        client.business_id,
        client.id,
        channel="sms",
        status="withdrawn" if stop else "granted",
        source="reply",
        recorded_by=None,
    )
    return True


async def record_complaint(db: AsyncSession, client: Client) -> bool:
    """A spam complaint withdraws email marketing; True unless one is already on record."""
    latest = (await latest_consents(db, client.business_id, [client.id], "email")).get(client.id)
    if latest is not None and latest.status == "withdrawn" and latest.source == "complaint":
        return False
    await record_consent(
        db,
        client.business_id,
        client.id,
        channel="email",
        status="withdrawn",
        source="complaint",
        recorded_by=None,
    )
    return True


def _prefs_signature(client_id: str) -> str:
    key = get_settings().jwt_secret.encode()
    digest = hmac.new(key, f"prefs:{client_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:18]).decode()


def prefs_token(client_id: str) -> str:
    """The per-client link token for the message preferences page; it never expires (CASL)."""
    return f"{client_id}.{_prefs_signature(client_id)}"


def prefs_url(client_id: str) -> str:
    return f"{get_settings().connect_base_url}/prefs/{prefs_token(client_id)}"


def client_id_for_prefs(token: str) -> str | None:
    client_id, _, signature = token.rpartition(".")
    if not client_id or not hmac.compare_digest(signature, _prefs_signature(client_id)):
        return None
    return client_id


def _cell(value: str) -> str:
    # a spreadsheet would run a leading =, +, - or @ as a formula
    return f"'{value}" if value[:1] in ("=", "+", "-", "@") else value


def _export_header(locale: str) -> list[str]:
    return [
        message(locale, "consent_csv.client"),
        message(locale, "consent_csv.email"),
        message(locale, "consent_csv.phone"),
        message(locale, "consent_csv.channel"),
        message(locale, "consent_csv.status"),
        message(locale, "consent_csv.source"),
        message(locale, "consent_csv.recorded_at"),
        message(locale, "consent_csv.expires_at"),
        message(locale, "consent_csv.recorded_by"),
    ]


class ConsentService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def export(self) -> ConsentExport:
        """Every consent change on record (CASL record keeping), oldest first per client."""
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can export consent"
        )
        rows = (
            await self.db.execute(
                scoped(Consent, self.biz)
                .add_columns(Client.name, Client.email, Client.phone, User.email)
                .join(Client, Client.id == Consent.client_id)
                .outerjoin(User, User.id == Consent.recorded_by)
                .order_by(Client.name, Client.id, Consent.created_at, Consent.id)
            )
        ).all()
        locale = locale_for(
            business=await self.db.get(Business, self.biz),
            user=await self.db.get(User, self.principal.user_id),
        )
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(_export_header(locale))
        for consent, name, email, phone, recorded_by in rows:
            writer.writerow(
                [
                    _cell(name),
                    _cell(email or ""),
                    phone or "",
                    consent.channel,
                    consent.status,
                    consent.source,
                    consent.created_at.isoformat(),
                    consent.expires_at.isoformat() if consent.expires_at else "",
                    recorded_by or "",
                ]
            )
        day = clock.now().date().isoformat()
        return ConsentExport(filename=f"consent-log-{day}.csv", content=out.getvalue())
