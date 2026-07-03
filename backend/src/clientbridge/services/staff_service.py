"""Staff invites: owner/admin creates a pending Staff(status=invited) + email; the invitee accepts
(create-or-link a User, activate, apply the role). Invite tokens are stored SHA-256-hashed."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict, Unauthorized
from clientbridge.core.ids import new_id
from clientbridge.core.security import hash_password, hash_token, verify_password
from clientbridge.integrations.notifications import Email, EmailSender
from clientbridge.models.identity import Staff, User
from clientbridge.models.platform import AuditLog
from clientbridge.schemas.identity import InviteOut

INVITE_TTL = timedelta(days=14)
INVITABLE_ROLES = {"admin", "staff", "contractor"}  # never invite an owner


class StaffService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_invite(
        self,
        principal: Principal,
        *,
        email_sender: EmailSender,
        email: str,
        role: str,
        idempotency_key: str | None = None,
    ) -> InviteOut:
        if role not in INVITABLE_ROLES:
            raise AppError(f"cannot invite with role '{role}'", code="invalid_role")

        async def run(cmd: Command) -> InviteOut:
            raw = secrets.token_urlsafe(24)
            staff = Staff(
                id=new_id("staff"),
                business_id=principal.business_id,
                role=role,
                status="invited",
                invite_email=email,
                invite_token=hash_token(raw),
            )
            self.db.add(staff)
            await self.db.flush()
            await email_sender.send(
                Email(
                    to=email, subject="You're invited to Clientbridge", body=f"Invite code: {raw}"
                )
            )
            cmd.record("staff.invite", entity_type="staff", entity_id=staff.id)
            return InviteOut(
                id=staff.id, email=email, role=staff.role, status=staff.status, invite_token=raw
            )

        return await run_command(
            self.db,
            principal,
            action="staff.invite",
            run=run,
            response_model=InviteOut,
            idempotency_key=idempotency_key,
        )

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
        elif user.password_hash is None or not verify_password(password, user.password_hash):
            # The invited address already has an account: the raw token alone must NOT mint its
            # session (the token is also visible to the inviter), so the invitee proves ownership
            # with their existing password before we link + log them in.
            raise Unauthorized("enter your existing account password to accept this invite")
        staff.user_id = user.id
        staff.status = "active"
        # principal-less surface — the invitee becomes one only here, so record the audit directly.
        self.db.add(
            AuditLog(
                id=new_id("audit_log"),
                business_id=staff.business_id,
                actor_user_id=user.id,
                action="staff.accept",
                entity_type="staff",
                entity_id=staff.id,
            )
        )
        await self.db.commit()
        return user
