"""Staff invites: owner/admin creates a pending Staff(status=invited) + email; the invitee accepts
(create-or-link a User, activate, apply the role). Invite tokens are stored SHA-256-hashed."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import AppError, Conflict, Unauthorized
from clientbridge.core.ids import new_id
from clientbridge.core.security import hash_password, hash_token
from clientbridge.integrations.email import Email, EmailSender
from clientbridge.models.identity import Staff, User

INVITE_TTL = timedelta(days=14)
INVITABLE_ROLES = {"admin", "staff", "contractor"}  # never invite an owner


class StaffService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_invite(
        self, *, business_id: str, email_sender: EmailSender, email: str, role: str
    ) -> tuple[Staff, str]:
        if role not in INVITABLE_ROLES:
            raise AppError(f"cannot invite with role '{role}'", code="invalid_role")
        raw = secrets.token_urlsafe(24)
        staff = Staff(
            id=new_id("staff"),
            business_id=business_id,
            role=role,
            status="invited",
            invite_email=email,
            invite_token=hash_token(raw),
        )
        self.db.add(staff)
        await self.db.commit()
        await email_sender.send(
            Email(to=email, subject="You're invited to Clientbridge", body=f"Invite code: {raw}")
        )
        return staff, raw

    async def accept_invite(self, *, token: str, name: str | None, password: str) -> User:
        staff = (
            await self.db.execute(select(Staff).where(Staff.invite_token == hash_token(token)))
        ).scalar_one_or_none()
        if staff is None:
            raise Unauthorized("invalid invite")
        if staff.status != "invited":
            raise Conflict("invite already accepted")
        if staff.created_at + INVITE_TTL < datetime.now(UTC):
            raise Unauthorized("invite expired")

        user = None
        if staff.invite_email:
            user = (
                await self.db.execute(select(User).where(User.email == staff.invite_email))
            ).scalar_one_or_none()
        if user is None:
            user = User(
                id=new_id("user"),
                email=staff.invite_email or "",
                password_hash=hash_password(password),
                name=name,
                oauth={},
            )
            self.db.add(user)
            await self.db.flush()
        staff.user_id = user.id
        staff.status = "active"
        await self.db.commit()
        return user
