import base64
import hashlib
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from pydantic import BaseModel
from sqlalchemy import or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role, is_manager
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.integrations.google_business import (
    GoogleBusinessError,
    GoogleBusinessGateway,
    GoogleFlowStore,
    GoogleReviews,
    GoogleSecretStore,
    get_google_business_gateway,
    get_google_secret_store,
    google_business_enabled,
    review_name,
    review_parent,
)
from clientbridge.models.business import Staff
from clientbridge.models.clients import Client
from clientbridge.models.reviews import (
    GoogleBusinessConnection,
    GoogleBusinessOperation,
    ReviewRequest,
)
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.reviews import (
    GoogleAuthorizationOut,
    GoogleAuthorizationResult,
    GoogleChoices,
    GoogleLocationChoice,
    GoogleOperationOut,
    GoogleReplyCreate,
    GoogleReviewAvailability,
    ReviewRequestCreate,
    ReviewRequestOut,
)
from clientbridge.services.business import businesses_at_hour
from clientbridge.services.notifications import Notifier, queued_notifier
from clientbridge.services.plans import plan_access

# a client with several visits gets at most one request in this span, asked for or sent by the job
REQUEST_COOLDOWN = timedelta(days=30)


async def recently_asked(db: AsyncSession, business_id: str, now: datetime) -> set[str]:
    return set(
        await db.scalars(
            scoped(ReviewRequest, business_id)
            .with_only_columns(ReviewRequest.client_id)
            .where(
                ReviewRequest.requested_at > now - REQUEST_COOLDOWN,
                ReviewRequest.requested_at <= now,
            )
        )
    )


def build_review_request(
    business_id: str, client_id: str, booking_id: str | None, now: datetime
) -> ReviewRequest:
    return ReviewRequest(
        id=new_id("review_request"),
        business_id=business_id,
        client_id=client_id,
        booking_id=booking_id,
        requested_at=now,
    )


class ReviewService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def request_review(
        self, data: ReviewRequestCreate, idempotency_key: str | None, notify: Notifier
    ) -> ReviewRequestOut:
        assert_role(self.principal, "owner", "admin", message="only managers can request reviews")

        async def run(cmd: Command) -> ReviewRequestOut:
            await google_lock(self.db, self.biz)
            link = await google_invitation_url(self.db, self.biz)
            if link is None:
                raise Conflict(
                    "connect a Google profile before requesting reviews",
                    code="google_reconnect_required",
                )
            client = await self.db.scalar(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == data.client_id)
            )
            if client is None:
                raise NotFound("client not found")
            if data.booking_id is not None:
                booking = await self.db.scalar(
                    scoped(Booking, self.biz, soft_delete=True)
                    .where(Booking.id == data.booking_id)
                    .with_for_update()
                )
                if booking is None or booking.client_id != data.client_id:
                    raise NotFound("booking not found")
                if booking.status != "completed":
                    raise Conflict("only a completed booking can be requested")
                existing = await self.db.scalar(
                    scoped(ReviewRequest, self.biz)
                    .where(ReviewRequest.booking_id == booking.id)
                    .limit(1)
                )
                if existing is not None:
                    raise Conflict("a review was already requested for that booking")
            now = clock.now()
            if data.client_id in await recently_asked(self.db, self.biz, now):
                raise Conflict(
                    "a review was requested from this client in the last 30 days",
                    code="review_recently_requested",
                )
            request = build_review_request(self.biz, data.client_id, data.booking_id, now)
            self.db.add(request)
            await self.db.flush()
            cmd.record("review.request", entity_type="review_request", entity_id=request.id)
            await queued_notifier(self.db, f"review:{request.id}", self.biz).on_review_requested(
                self.db, request.id, link
            )
            return ReviewRequestOut.model_validate(request, from_attributes=True)

        return await run_command(
            self.db,
            self.principal,
            action="review.request",
            run=run,
            response_model=ReviewRequestOut,
            idempotency_key=idempotency_key,
            request=data,
        )


