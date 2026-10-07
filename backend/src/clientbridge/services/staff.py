"""Staff invites and pay settings."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role, is_manager
from clientbridge.core.errors import (
    AppError,
    Conflict,
    Forbidden,
    NotFound,
    Unauthorized,
    Unprocessable,
)
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.core.security import hash_token, verify_password
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.models.auth import AuthSession
from clientbridge.models.business import Staff, User
from clientbridge.models.platform import Audit
from clientbridge.schemas.staff import (
    InviteOut,
    RoleUpdate,
    StaffPayOut,
    StaffPayUpdate,
    TeamMember,
    TeamOut,
)
from clientbridge.services.auth import build_user

INVITE_TTL = timedelta(days=7)
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
                invited_at=datetime.now(UTC),
                invited_by=principal.user_id,
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
        if (staff.invited_at or staff.created_at) + INVITE_TTL < datetime.now(UTC):
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
        staff.name = user.name
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

    async def team(self, principal: Principal) -> TeamOut:
        """Everyone on the team with their sign-in email and last activity, then pending invites."""
        rows = (
            await self.db.execute(
                scoped(Staff, principal.business_id)
                .where(Staff.status.in_(("active", "invited")))
                .order_by(Staff.created_at)
            )
        ).scalars()
        staff = list(rows)
        user_ids = {s.user_id for s in staff if s.user_id} | {
            s.invited_by for s in staff if s.invited_by
        }
        users = {
            u.id: u
            for u in (await self.db.execute(select(User).where(User.id.in_(user_ids)))).scalars()
        }
        sessions = await self.db.execute(
            select(AuthSession.user_id, func.max(AuthSession.created_at))
            .where(AuthSession.user_id.in_(user_ids))
            .group_by(AuthSession.user_id)
        )
        last = {user_id: at for user_id, at in sessions.all()}
        managers = is_manager(principal.role)

        def out(s: Staff) -> TeamMember:
            user = users.get(s.user_id or "")
            inviter = users.get(s.invited_by or "")
            sent = s.invited_at or s.created_at
            return TeamMember(
                id=s.id,
                name=s.name,
                email=(user.email if user else s.invite_email) if managers else None,
                role=s.role,
                status=s.status,
                last_active_at=last.get(s.user_id or "") if managers else None,
                invited_at=sent if s.status == "invited" else None,
                invited_by_name=inviter.name if inviter else None,
                expires_at=sent + INVITE_TTL if s.status == "invited" else None,
            )

        return TeamOut(
            members=[out(s) for s in staff if s.status == "active"],
            invites=[out(s) for s in staff if s.status == "invited"] if managers else [],
        )

    async def _invite(self, principal: Principal, invite_id: str) -> Staff:
        row = (
            await self.db.execute(
                scoped(Staff, principal.business_id).where(
                    Staff.id == invite_id, Staff.status == "invited"
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("invite not found")
        return row

    async def resend_invite(
        self, principal: Principal, invite_id: str, *, email_sender: EmailSender
    ) -> InviteOut:
        """A new link with a fresh seven days; the old link stops working."""
        assert_role(principal, "owner", "admin", message="only an owner or admin can invite")
        staff = await self._invite(principal, invite_id)

        async def run(cmd: Command) -> InviteOut:
            raw = secrets.token_urlsafe(24)
            staff.invite_token = hash_token(raw)
            staff.invited_at = datetime.now(UTC)
            staff.invited_by = principal.user_id
            await self.db.flush()
            await email_sender.send(
                Email(
                    to=staff.invite_email or "",
                    subject="You're invited to Clientbridge",
                    body=f"Invite code: {raw}",
                )
            )
            cmd.record("staff.invite_resend", entity_type="staff", entity_id=staff.id)
            return InviteOut(
                id=staff.id,
                email=staff.invite_email or "",
                role=staff.role,
                status=staff.status,
                invite_token=raw,
            )

        return await run_command(
            self.db, principal, action="staff.invite_resend", run=run, response_model=InviteOut
        )

    async def revoke_invite(self, principal: Principal, invite_id: str) -> None:
        assert_role(principal, "owner", "admin", message="only an owner or admin can revoke")
        staff = await self._invite(principal, invite_id)
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=principal.business_id,
                performed_by=principal.user_id,
                action="staff.invite_revoke",
                entity_type="staff",
                entity_id=staff.id,
                changes={"email": staff.invite_email},
            )
        )
        await self.db.delete(staff)
        await self.db.commit()

    async def _member(self, principal: Principal, staff_id: str) -> Staff:
        assert_role(principal, "owner", "admin", message="only an owner or admin can change roles")
        if staff_id == principal.staff_id:
            raise Forbidden("you can't change your own role or remove yourself")
        member = await load_staff(self.db, principal.business_id, staff_id)
        if member.role == "owner":
            raise Forbidden("the owner's role can't be changed")
        return member

    async def change_role(self, principal: Principal, staff_id: str, data: RoleUpdate) -> None:
        member = await self._member(principal, staff_id)
        previous = member.role
        member.role = data.role
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=principal.business_id,
                performed_by=principal.user_id,
                action="staff.role",
                entity_type="staff",
                entity_id=member.id,
                changes={"from": previous, "to": data.role},
            )
        )
        await self.db.commit()

    async def remove(self, principal: Principal, staff_id: str) -> None:
        """The member loses access here and is signed out of every device; their history stays."""
        member = await self._member(principal, staff_id)
        member.status = "removed"
        if member.user_id is not None:
            await self.db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == member.user_id, AuthSession.revoked_at.is_(None))
                .values(revoked_at=datetime.now(UTC))
            )
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=principal.business_id,
                performed_by=principal.user_id,
                action="staff.remove",
                entity_type="staff",
                entity_id=member.id,
            )
        )
        await self.db.commit()


async def load_staff(db: AsyncSession, biz: str, staff_id: str) -> Staff:
    """Load an active staff member by id, else NotFound."""
    row = (
        await db.execute(scoped(Staff, biz).where(Staff.id == staff_id, Staff.status == "active"))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("staff not found")
    return row
