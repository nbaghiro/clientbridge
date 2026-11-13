import csv
import io
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message
from clientbridge.core.phones import e164
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business, User
from clientbridge.models.clients import Client, Consent, ConsentSource, ConsentStatus
from clientbridge.schemas.consents import ConsentExport


async def record_consent(
    db: AsyncSession,
    business_id: str,
    client_id: str | None,
    *,
    status: ConsentStatus,
    source: ConsentSource,
    recorded_by: str | None,
    expires_at: datetime | None = None,
    phone: str | None = None,
) -> Consent:
    row = Consent(
        id=new_id("consent"),
        business_id=business_id,
        client_id=client_id,
        status=status,
        source=source,
        recorded_by=recorded_by,
        expires_at=expires_at,
        phone=phone,
    )
    db.add(row)
    await db.flush()
    return row


async def latest_consents(
    db: AsyncSession, business_id: str, client_ids: Sequence[str]
) -> dict[str, Consent]:
    """The newest consent to offers per client; a START only lifts a STOP, so it isn't a yes."""
    rows = (
        (
            await db.execute(
                scoped(Consent, business_id)
                .where(
                    Consent.client_id.in_(client_ids),
                    ~((Consent.source == "reply") & (Consent.status == "granted")),
                )
                .order_by(Consent.client_id, Consent.created_at.desc(), Consent.id.desc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, Consent] = {}
    for row in rows:
        if row.client_id is not None:
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
    """Record an in-person yes or no, only where it changes the current state."""
    phone = await db.scalar(
        scoped(Client, business_id).with_only_columns(Client.phone).where(Client.id == client_id)
    )
    number = e164(phone) if phone else None
    if agreed and number is not None and await number_stopped(db, business_id, number):
        raise Conflict(
            "this client's number replied STOP; only a START from it turns texts back on",
            code="number_stopped",
        )
    current = (await latest_consents(db, business_id, [client_id])).get(client_id)
    # implied consent lapses, so an in-person yes on top of it is still worth recording
    express = current is not None and current.status == "granted"
    unchanged = express if agreed else not allows_marketing(current)
    if unchanged:
        return
    await record_consent(
        db,
        business_id,
        client_id,
        status="granted" if agreed else "withdrawn",
        source="in_person",
        recorded_by=recorded_by,
        phone=number,
    )


async def _stopped_numbers(
    db: AsyncSession, business_id: str, numbers: Collection[str]
) -> set[str]:
    rows = (
        await db.execute(
            scoped(Consent, business_id)
            .with_only_columns(Consent.phone, Consent.status)
            .where(Consent.phone.in_(numbers), Consent.source == "reply")
            .order_by(Consent.phone, Consent.created_at.desc(), Consent.id.desc())
        )
    ).all()
    newest: dict[str, str] = {}
    for number, status in rows:
        if number is not None:
            newest.setdefault(number, status)
    return {number for number, status in newest.items() if status == "withdrawn"}


async def stopped_clients(
    db: AsyncSession, business_id: str, client_ids: Sequence[str]
) -> set[str]:
    """Clients whose number last replied STOP rather than START."""
    phones = (
        await db.execute(
            scoped(Client, business_id)
            .with_only_columns(Client.id, Client.phone)
            .where(Client.id.in_(client_ids))
        )
    ).all()
    numbers = {client_id: e164(phone) for client_id, phone in phones if phone}
    wanted = {number for number in numbers.values() if number}
    stopped = await _stopped_numbers(db, business_id, wanted) if wanted else set[str]()
    return {client_id for client_id, number in numbers.items() if number in stopped}


async def number_stopped(db: AsyncSession, business_id: str, number: str) -> bool:
    """A STOP from the number blocks every text to it until it replies START."""
    return number in await _stopped_numbers(db, business_id, [number])


async def texts_stopped(db: AsyncSession, business_id: str, client_id: str) -> bool:
    """A STOP from the client's number blocks texts to them until the number replies START."""
    return client_id in await stopped_clients(db, business_id, [client_id])


async def record_text_reply(
    db: AsyncSession, business_id: str, client_id: str | None, number: str, *, stop: bool
) -> bool:
    """A STOP or START from the number, filed under its client if any; True when it changed."""
    if await number_stopped(db, business_id, number) == stop:
        return False
    await record_consent(
        db,
        business_id,
        client_id,
        status="withdrawn" if stop else "granted",
        source="reply",
        recorded_by=None,
        phone=number,
    )
    return True


def _cell(value: str) -> str:
    # a spreadsheet would run a leading =, +, - or @ as a formula
    return f"'{value}" if value[:1] in ("=", "+", "-", "@") else value


def _export_header(locale: str) -> list[str]:
    return [
        message(locale, "consent_csv.client"),
        message(locale, "consent_csv.phone"),
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
        """Every consent change (CASL record keeping), oldest first per client or number."""
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can export consent"
        )
        rows = (
            await self.db.execute(
                scoped(Consent, self.biz)
                .add_columns(Client.name, Client.phone, User.email)
                .outerjoin(Client, Client.id == Consent.client_id)
                .outerjoin(User, User.id == Consent.recorded_by)
                .order_by(
                    Client.name,
                    func.coalesce(Client.id, Consent.phone),
                    Consent.created_at,
                    Consent.id,
                )
            )
        ).all()
        locale = locale_for(
            business=await self.db.get(Business, self.biz),
            user=await self.db.get(User, self.principal.user_id),
        )
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(_export_header(locale))
        for consent, name, phone, recorded_by in rows:
            writer.writerow(
                [
                    _cell(name or ""),
                    consent.phone or phone or "",
                    consent.status,
                    consent.source,
                    consent.created_at.isoformat(),
                    consent.expires_at.isoformat() if consent.expires_at else "",
                    recorded_by or "",
                ]
            )
        day = clock.now().date().isoformat()
        return ConsentExport(filename=f"consent-log-{day}.csv", content=out.getvalue())