async def run_review_requests(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    requests = []
    for business in await businesses_at_hour(db, now, 8):
        if plan_access(business, now) == "lapsed" or not business.review_requests_enabled:
            continue
        await google_lock(db, business.id)
        link = await google_invitation_url(db, business.id)
        if link is None:
            continue
        requested = (
            scoped(ReviewRequest, business.id)
            .with_only_columns(ReviewRequest.booking_id)
            .where(ReviewRequest.booking_id.is_not(None))
        )
        active = scoped(Client, business.id, soft_delete=True).with_only_columns(Client.id)
        bookings = await db.scalars(
            scoped(Booking, business.id, soft_delete=True)
            .where(
                Booking.status == "completed",
                Booking.completed_at >= now - timedelta(days=7),
                Booking.completed_at <= now,
                Booking.id.not_in(requested),
                Booking.client_id.in_(active),
            )
            .order_by(Booking.completed_at.desc(), Booking.id)
            .with_for_update(skip_locked=True)
        )
        asked = await recently_asked(db, business.id, now)
        for booking in bookings:
            if booking.client_id in asked:
                continue
            asked.add(booking.client_id)
            request = build_review_request(business.id, booking.client_id, booking.id, now)
            db.add(request)
            requests.append((request, link))
    await db.flush()
    for request, link in requests:
        await queued_notifier(db, f"review:{request.id}", request.business_id).on_review_requested(
            db, request.id, link
        )
    await db.commit()
    return len(requests)


class GoogleFlow(BaseModel):
    user_id: str
    business_id: str
    session_id: str
    generation: int
    connection_id: str
    verifier: str
    handle: str
    platform: str
    expires_at: datetime
    state: str = "pending"
    ciphertext: str | None = None
    key_version: str | None = None


async def google_lock(db: AsyncSession, business_id: str) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"google:{business_id}"},
    )


