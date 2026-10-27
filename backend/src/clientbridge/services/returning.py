import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.errors import (
    AppError,
    NotFound,
    TooManyRequests,
    Unauthorized,
    Unprocessable,
)
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for
from clientbridge.core.phones import e164, same_phone
from clientbridge.core.scoping import scoped
from clientbridge.core.security import hash_token
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business
from clientbridge.models.clients import Client, Subject
from clientbridge.models.returning import ReturningChallenge
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.returning import (
    ReturningChallengeOut,
    ReturningProfile,
    ReturningRequest,
    ReturningSubject,
    ReturningVerified,
    ReturningVerify,
    ReturningVisit,
)
from clientbridge.services.notifications import returning_code

_CODE_MINUTES = 10


def _digest(value: str) -> str:
    return hmac.new(get_settings().jwt_secret.encode(), value.encode(), hashlib.sha256).hexdigest()


class ReturningService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("booking page not found")
        return business

    async def request(
        self, slug: str, data: ReturningRequest, sms: SmsSender
    ) -> ReturningChallengeOut:
        business = await self._business(slug)
        number = e164(data.phone)
        if number is None:
            raise Unprocessable("enter a valid phone number with country code")
        if business.sms_number is None:
            raise AppError(
                "business has no assigned SMS number", code="sms_unassigned", status_code=503
            )
        destination = _digest(number)
        now = clock.now()
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"returning:{business.id}:{destination}"},
        )
        recent = (
            (
                await self.db.execute(
                    scoped(ReturningChallenge, business.id).where(
                        ReturningChallenge.destination_hash == destination,
                        ReturningChallenge.created_at > now - timedelta(minutes=15),
                    )
                )
            )
            .scalars()
            .all()
        )
        if len(recent) >= 3:
            raise TooManyRequests("please wait before requesting another code")
        clients = (
            (
                await self.db.execute(
                    scoped(Client, business.id, soft_delete=True)
                    .where(same_phone(Client.phone, number), Client.status == "active")
                    .limit(2)
                )
            )
            .scalars()
            .all()
        )
        challenge_id = new_id("returning_challenge")
        code = f"{secrets.randbelow(1_000_000):06d}"
        self.db.add(
            ReturningChallenge(
                id=challenge_id,
                business_id=business.id,
                client_id=clients[0].id if len(clients) == 1 else None,
                destination_hash=destination,
                code_hash=_digest(f"{challenge_id}:{code}"),
                expires_at=now + timedelta(minutes=_CODE_MINUTES),
                created_at=now,
            )
        )
        await self.db.commit()
        notice = returning_code(locale_for(business=business), code, _CODE_MINUTES)
        await sms.send(Sms(to=number, body=notice, from_number=business.sms_number))
        return ReturningChallengeOut(challenge_id=challenge_id)

    async def verify(self, slug: str, data: ReturningVerify) -> ReturningVerified:
        business = await self._business(slug)
        challenge = (
            await self.db.execute(
                scoped(ReturningChallenge, business.id)
                .where(
                    ReturningChallenge.id == data.challenge_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        now = clock.now()
        if (
            challenge is None
            or challenge.verified_at is not None
            or challenge.expires_at <= now
            or challenge.attempts >= 5
        ):
            raise Unauthorized("that code is invalid or expired")
        challenge.attempts += 1
        if not hmac.compare_digest(challenge.code_hash, _digest(f"{challenge.id}:{data.code}")):
            await self.db.commit()
            raise Unauthorized("that code is invalid or expired")
        challenge.verified_at = now
        client = await self._client(challenge)
        if client is None:
            await self.db.commit()
            return ReturningVerified(token=None, profile=None)
        token = secrets.token_urlsafe(32)
        challenge.session_hash = hash_token(token)
        challenge.session_expires_at = now + timedelta(minutes=30)
        profile = await self._profile(client)
        await self.db.commit()
        return ReturningVerified(token=token, profile=profile)

    async def _client(self, challenge: ReturningChallenge) -> Client | None:
        client = (
            await self.db.execute(
                scoped(Client, challenge.business_id, soft_delete=True).where(
                    Client.id == challenge.client_id,
                    Client.status == "active",
                )
            )
        ).scalar_one_or_none()
        if client is None:
            return None
        phone = e164(client.phone) if client.phone is not None else None
        if phone is None or not hmac.compare_digest(_digest(phone), challenge.destination_hash):
            return None
        return client

    async def resolve(self, business_id: str, token: str) -> Client:
        challenge = (
            await self.db.execute(
                scoped(ReturningChallenge, business_id).where(
                    ReturningChallenge.session_hash == hash_token(token),
                    ReturningChallenge.session_expires_at > clock.now(),
                    ReturningChallenge.verified_at.is_not(None),
                )
            )
        ).scalar_one_or_none()
        client = await self._client(challenge) if challenge is not None else None
        if client is None:
            raise Unauthorized("please verify your contact details again")
        return client

    async def subject(self, client: Client, subject_id: str) -> str:
        subject = (
            await self.db.execute(
                scoped(Subject, client.business_id, soft_delete=True).where(
                    Subject.id == subject_id,
                    Subject.client_id == client.id,
                )
            )
        ).scalar_one_or_none()
        if subject is None:
            raise Unprocessable("that subject is not available for this booking")
        return subject.id

    async def _profile(self, client: Client) -> ReturningProfile:
        subjects = (
            (
                await self.db.execute(
                    scoped(Subject, client.business_id, soft_delete=True)
                    .where(Subject.client_id == client.id)
                    .order_by(Subject.name)
                )
            )
            .scalars()
            .all()
        )
        booking = (
            await self.db.execute(
                scoped(Booking, client.business_id, soft_delete=True)
                .where(
                    Booking.client_id == client.id,
                    Booking.status == "completed",
                )
                .order_by(Booking.completed_at.desc().nulls_last(), Booking.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        slot = (
            None
            if booking is None
            else (
                await self.db.execute(
                    scoped(Slot, client.business_id).where(
                        Slot.id == booking.slot_id,
                    )
                )
            ).scalar_one_or_none()
        )
        last = (
            None
            if slot is None or booking is None
            else ReturningVisit(
                item_id=slot.item_id,
                staff_id=slot.staff_id,
                subject_id=booking.subject_id,
                starts_at=slot.starts_at,
            )
        )
        return ReturningProfile(
            name=client.name,
            phone=client.phone,
            subjects=[ReturningSubject(id=x.id, name=x.name) for x in subjects],
            last_visit=last,
        )
