"""Staff invites and pay settings."""

import secrets
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role, is_manager
from clientbridge.core.emails import normalize_email
from clientbridge.core.errors import (
    AppError,
    Conflict,
    Forbidden,
    NotFound,
    Unprocessable,
)
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.core.security import hash_token
from clientbridge.integrations.kratos import Identity
from clientbridge.integrations.resend import Email, EmailSender
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Addon, Booking, Recurrence, Slot
from clientbridge.schemas.bookings import BookingCheck
from clientbridge.schemas.staff import (
    AcceptInviteOut,
    FutureVisit,
    FutureWork,
    InviteOut,
    InvitePreviewOut,
    LeftVisit,
    MemberRole,
    RoleUpdate,
    StaffPayOut,
    StaffPayUpdate,
    StaffRemove,
    StaffRemoveOut,
    TeamMember,
    TeamOut,
)
from clientbridge.services.bookings import (
    clash,
    lock_bookings,
    lock_staff,
    release_slot,
    slot_problem,
)
from clientbridge.services.business import load_staff
from clientbridge.services.catalog import load_item
from clientbridge.services.notifications import invite_link, staff_invite
from clientbridge.services.payments import cancel_open_deposits, refund_deposit

INVITE_TTL = timedelta(days=7)
_ANY = "any"
_OPEN = ("pending", "confirmed", "waitlisted")


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
        role: MemberRole,
        idempotency_key: str | None = None,
    ) -> InviteOut:
        assert_role(principal, "owner", "admin", message="only an owner or admin can invite")

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
            subject, body = await self._invite_email(principal, raw)
            await email_sender.send(
                Email(
                    to=email,
                    subject=subject,
                    body=body,
                    tags={"business": principal.business_id},
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
            request={"email": email, "role": role},
        )

    async def _pending(self, token: str) -> Staff:
        staff = (
            await self.db.execute(select(Staff).where(Staff.invite_token == hash_token(token)))
        ).scalar_one_or_none()
        if staff is None:
            raise NotFound("this invite link isn't valid", code="invite_invalid")
        if staff.status != "invited":
            raise Conflict("invite already accepted", code="invite_accepted")
        if (staff.invited_at or staff.created_at) + INVITE_TTL < datetime.now(UTC):
            raise AppError("this invite has expired", code="invite_expired", status_code=410)
        return staff

    async def preview_invite(self, token: str) -> InvitePreviewOut:
        staff = await self._pending(token)
        business = await self.db.get(Business, staff.business_id)
        return InvitePreviewOut(
            business_name=business.name if business else "",
            email=staff.invite_email or "",
            role=staff.role,
            expires_at=(staff.invited_at or staff.created_at) + INVITE_TTL,
        )

    async def accept_invite(self, user: User, identity: Identity, token: str) -> AcceptInviteOut:
        """The signed-in user joins the team, if the invited address is one they have verified."""
        staff = await self._pending(token)
        invited = normalize_email(staff.invite_email or "")
        if invited not in identity.verified_emails:
            if invited == normalize_email(identity.email):
                raise Forbidden("verify your email address first", code="email_unverified")
            raise Forbidden(
                "this invite was sent to a different email address", code="invite_email_mismatch"
            )
        member = (
            await self.db.execute(scoped(Staff, staff.business_id).where(Staff.user_id == user.id))
        ).scalar_one_or_none()
        if member is not None and member.status == "active":
            raise Conflict("you're already on this team", code="already_member")
        if member is not None:
            member.role, member.status = staff.role, "active"
            await self.db.delete(staff)
        else:
            staff.user_id, staff.status = user.id, "active"
            member = staff
        member.name = member.name or user.name
        # principal-less surface — the invitee becomes one only here, so record the audit directly.
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=member.business_id,
                performed_by=user.id,
                action="staff.accept",
                entity_type="staff",
                entity_id=member.id,
            )
        )
        await self.db.commit()
        return AcceptInviteOut(business_id=member.business_id, staff_id=member.id)

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
                last_active_at=user.last_seen_at if user and managers else None,
                invited_at=sent if s.status == "invited" else None,
                invited_by_name=inviter.name if inviter else None,
                expires_at=sent + INVITE_TTL if s.status == "invited" else None,
            )

        return TeamOut(
            members=[out(s) for s in staff if s.status == "active"],
            invites=[out(s) for s in staff if s.status == "invited"] if managers else [],
        )

    async def _invite_email(self, principal: Principal, code: str) -> tuple[str, str]:
        business = await self.db.get(Business, principal.business_id)
        return staff_invite(locale_for(business=business), invite_link(code))

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
            subject, body = await self._invite_email(principal, raw)
            await email_sender.send(
                Email(
                    to=staff.invite_email or "",
                    subject=subject,
                    body=body,
                    tags={"business": principal.business_id},
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

    async def remove(
        self,
        principal: Principal,
        staff_id: str,
        data: StaffRemove,
        *,
        gateway: PaymentGateway,
        idempotency_key: str | None = None,
    ) -> tuple[StaffRemoveOut, bool]:
        """Settle the member's future work, keeping their session; True if this call did it."""
        assert_role(principal, "owner", "admin", message="only an owner or admin can change roles")
        biz = principal.business_id
        ran: list[bool] = []

        async def run(cmd: Command) -> StaffRemoveOut:
            member = await self._member(principal, staff_id)
            candidates = await self._takers(biz, member.id, data)
            await lock_staff(self.db, biz, member.id, *(c.id for c in candidates))
            visits = await self._future_visits(biz, member.id)
            series = list(
                await self.db.scalars(
                    scoped(Recurrence, biz)
                    .where(Recurrence.staff_id == member.id, Recurrence.status == "active")
                    .order_by(Recurrence.id)
                )
            )
            if data.future is None and (visits or series):
                work = FutureWork(
                    visits=[
                        FutureVisit(
                            booking_id=b.id,
                            starts_at=s.starts_at,
                            client_id=b.client_id,
                            recurrence_id=s.recurrence_id,
                        )
                        for b, s in visits
                    ],
                    series=[r.id for r in series],
                )
                raise Conflict(
                    "move or cancel this member's future visits first",
                    code="staff_has_future_work",
                    detail=work.model_dump(mode="json"),
                )
            out = StaffRemoveOut(moved=[], canceled=[], left=[], series_moved=[], series_ended=[])
            live = {b.id for b in await lock_bookings(self.db, biz, [b.id for b, _ in visits])}
            slots: dict[str, tuple[Slot, list[Booking]]] = {}
            for booking, slot in visits:
                if booking.id in live and booking.status in _OPEN:
                    slots.setdefault(slot.id, (slot, []))[1].append(booking)
            taken: dict[str, list[str]] = {}
            for slot, bookings in slots.values():
                await self.db.refresh(slot, with_for_update=True)
                if data.future == "cancel":
                    for booking in bookings:
                        await self._cancel(cmd, gateway, booking)
                        out.canceled.append(booking.id)
                    await release_slot(self.db, slot)
                    continue
                taker, problem = await self._reassign(biz, slot, bookings, candidates)
                if taker is None:
                    out.left.extend(
                        LeftVisit(
                            booking_id=b.id,
                            starts_at=slot.starts_at,
                            problem=problem.problem if problem else None,
                            message=problem.message if problem else None,
                        )
                        for b in bookings
                    )
                    continue
                for booking in bookings:
                    cmd.record(
                        "booking.reassign",
                        entity_type="booking",
                        entity_id=booking.id,
                        changes={"from": member.id, "to": taker},
                    )
                    out.moved.append(booking.id)
                if slot.recurrence_id is not None:
                    taken.setdefault(slot.recurrence_id, []).append(taker)
            await self._settle_series(biz, series, data, taken, out)
            member.status = "removed"
            await self.db.flush()
            cmd.record(
                "staff.remove",
                entity_type="staff",
                entity_id=member.id,
                changes={
                    "future": data.future,
                    "moved": len(out.moved),
                    "canceled": len(out.canceled),
                    "left": len(out.left),
                },
            )
            ran.append(True)
            return out

        result = await run_command(
            self.db,
            principal,
            action="staff.remove",
            run=run,
            response_model=StaffRemoveOut,
            idempotency_key=idempotency_key,
            request={"staff_id": staff_id, **data.model_dump(mode="json")},
        )
        return result, bool(ran)

    async def _takers(self, biz: str, member_id: str, data: StaffRemove) -> list[Staff]:
        """The members who may take the visits, in the order they are offered them."""
        if data.future is None and data.reassign_to is not None:
            raise Unprocessable("choose reassign to name who takes the visits")
        if data.future == "cancel" and data.reassign_to is not None:
            raise Unprocessable("canceled visits are not reassigned")
        if data.future != "reassign":
            return []
        if data.reassign_to is None:
            raise Unprocessable('name the member who takes the visits, or "any"')
        if data.reassign_to == member_id:
            raise Unprocessable("choose a different member to take the visits")
        if data.reassign_to != _ANY:
            return [await load_staff(self.db, biz, data.reassign_to)]
        rows = await self.db.scalars(
            scoped(Staff, biz)
            .where(Staff.status == "active", Staff.id != member_id)
            .order_by(Staff.created_at, Staff.id)
        )
        return list(rows)

    async def _future_visits(self, biz: str, member_id: str) -> list[tuple[Booking, Slot]]:
        rows = await self.db.execute(
            scoped(Booking, biz, soft_delete=True)
            .add_columns(Slot)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Slot.staff_id == member_id,
                Slot.status == "scheduled",
                Slot.starts_at >= datetime.now(UTC),
                Booking.status.in_(_OPEN),
            )
            .order_by(Slot.starts_at, Booking.id)
        )
        return [(row[0], row[1]) for row in rows.all()]

    async def _reassign(
        self, biz: str, slot: Slot, bookings: list[Booking], candidates: list[Staff]
    ) -> tuple[str | None, BookingCheck | None]:
        """Give the slot to the first candidate free then; the first refusal when nobody is."""
        item = await load_item(self.db, biz, slot.item_id, require_active=False)
        first: BookingCheck | None = None
        for candidate in candidates:
            problem = await slot_problem(
                self.db,
                biz,
                item,
                candidate.id,
                slot.starts_at,
                slot.ends_at,
                exclude=slot.id,
                resource_id=slot.resource_id,
            )
            if problem is None:
                try:
                    async with self.db.begin_nested():
                        slot.staff_id = candidate.id
                        for booking in bookings:
                            booking.staff_id = candidate.id
                        await self.db.execute(
                            scoped_update(Addon, biz)
                            .where(Addon.booking_id.in_([b.id for b in bookings]))
                            .values(staff_id=candidate.id)
                        )
                        await self.db.flush()
                except IntegrityError as exc:
                    await self.db.refresh(slot)
                    for booking in bookings:
                        await self.db.refresh(booking)
                    problem = BookingCheck(ok=False, problem="overlap", message=clash(exc).message)
                else:
                    return candidate.id, None
            first = first or problem
        return None, first

    async def _cancel(self, cmd: Command, gateway: PaymentGateway, booking: Booking) -> None:
        if booking.deposit_status == "collected":
            await refund_deposit(self.db, gateway, booking)
        elif booking.deposit_status == "pending":
            await cancel_open_deposits(self.db, gateway, booking)
            booking.deposit_status = "none"
        booking.status = "canceled"
        booking.canceled_at = datetime.now(UTC)
        cmd.record("booking.canceled", entity_type="booking", entity_id=booking.id)

    async def _settle_series(
        self,
        biz: str,
        series: list[Recurrence],
        data: StaffRemove,
        taken: dict[str, list[str]],
        out: StaffRemoveOut,
    ) -> None:
        """A series follows its moved visits to their new member; otherwise it stops."""
        for recurrence in series:
            takers = taken.get(recurrence.id)
            if data.future == "reassign" and takers:
                recurrence.staff_id = Counter(takers).most_common(1)[0][0]
                out.series_moved.append(recurrence.id)
                continue
            ahead = await self.db.scalar(
                scoped(Booking, biz, soft_delete=True)
                .with_only_columns(Booking.id)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Slot.recurrence_id == recurrence.id,
                    Slot.starts_at >= datetime.now(UTC),
                    Booking.status.in_(_OPEN),
                )
                .limit(1)
            )
            recurrence.status = "ended" if ahead is not None else "canceled"
            out.series_ended.append(recurrence.id)
