"""Staff invites and pay settings."""

import logging
import secrets
from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
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
from clientbridge.core.scoping import scoped, scoped_delete, scoped_update
from clientbridge.core.security import hash_token
from clientbridge.integrations.identity import Identity
from clientbridge.integrations.resend import EmailSender
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Addon, Booking, Hours, Recurrence, Slot
from clientbridge.schemas.bookings import BookingCheck
from clientbridge.schemas.staff import (
    AcceptInviteOut,
    FutureVisit,
    FutureWork,
    InviteOut,
    InvitePreviewOut,
    LeftVisit,
    MemberRole,
    MovedSeries,
    StaffPayOut,
    StaffPayUpdate,
    StaffRemove,
    StaffRemoveOut,
    StaffUpdate,
    TeamMember,
    TeamOut,
)
from clientbridge.services import plans
from clientbridge.services.billing import void_enrolment_invoice
from clientbridge.services.bookings import (
    OVERLAP,
    carry_crew,
    is_program_day,
    lock_bookings,
    lock_staff,
    release_slot,
    slot_problem,
)
from clientbridge.services.business import load_staff, staff_names
from clientbridge.services.catalog import NOT_OFFERED, load_item, offers
from clientbridge.services.lines import crew_note
from clientbridge.services.notifications import (
    Notice,
    business_email,
    invite_link,
    queued_notifier,
    staff_invite,
)
from clientbridge.services.payments import cancel_open_deposits, refund_deposit
from clientbridge.services.plans import INVITE_TTL
from clientbridge.services.programs import sessions_of

_ANY = "any"
_OPEN = ("pending", "confirmed", "waitlisted")
_SCHEDULE_CLASH = "the member chosen can't take every session of this class schedule"
_ENROLMENT_PAID = "money was taken on a program enrolment's invoice; refund it first"


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


_log = logging.getLogger(__name__)


