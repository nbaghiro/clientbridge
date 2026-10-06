"""Staff invites and pay settings."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unauthorized, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.security import hash_token, verify_password
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.models.business import Staff, User
from clientbridge.models.platform import Audit
from clientbridge.schemas.staff import InviteOut, StaffPayOut, StaffPayUpdate
from clientbridge.services.auth import build_user

INVITE_TTL = timedelta(days=14)
INVITABLE_ROLES = {"admin", "staff", "contractor"}  # never invite an owner


def _fit_rate_unit(staff: Staff, data: StaffPayUpdate) -> None:
    """Clear the other rate unit on a basis change, and refuse a rate in the wrong unit."""
    if staff.rate_type is None:
        if staff.rate_bps is not None or staff.rate_cents is not None:
            raise Unprocessable("set how the rate applies (percent, fixed or hourly)")
        return
    used, unused = (
        ("rate_bps", "rate_cents") if staff.rate_type == "percent" else ("rate_cents", "rate_bps")
    )
    if unused in data.model_fields_set and getattr(data, unused) is not None:
        raise Unprocessable(f"{used} holds the rate for rate_type {staff.rate_type}")
    setattr(staff, unused, None)


class StaffService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def update_pay(
        self, principal: Principal, staff_id: str, data: StaffPayUpdate
    ) -> StaffPayOut:
        """How a team member is paid: service rate, its basis, and retail commission."""
        assert_role(principal, "owner", "admin", message="only an owner or admin can set pay")

        async def run(cmd: Command) -> StaffPayOut:
            staff = (
                await self.db.execute(
                    scoped(Staff, principal.business_id)
                    .where(Staff.id == staff_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if staff is None:
                raise NotFound("team member not found")
            for key, value in data.model_dump(exclude_unset=True).items():
                setattr(staff, key, value)
            _fit_rate_unit(staff, data)
            await self.db.flush()
            cmd.record("staff.pay", entity_type="staff", entity_id=staff.id)
            return StaffPayOut.model_validate(staff)

        return await run_command(
            self.db, principal, action="staff.pay", run=run, response_model=StaffPayOut
        )

    async def create_invite(
        self,
        principal: Principal,
        *,
        email_sender: EmailSender,
        email: str,
        role: str,
        idempotency_key: str | None = None,
    ) -> InviteOut:
        assert_role(principal, "owner", "admin", message="only an owner or admin can invite")
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
            user = build_user(email=staff.invite_email or "", password=password, name=name)
            self.db.add(user)
            await self.db.flush()
        elif user.password_hash is None or not verify_password(password, user.password_hash):
            # The token alone must not sign in an existing account; the inviter can see it.
            raise Unauthorized("enter your existing account password to accept this invite")
        staff.user_id = user.id
        staff.status = "active"
        # principal-less surface — the invitee becomes one only here, so record the audit directly.
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=staff.business_id,
                performed_by=user.id,
                action="staff.accept",
                entity_type="staff",
                entity_id=staff.id,
            )
        )
        await self.db.commit()
        return user


async def load_staff(db: AsyncSession, biz: str, staff_id: str) -> Staff:
    """Load an active staff member by id, else NotFound."""
    row = (
        await db.execute(scoped(Staff, biz).where(Staff.id == staff_id, Staff.status == "active"))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("staff not found")
    return row
