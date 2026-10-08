import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import NotFound, TooManyRequests, Unauthorized, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.security import hash_token
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.business import Business
from clientbridge.models.clients import Client, Subject
from clientbridge.models.returning import ReturningChallenge
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.returning import (
    ReturningChallengeOut,
    ReturningPet,
    ReturningProfile,
    ReturningRequest,
    ReturningVerified,
    ReturningVerify,
    ReturningVisit,
)
from clientbridge.services.notifications import returning_code


def _digest(value: str) -> str:
    return hmac.new(get_settings().jwt_secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def _phone(value: str) -> str | None:
    digits = re.sub(r"[^0-9]", "", value)
    if len(digits) == 10 and not value.startswith("+"):
        digits = "1" + digits
    if 8 <= len(digits) <= 15 and (
        value.startswith("+") or (len(digits) == 11 and digits.startswith("1"))
    ):
        return "+" + digits
    return None


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
        self, slug: str, data: ReturningRequest, sender: EmailSender, sms: SmsSender
    ) -> ReturningChallengeOut:
        business = await self._business(slug)
        address = data.email.strip().lower() if data.email is not None else _phone(data.phone or "")
        if address is None:
            raise Unprocessable("enter a valid phone number with country code")
        channel = "email" if data.email is not None else "sms"
        destination = _digest(f"{channel}:{address}")
        now = datetime.now(UTC)
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
                    .where(
                        (
                            func.lower(Client.email) == address
                            if channel == "email"
                            else func.regexp_replace(Client.phone, "[^0-9]", "", "g").in_(
                                [address[1:], address[2:]]
                                if address.startswith("+1")
                                else [address[1:]]
                            )
                        ),
                        Client.status == "active",
                    )
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
                expires_at=now + timedelta(minutes=10),
            )
        )
        await self.db.commit()
        subject, body = returning_code(business.name, code)
        if channel == "email":
            await sender.send(Email(to=address, subject=subject, body=body))
        else:
            await sms.send(Sms(to=address, body=body))
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
        now = datetime.now(UTC)
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
        contacts = []
        if client.email is not None:
            contacts.append(f"email:{client.email.strip().lower()}")
        phone = _phone(client.phone) if client.phone is not None else None
        if phone is not None:
            contacts.append(f"sms:{phone}")
        if not any(
            hmac.compare_digest(_digest(contact), challenge.destination_hash)
            for contact in contacts
        ):
            return None
        return client

    async def resolve(self, business_id: str, token: str) -> Client:
        challenge = (
            await self.db.execute(
                scoped(ReturningChallenge, business_id).where(
                    ReturningChallenge.session_hash == hash_token(token),
                    ReturningChallenge.session_expires_at > datetime.now(UTC),
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
                    Subject.kind == "pet",
                )
            )
        ).scalar_one_or_none()
        if subject is None:
            raise Unprocessable("that pet is not available for this booking")
        return subject.id

    async def _profile(self, client: Client) -> ReturningProfile:
        pets = (
            (
                await self.db.execute(
                    scoped(Subject, client.business_id, soft_delete=True)
                    .where(
                        Subject.client_id == client.id,
                        Subject.kind == "pet",
                    )
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
            email=client.email,
            phone=client.phone,
            pets=[ReturningPet(id=p.id, name=p.name) for p in pets],
            last_visit=last,
        )