def removal_scope(staff_id: str) -> str:
    return f"staff-removal:{staff_id}"


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
        gateway: PaymentGateway,
        email: str,
        role: MemberRole,
        idempotency_key: str | None = None,
    ) -> InviteOut:
        assert_role(principal, "owner", "admin", message="only an owner or admin can invite")

        async def run(cmd: Command) -> InviteOut:
            business = await self._locked_business(principal.business_id)
            seats = await plans.assert_seat_free(self.db, business, clock.now())
            raw = secrets.token_urlsafe(24)
            staff = Staff(
                id=new_id("staff"),
                business_id=principal.business_id,
                role=role,
                status="invited",
                invite_email=email,
                invite_token=hash_token(raw),
                invited_at=clock.now(),
                invited_by=principal.user_id,
            )
            self.db.add(staff)
            await self.db.flush()
            # billed before commit, so a failed Stripe call fails the invite before anyone joins
            await plans.sync_seats(gateway, business, seats)
            billed.append(True)
            await email_sender.send(
                business_email(business, email, self._invite_notice(raw, business))
            )
            cmd.record("staff.invite", entity_type="staff", entity_id=staff.id)
            return InviteOut(
                id=staff.id, email=email, role=role, status=staff.status, invite_token=raw
            )

        billed: list[bool] = []
        try:
            return await run_command(
                self.db,
                principal,
                action="staff.invite",
                run=run,
                response_model=InviteOut,
                idempotency_key=idempotency_key,
                request={"email": email, "role": role},
            )
        except Exception:
            # the invite rolled back after its seat was billed, so bill the seats that remain
            if billed:
                await self.release_seat(principal.business_id, gateway)
            raise

    async def _pending(self, token: str) -> Staff:
        staff = (
            await self.db.execute(select(Staff).where(Staff.invite_token == hash_token(token)))
        ).scalar_one_or_none()
        if staff is None:
            raise NotFound("this invite link isn't valid", code="invite_invalid")
        if staff.status != "invited":
            raise Conflict("invite already accepted", code="invite_accepted")
        if (staff.invited_at or staff.created_at) + INVITE_TTL < clock.now():
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
        # the plan may have changed since the invite went out
        business = await self._locked_business(staff.business_id)
        await plans.assert_seat_free(self.db, business, clock.now(), member=staff.id)
        if member is not None:
            member.role, member.status = staff.role, "active"
            await self.db.delete(staff)
        else:
            staff.user_id, staff.status = user.id, "active"
            member = staff
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
        names = await staff_names(self.db, principal.business_id, (s.id for s in staff))
        managers = is_manager(principal.role)

        def out(s: Staff) -> TeamMember:
            user = users.get(s.user_id or "")
            inviter = users.get(s.invited_by or "")
            sent = s.invited_at or s.created_at
            return TeamMember(
                id=s.id,
                name=names.get(s.id),
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

    def _invite_notice(self, code: str, business: Business) -> Notice:
        return staff_invite(locale_for(business=business), business.name, invite_link(code))

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
        self,
        principal: Principal,
        invite_id: str,
        *,
        email_sender: EmailSender,
        gateway: PaymentGateway,
    ) -> InviteOut:
        """A new link with a fresh seven days; the old link stops working."""
        assert_role(principal, "owner", "admin", message="only an owner or admin can invite")
        staff = await self._invite(principal, invite_id)

        async def run(cmd: Command) -> InviteOut:
            assert staff.role != "owner", "an invite is never for the owner"
            business = await self._locked_business(principal.business_id)
            now = clock.now()
            seats = await plans.assert_seat_free(self.db, business, now, member=staff.id)
            await plans.sync_seats(gateway, business, seats)
            raw = secrets.token_urlsafe(24)
            staff.invite_token = hash_token(raw)
            staff.invited_at = now
            staff.invited_by = principal.user_id
            await self.db.flush()
            await email_sender.send(
                business_email(
                    business, staff.invite_email or "", self._invite_notice(raw, business)
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

    async def revoke_invite(
        self, principal: Principal, invite_id: str, *, gateway: PaymentGateway
    ) -> None:
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
        await self.release_seat(principal.business_id, gateway)

    async def release_seat(self, business_id: str, gateway: PaymentGateway) -> None:
        """Lower a Premium seat count after a member leaves; run_sync_plans retries a failure."""
        try:
            business = await self._locked_business(business_id)
            seats = await plans.billed_seats(self.db, business_id, clock.now())
            await plans.sync_seats(gateway, business, seats)
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            _log.exception("seat release failed for %s", business_id)

    async def _locked_business(self, business_id: str) -> Business:
        business = (
            await self.db.execute(
                select(Business)
                .where(Business.id == business_id)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("business not found")
        return business

    async def _member(self, principal: Principal, staff_id: str) -> Staff:
        assert_role(principal, "owner", "admin", message="only an owner or admin can change roles")
        if staff_id == principal.staff_id:
            raise Forbidden("you can't change your own role or remove yourself")
        member = await load_staff(self.db, principal.business_id, staff_id)
        if member.role == "owner":
            raise Forbidden("the owner's role can't be changed")
        return member

    async def update_member(self, principal: Principal, staff_id: str, data: StaffUpdate) -> None:
        """Role, title and colour; the self and owner guards apply only to a role change."""
        assert_role(principal, "owner", "admin", message="only an owner or admin can edit members")
        if data.role is not None:
            member = await self._member(principal, staff_id)
            previous = member.role
            member.role = data.role
            self._audit(principal, member, "staff.role", {"from": previous, "to": data.role})
        else:
            member = await load_staff(self.db, principal.business_id, staff_id)
        profile: dict[str, object] = {}
        for field in ("title", "color"):
            if field not in data.model_fields_set:
                continue
            before, after = getattr(member, field), getattr(data, field) or None
            if before != after:
                setattr(member, field, after)
                profile[field] = {"from": before, "to": after}
        if profile:
            self._audit(principal, member, "staff.profile", profile)
        await self.db.commit()

    def _audit(
        self, principal: Principal, member: Staff, action: str, changes: dict[str, object]
    ) -> None:
        self.db.add(
            Audit(
                id=new_id("audit"),
                business_id=principal.business_id,
                performed_by=principal.user_id,
                action=action,
                entity_type="staff",
                entity_id=member.id,
                changes=changes,
            )
        )

    async def remove(
        self,
        principal: Principal,
        staff_id: str,
        data: StaffRemove,
        *,
        gateway: PaymentGateway,
        idempotency_key: str | None = None,
    ) -> StaffRemoveOut:
        """Settle the member's future work and queue the clients' notices, keeping the session."""
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
            schedules = [r for r in series if r.client_id is None]
            sessions = {
                r.id: await sessions_of(self.db, biz, r.id, after=clock.now()) for r in schedules
            }
            if data.future == "reassign":
                for schedule in schedules:
                    taker = await self._take_schedule(
                        biz, schedule, sessions[schedule.id], candidates
                    )
                    for booking, slot in visits:
                        if slot.recurrence_id == schedule.id and booking.id in live:
                            cmd.record(
                                "booking.reassign",
                                entity_type="booking",
                                entity_id=booking.id,
                                changes={"from": member.id, "to": taker},
                            )
                            out.moved.append(booking.id)
                    out.series_moved.append(MovedSeries(recurrence_id=schedule.id, staff_id=taker))
                series = [r for r in series if r.client_id is not None]
            moved_whole = {r.id for r in schedules} if data.future == "reassign" else set()
            slots: dict[str, tuple[Slot, list[Booking]]] = {}
            for booking, slot in visits:
                if slot.recurrence_id in moved_whole:
                    continue
                if booking.id in live and booking.status in _OPEN:
                    slots.setdefault(slot.id, (slot, []))[1].append(booking)
            taken: dict[str, list[str]] = {}
            for slot, bookings in slots.values():
                await self.db.refresh(slot, with_for_update=True)
                if data.future == "cancel":
                    for booking in bookings:
                        if (
                            booking.invoice_id is not None
                            and await is_program_day(self.db, slot)
                            and not await void_enrolment_invoice(self.db, booking, cmd)
                        ):
                            raise Conflict(_ENROLMENT_PAID, code="enrolment_paid")
                        await self._cancel(cmd, gateway, booking)
                        await carry_crew(self.db, biz, booking, slot)
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
            if data.future == "cancel":
                for slot in (slot for ahead in sessions.values() for slot in ahead):
                    slot.status = "canceled"
            await self._settle_series(biz, series, data, taken, out)
            await self.db.execute(
                scoped_delete(Hours, biz).where(
                    Hours.staff_id == member.id,
                    Hours.basis == "exception",
                    Hours.note.startswith(crew_note("")),
                    Hours.starts_at >= clock.now(),
                )
            )
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
            notifier = queued_notifier(
                self.db, f"{removal_scope(member.id)}:{new_id('delivery')}", biz
            )
            await notifier.on_visits_reassigned(self.db, out.moved)
            await notifier.on_visits_canceled(self.db, out.canceled)
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
        if ran:
            await self.release_seat(biz, gateway)
        return result

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
                Slot.starts_at >= clock.now(),
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
            problem = (
                await slot_problem(
                    self.db,
                    biz,
                    item,
                    candidate.id,
                    slot.starts_at,
                    slot.ends_at,
                    exclude=slot.id,
                )
                if offers(item, candidate.id)
                else BookingCheck(ok=False, problem="not_offered", message=NOT_OFFERED)
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
                except IntegrityError:
                    await self.db.refresh(slot)
                    for booking in bookings:
                        await self.db.refresh(booking)
                    problem = BookingCheck(ok=False, problem="overlap", message=OVERLAP)
                else:
                    return candidate.id, None
            first = first or problem
        return None, first

    async def _take_schedule(
        self, biz: str, schedule: Recurrence, sessions: list[Slot], candidates: list[Staff]
    ) -> str:
        """Give a class schedule and its sessions ahead to the first candidate free for them all."""
        item = await load_item(self.db, biz, schedule.item_id, require_active=False)
        first: tuple[datetime, str] | None = None
        for candidate in candidates:
            clash = await self._schedule_clash(biz, item, sessions, candidate.id)
            if clash is None:
                try:
                    async with self.db.begin_nested():
                        await self._move_schedule(biz, schedule, sessions, candidate.id)
                except IntegrityError:
                    for slot in sessions:
                        await self.db.refresh(slot)
                    await self.db.refresh(schedule)
                    clash = (sessions[0].starts_at, "overlap")
                else:
                    return candidate.id
            first = first or clash
        day, problem = first or (sessions[0].starts_at if sessions else clock.now(), "overlap")
        raise Conflict(
            _SCHEDULE_CLASH,
            code="schedule_clash",
            detail={"recurrence_id": schedule.id, "starts_at": day.isoformat(), "problem": problem},
        )

    async def _schedule_clash(
        self, biz: str, item: Item, sessions: list[Slot], staff_id: str
    ) -> tuple[datetime, str] | None:
        """The first session the member can't take, and why; None when they can take them all."""
        if not offers(item, staff_id):
            return (sessions[0].starts_at if sessions else clock.now()), "not_offered"
        for slot in sessions:
            problem = await slot_problem(
                self.db, biz, item, staff_id, slot.starts_at, slot.ends_at, exclude=slot.id
            )
            if problem is not None:
                return slot.starts_at, problem.problem or "overlap"
        return None

    async def _move_schedule(
        self, biz: str, schedule: Recurrence, sessions: list[Slot], staff_id: str
    ) -> None:
        held = await lock_bookings(
            self.db,
            biz,
            list(
                await self.db.scalars(
                    scoped(Booking, biz)
                    .with_only_columns(Booking.id)
                    .where(Booking.slot_id.in_([s.id for s in sessions]))
                )
            ),
        )
        schedule.staff_id = staff_id
        for slot in sessions:
            slot.staff_id = staff_id
        for booking in held:
            booking.staff_id = staff_id
        await self.db.execute(
            scoped_update(Addon, biz)
            .where(Addon.booking_id.in_([b.id for b in held]))
            .values(staff_id=staff_id)
        )
        await self.db.flush()

    async def _cancel(self, cmd: Command, gateway: PaymentGateway, booking: Booking) -> None:
        if booking.deposit_status == "collected":
            await refund_deposit(self.db, gateway, booking)
        elif booking.deposit_status == "pending":
            await cancel_open_deposits(self.db, gateway, booking)
            booking.deposit_status = "none"
        booking.status = "canceled"
        booking.canceled_at = clock.now()
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
                taker = Counter(takers).most_common(1)[0][0]
                recurrence.staff_id = taker
                out.series_moved.append(MovedSeries(recurrence_id=recurrence.id, staff_id=taker))
                continue
            ahead = await self.db.scalar(
                scoped(Booking, biz, soft_delete=True)
                .with_only_columns(Booking.id)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Slot.recurrence_id == recurrence.id,
                    Slot.starts_at >= clock.now(),
                    Booking.status.in_(_OPEN),
                )
                .limit(1)
            )
            recurrence.status = "ended" if ahead is not None else "canceled"
            out.series_ended.append(recurrence.id)