class GoogleReviewService:
    def __init__(
        self,
        db: AsyncSession,
        principal: Principal,
        gateway: GoogleBusinessGateway,
        vault: GoogleSecretStore,
        flows: GoogleFlowStore,
    ) -> None:
        self.db = db
        self.principal = principal
        self.gateway = gateway
        self.vault = vault
        self.flows = flows
        self.biz = principal.business_id

    def authorize(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only managers can manage Google reviews"
        )
        if not google_business_enabled():
            raise GoogleBusinessError(
                "Google reviews are not configured", code="google_not_configured", status_code=503
            )

    async def connection(self, *, active: bool = False) -> GoogleBusinessConnection:
        self.authorize()
        await google_lock(self.db, self.biz)
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if row is None or row.state == "disconnected" or (active and row.state != "active"):
            raise Conflict("Google profile must be connected", code="google_reconnect_required")
        return row

    async def token(self, row: GoogleBusinessConnection) -> str:
        if row.refresh_token_ciphertext is None:
            raise Conflict("Google profile must be connected", code="google_reconnect_required")
        try:
            refresh = await self.vault.open(row.refresh_token_ciphertext, f"{self.biz}:{row.id}")
            tokens = await self.gateway.refresh(refresh)
        except GoogleBusinessError as error:
            if error.code == "google_reconnect_required":
                row.state = "reconnect_required"
                row.last_error_code = error.code
                await self.db.commit()
            raise
        if tokens.refresh_token:
            row.refresh_token_ciphertext, row.key_version = await self.vault.seal(
                tokens.refresh_token, f"{self.biz}:{row.id}"
            )
            await self.db.flush()
        return tokens.access_token

    async def status(self) -> GoogleReviewAvailability:
        assert_role(
            self.principal, "owner", "admin", message="only managers can manage Google reviews"
        )
        if not google_business_enabled():
            return GoogleReviewAvailability()
        await google_lock(self.db, self.biz)
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if row is None:
            return GoogleReviewAvailability(state="disconnected")
        result = GoogleReviewAvailability(
            state=row.state, connection_id=row.id, generation=row.generation
        )
        if row.state == "active" and row.location_name:
            try:
                location = await self.gateway.location(await self.token(row), row.location_name)
                result.location = GoogleLocationChoice(name=location.name, title=location.title)
                result.can_request = valid_google_review_url(location.metadata.new_review_uri)
            except GoogleBusinessError as error:
                if error.code != "google_reconnect_required":
                    raise
                result.state = "reconnect_required"
        await self.db.commit()
        return result

    async def start(self, session_id: str, platform: str) -> GoogleAuthorizationOut:
        self.authorize()
        await google_lock(self.db, self.biz)
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if row is None:
            row = GoogleBusinessConnection(
                id=new_id("google_connection"),
                business_id=self.biz,
                connected_by=self.principal.user_id,
                state="disconnected",
                generation=1,
            )
            self.db.add(row)
            await self.db.flush()
        state, handle, verifier = (
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(48),
        )
        flow = GoogleFlow(
            user_id=self.principal.user_id,
            business_id=self.biz,
            session_id=session_id,
            generation=row.generation,
            connection_id=row.id,
            verifier=verifier,
            handle=handle,
            platform=platform,
            expires_at=clock.now() + timedelta(minutes=10),
        )
        await self.flows.put(f"callback:{state}", flow.model_dump_json())
        await self.flows.put(f"flow:{handle}", flow.model_dump_json())
        await self.db.commit()
        return GoogleAuthorizationOut(
            authorization_url=self.gateway.authorization_url(state, verifier), flow_token=handle
        )

    async def complete(self, handle: str, session_id: str) -> GoogleAuthorizationResult:
        self.authorize()
        raw = await self.flows.get(f"flow:{handle}")
        if raw is None:
            return GoogleAuthorizationResult(state="failed")
        flow = GoogleFlow.model_validate_json(raw)
        if flow.expires_at <= clock.now():
            return GoogleAuthorizationResult(state="failed")
        if (flow.user_id, flow.business_id, flow.session_id) != (
            self.principal.user_id,
            self.biz,
            session_id,
        ):
            raise Forbidden("Google authorization belongs to another session")
        if flow.state != "complete":
            return GoogleAuthorizationResult(
                state="failed" if flow.state == "failed" else "pending"
            )
        await google_lock(self.db, self.biz)
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if row is None or row.id != flow.connection_id or row.generation != flow.generation:
            raise Conflict("Google authorization is stale", code="google_reconnect_required")
        consumed = await self.flows.pop(f"flow:{handle}")
        if consumed is None or flow.ciphertext is None:
            return GoogleAuthorizationResult(state="failed")
        row.refresh_token_ciphertext = base64.b64decode(flow.ciphertext)
        row.key_version = flow.key_version
        row.connected_by = self.principal.user_id
        row.generation += 1
        row.state = "selecting"
        row.account_name = None
        row.location_name = None
        row.last_error_code = None
        await self.cancel_operations()
        await self.db.commit()
        return GoogleAuthorizationResult(state="complete")

    async def accounts(self, page: str | None) -> GoogleChoices:
        row = await self.connection()
        result = await self.gateway.accounts(await self.token(row), page)
        await self.db.commit()
        return GoogleChoices(
            choices=[GoogleLocationChoice(name=a.name, title=a.title) for a in result.accounts],
            next_page_token=result.next_page_token,
        )

    async def locations(self, account: str, page: str | None) -> GoogleChoices:
        row = await self.connection()
        result = await self.gateway.locations(await self.token(row), account, page)
        await self.db.commit()
        return GoogleChoices(
            choices=[GoogleLocationChoice(name=a.name, title=a.title) for a in result.locations],
            next_page_token=result.next_page_token,
        )

    async def select(
        self, account: str, location: str, generation: int
    ) -> GoogleReviewAvailability:
        await google_lock(self.db, self.biz)
        row = await self.connection()
        if row.generation != generation:
            raise Conflict("Google connection changed", code="google_reconnect_required")
        token = await self.token(row)
        page = None
        seen: set[str] = set()
        while True:
            choices = await self.gateway.locations(token, account, page)
            if any(item.name == location for item in choices.locations):
                break
            page = choices.next_page_token
            if not page or page in seen or len(seen) >= 100:
                raise Forbidden("location does not belong to the Google account")
            seen.add(page)
        await self.gateway.reviews(token, review_parent(account, location))
        row.account_name, row.location_name = account, location
        row.state = "active"
        row.generation += 1
        row.last_success_at = clock.now()
        try:
            await self.cancel_operations()
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise Conflict(
                "Google location is already linked", code="google_location_in_use"
            ) from None
        return await self.status()

    async def cancel_operations(self) -> None:
        await self.db.execute(
            scoped_update(GoogleBusinessOperation, self.biz)
            .where(GoogleBusinessOperation.state.in_(("queued", "running", "unknown")))
            .values(
                state="canceled",
                request_ciphertext=None,
                key_version=None,
                expected_reply_revision=None,
            )
        )

    async def disconnect(self, generation: int) -> GoogleReviewAvailability:
        self.authorize()
        await google_lock(self.db, self.biz)
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if row is None or row.state == "disconnected":
            return GoogleReviewAvailability(state="disconnected")
        if row.generation != generation:
            raise Conflict("Google connection changed", code="google_reconnect_required")
        row.refresh_token_ciphertext = None
        row.key_version = None
        row.account_name = None
        row.location_name = None
        row.state = "disconnected"
        row.generation += 1
        await self.cancel_operations()
        await self.db.commit()
        return await self.status()

    async def reviews(self, page: str | None) -> GoogleReviews:
        row = await self.connection(active=True)
        result = await self.gateway.reviews(
            await self.token(row),
            review_parent(row.account_name or "", row.location_name or ""),
            page,
        )
        row.last_success_at = clock.now()
        await self.db.commit()
        return result

    async def submit_reply(
        self, body: GoogleReplyCreate, key: str, *, remove: bool
    ) -> GoogleOperationOut:
        self.authorize()

        async def run(cmd: Command) -> GoogleOperationOut:
            operation = await self.queue_reply(body, key, remove=remove)
            cmd.record(
                "google.reply_delete" if remove else "google.reply_put",
                entity_type="google_operation",
                entity_id=operation.id,
            )
            return operation

        return await run_command(
            self.db,
            self.principal,
            action="google.reply_delete" if remove else "google.reply_put",
            run=run,
            response_model=GoogleOperationOut,
            idempotency_key=key,
            request={"hash": hashlib.sha256(body.model_dump_json().encode()).hexdigest()},
        )

    async def queue_reply(
        self, body: GoogleReplyCreate, key: str, *, remove: bool
    ) -> GoogleOperationOut:
        self.authorize()
        if not key or len(key) > 200:
            raise Conflict("an idempotency key is required")
        comment = body.comment.strip() if body.comment else ""
        if not remove and (not comment or len(comment.encode()) > 4096):
            raise Conflict("reply must contain between 1 and 4096 bytes")
        digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        kind = "reply_delete" if remove else "reply_put"
        await google_lock(self.db, self.biz)
        existing = await self.db.scalar(
            scoped(GoogleBusinessOperation, self.biz)
            .execution_options(populate_existing=True)
            .where(
                GoogleBusinessOperation.kind == kind, GoogleBusinessOperation.idempotency_key == key
            )
        )
        if existing:
            if existing.request_hash != digest:
                raise Conflict(
                    "idempotency key was used for another reply", code="idempotency_key_reused"
                )
            return GoogleOperationOut(id=existing.id, state=existing.state)
        row = await self.connection(active=True)
        name = review_name(
            review_parent(row.account_name or "", row.location_name or ""), body.review_id
        )
        pending = await self.db.scalar(
            scoped(GoogleBusinessOperation, self.biz)
            .execution_options(populate_existing=True)
            .where(
                GoogleBusinessOperation.review_name == name,
                GoogleBusinessOperation.state.in_(("queued", "running", "unknown")),
            )
        )
        if pending:
            raise Conflict("another reply operation is pending", code="google_stale_reply")
        operation = GoogleBusinessOperation(
            id=new_id("google_operation"),
            business_id=self.biz,
            connection_id=row.id,
            actor_id=self.principal.user_id,
            generation=row.generation,
            kind=kind,
            review_name=name,
            request_hash=digest,
            idempotency_key=key,
            expected_reply_revision=body.expected_reply_revision,
            state="queued",
            attempts=0,
            next_at=clock.now(),
        )
        if not remove:
            operation.request_ciphertext, operation.key_version = await self.vault.seal(
                comment, f"{self.biz}:{operation.id}"
            )
        self.db.add(operation)
        await self.db.flush()
        return GoogleOperationOut(id=operation.id, state=operation.state)

    async def operation(self, operation_id: str) -> GoogleOperationOut:
        self.authorize()
        operation = await self.db.scalar(
            scoped(GoogleBusinessOperation, self.biz)
            .execution_options(populate_existing=True)
            .where(GoogleBusinessOperation.id == operation_id)
        )
        if operation is None:
            raise NotFound("Google operation not found")
        return GoogleOperationOut(id=operation.id, state=operation.state)

    async def execute_operation(self, operation_id: str) -> None:
        self.authorize()
        await google_lock(self.db, self.biz)
        operation = await self.db.scalar(
            scoped(GoogleBusinessOperation, self.biz)
            .execution_options(populate_existing=True)
            .where(GoogleBusinessOperation.id == operation_id)
        )
        if operation is None or operation.state not in ("queued", "running", "unknown"):
            return
        row = await self.db.scalar(
            scoped(GoogleBusinessConnection, self.biz).execution_options(populate_existing=True)
        )
        if (
            row is None
            or row.state != "active"
            or row.id != operation.connection_id
            or row.generation != operation.generation
            or clock.now() - operation.created_at >= timedelta(days=7)
        ):
            operation.state = "canceled"
            operation.request_ciphertext = None
            operation.key_version = None
            operation.expected_reply_revision = None
            await self.db.commit()
            return
        try:
            token = await self.token(row)
            current = await self.gateway.review(token, operation.review_name)
            desired = (
                None
                if operation.kind == "reply_delete"
                else await self.vault.open(
                    operation.request_ciphertext or b"", f"{self.biz}:{operation.id}"
                )
            )
            matches = (
                current.reply is None
                if desired is None
                else current.reply is not None and current.reply.comment == desired
            )
            revision = (
                current.reply.update_time.isoformat().replace("+00:00", "Z")
                if current.reply and current.reply.update_time
                else None
            )
            if matches:
                operation.state = "confirmed"
            elif operation.state in ("running", "unknown"):
                operation.state = "unknown"
                operation.next_at = clock.now() + timedelta(minutes=5)
            elif revision != operation.expected_reply_revision:
                operation.state = "failed"
                operation.error_code = "google_stale_reply"
            else:
                operation.state = "running"
                operation.attempts += 1
                operation.lease_until = clock.now() + timedelta(minutes=2)
                await self.db.commit()
                await google_lock(self.db, self.biz)
                await self.db.refresh(row)
                await self.db.refresh(operation)
                if row.generation != operation.generation or operation.state != "running":
                    return
                if desired is None:
                    await self.gateway.delete_reply(token, operation.review_name)
                else:
                    await self.gateway.put_reply(token, operation.review_name, desired)
                operation.state = "confirmed"
        except GoogleBusinessError as error:
            operation.error_code = error.code
            operation.state = "unknown" if operation.state == "running" else "queued"
            operation.next_at = clock.now() + timedelta(minutes=5)
        if operation.state in ("confirmed", "failed", "canceled"):
            operation.request_ciphertext = None
            operation.key_version = None
            operation.expected_reply_revision = None
        await self.db.commit()


def valid_google_review_url(value: str | None) -> bool:
    if not value:
        return False
    url = urlsplit(value)
    return (
        url.scheme == "https"
        and url.hostname in {"search.google.com", "g.page", "www.google.com", "maps.google.com"}
        and not url.username
        and not url.password
    )


async def complete_google_callback(
    state: str,
    code: str | None,
    error: str | None,
    gateway: GoogleBusinessGateway,
    vault: GoogleSecretStore,
    flows: GoogleFlowStore,
) -> str:
    raw = await flows.pop(f"callback:{state}")
    if raw is None:
        raise Conflict("Google authorization expired")
    flow = GoogleFlow.model_validate_json(raw)
    if flow.expires_at <= clock.now():
        raise Conflict("Google authorization expired")
    try:
        if error or not code:
            raise Conflict("Google authorization was declined")
        tokens = await gateway.exchange(code, flow.verifier)
        if not tokens.refresh_token:
            raise Conflict("Google did not grant offline access")
        ciphertext, version = await vault.seal(
            tokens.refresh_token, f"{flow.business_id}:{flow.connection_id}"
        )
        flow.ciphertext = base64.b64encode(ciphertext).decode()
        flow.key_version = version
        flow.state = "complete"
    except (GoogleBusinessError, Conflict):
        flow.state = "failed"
    flow.verifier = ""
    await flows.put(
        f"flow:{flow.handle}",
        flow.model_dump_json(),
        ttl=max(1, min(120, int((flow.expires_at - clock.now()).total_seconds()))),
    )
    return (
        "clientbridge://reviews/google"
        if flow.platform == "native"
        else f"{get_settings().web_base_url}/inbox?segment=reviews"
    )


async def run_google_operations(
    db: AsyncSession,
    gateway: GoogleBusinessGateway,
    vault: GoogleSecretStore,
    flows: GoogleFlowStore,
) -> int:
    await db.execute(
        update(GoogleBusinessOperation)
        .where(
            GoogleBusinessOperation.state.in_(("queued", "running", "unknown")),
            GoogleBusinessOperation.created_at <= clock.now() - timedelta(days=7),
        )
        .values(
            state="canceled",
            request_ciphertext=None,
            key_version=None,
            expected_reply_revision=None,
        )
    )
    await db.commit()
    if not google_business_enabled():
        return 0
    due = list(
        await db.scalars(
            select(GoogleBusinessOperation)
            .where(
                GoogleBusinessOperation.state.in_(("queued", "running", "unknown")),
                or_(
                    GoogleBusinessOperation.next_at.is_(None),
                    GoogleBusinessOperation.next_at <= clock.now(),
                ),
                or_(
                    GoogleBusinessOperation.lease_until.is_(None),
                    GoogleBusinessOperation.lease_until <= clock.now(),
                ),
            )
            .order_by(GoogleBusinessOperation.created_at)
            .limit(50)
        )
    )
    for operation in due:
        staff = await db.scalar(
            scoped(Staff, operation.business_id).where(
                Staff.user_id == operation.actor_id, Staff.status == "active"
            )
        )
        if staff is None or staff.user_id is None or not is_manager(staff.role):
            operation.state = "canceled"
            operation.request_ciphertext = None
            operation.key_version = None
            operation.expected_reply_revision = None
            await db.commit()
            continue
        principal = Principal(
            user_id=staff.user_id, business_id=staff.business_id, staff_id=staff.id, role=staff.role
        )
        await GoogleReviewService(db, principal, gateway, vault, flows).execute_operation(
            operation.id
        )
    return len(due)


async def google_invitation_url(db: AsyncSession, business_id: str) -> str | None:
    if not google_business_enabled():
        return None
    await google_lock(db, business_id)
    row = await db.scalar(
        scoped(GoogleBusinessConnection, business_id).execution_options(populate_existing=True)
    )
    if (
        row is None
        or row.state != "active"
        or not row.refresh_token_ciphertext
        or not row.location_name
    ):
        return None
    gateway, vault = get_google_business_gateway(), get_google_secret_store()
    try:
        refresh = await vault.open(row.refresh_token_ciphertext, f"{business_id}:{row.id}")
        tokens = await gateway.refresh(refresh)
        if tokens.refresh_token:
            row.refresh_token_ciphertext, row.key_version = await vault.seal(
                tokens.refresh_token, f"{business_id}:{row.id}"
            )
        location = await gateway.location(tokens.access_token, row.location_name)
        await gateway.reviews(
            tokens.access_token, review_parent(row.account_name or "", row.location_name)
        )
    except GoogleBusinessError as error:
        row.last_error_code = error.code
        if error.code == "google_reconnect_required":
            row.state = "reconnect_required"
        return None
    link = location.metadata.new_review_uri
    return link if valid_google_review_url(link) else None
