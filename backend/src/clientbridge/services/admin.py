from pathlib import Path
from typing import Literal
from urllib.parse import quote

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Select, and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, PublicPrincipal, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.db import Base
from clientbridge.core.deps import assert_platform_access
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ratelimit import RateLimiter, allow_action
from clientbridge.core.scoping import scoped
from clientbridge.integrations.expo import get_push_sender
from clientbridge.integrations.identity import Identity
from clientbridge.integrations.resend import EmailSender
from clientbridge.integrations.twilio import get_sms_sender
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.clients import Client
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.messaging import Delivery, Thread
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, Webhook
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.admin import (
    AdminAccessInfo,
    AdminActivity,
    AdminBusiness,
    AdminBusinessDetail,
    AdminClient,
    AdminDelivery,
    AdminEmailConfig,
    AdminEmailPreview,
    AdminEmailResult,
    AdminEmailSend,
    AdminLedgerLeg,
    AdminMembership,
    AdminOperations,
    AdminOverview,
    AdminPage,
    AdminPayment,
    AdminPaymentDetail,
    AdminPersonDetail,
    AdminSmsAssignment,
    AdminUser,
    AdminWebhook,
)
from clientbridge.schemas.deliveries import EmailDelivery
from clientbridge.services.business import staff_name
from clientbridge.services.deliveries import dispatch, enqueue

_send_limit = RateLimiter(5, 60)


def _scope[T: Base](model: type[T], business_id: str | None) -> Select[tuple[T]]:
    return scoped(model, business_id) if business_id else select(model)


class AdminService:
    def __init__(self, db: AsyncSession, identity: Identity) -> None:
        assert_platform_access(identity)
        self.db = db
        self.identity = identity

    async def _count[T: Base](self, query: Select[tuple[T]]) -> int:
        return int(await self.db.scalar(select(func.count()).select_from(query.subquery())) or 0)

    async def businesses(self, q: str, offset: int) -> AdminPage[AdminBusiness]:
        query = select(Business)
        if q:
            query = query.where(
                or_(
                    Business.name.icontains(q, autoescape=True),
                    Business.id == q,
                    Business.slug.icontains(q, autoescape=True),
                )
            )
        rows = (
            await self.db.scalars(
                query.order_by(Business.created_at.desc(), Business.id).offset(offset).limit(51)
            )
        ).all()
        return AdminPage(
            items=[AdminBusiness.model_validate(row) for row in rows[:50]], has_more=len(rows) > 50
        )

    async def business(self, business_id: str) -> AdminBusinessDetail:
        row = await self.db.get(Business, business_id)
        if row is None:
            raise NotFound("business not found")
        name = staff_name().label("name")
        staff = (
            await self.db.execute(
                scoped(Staff, business_id).add_columns(name).order_by(name, Staff.id).limit(100)
            )
        ).tuples()
        return AdminBusinessDetail(
            business=AdminBusiness.model_validate(row),
            staff=[
                AdminMembership(
                    business_id=row.id,
                    business_name=row.name,
                    user_id=s.user_id,
                    name=member_name,
                    role=s.role,
                    status=s.status,
                )
                for s, member_name in staff
            ],
            clients=await self._count(scoped(Client, business_id, soft_delete=True)),
            payments=await self._count(scoped(Payment, business_id)),
        )

    async def users(self, q: str, offset: int) -> AdminPage[AdminUser]:
        query = select(User)
        if q:
            query = query.where(
                or_(
                    User.name.icontains(q, autoescape=True),
                    User.email.icontains(q, autoescape=True),
                    User.id == q,
                )
            )
        rows = (
            await self.db.scalars(
                query.order_by(User.created_at.desc(), User.id).offset(offset).limit(51)
            )
        ).all()
        return AdminPage(
            items=[AdminUser.model_validate(row) for row in rows[:50]], has_more=len(rows) > 50
        )

    async def person(self, user_id: str) -> AdminPersonDetail:
        user = await self.db.get(User, user_id)
        if user is None:
            raise NotFound("user not found")
        members = (
            await self.db.execute(
                select(Staff, Business.name)
                .join(Business, Business.id == Staff.business_id)
                .where(Staff.user_id == user_id)
                .limit(100)
            )
        ).all()
        clients = (
            await self.db.scalars(
                select(Client)
                .where(Client.user_id == user_id, Client.deleted_at.is_(None))
                .limit(100)
            )
        ).all()
        return AdminPersonDetail(
            user=AdminUser.model_validate(user),
            memberships=[
                AdminMembership(
                    business_id=s.business_id,
                    business_name=name,
                    user_id=s.user_id,
                    name=user.name,
                    role=s.role,
                    status=s.status,
                )
                for s, name in members
            ],
            clients=[AdminClient.model_validate(c) for c in clients],
        )

    async def clients(self, q: str, business_id: str | None, offset: int) -> AdminPage[AdminClient]:
        query = _scope(Client, business_id).where(Client.deleted_at.is_(None))
        if q:
            query = query.where(
                or_(
                    Client.name.icontains(q, autoescape=True),
                    Client.email.icontains(q, autoescape=True),
                    Client.id == q,
                )
            )
        rows = (
            await self.db.scalars(
                query.order_by(Client.created_at.desc(), Client.id).offset(offset).limit(51)
            )
        ).all()
        return AdminPage(
            items=[AdminClient.model_validate(row) for row in rows[:50]], has_more=len(rows) > 50
        )

    async def payments(
        self, q: str, business_id: str | None, status: str | None, offset: int
    ) -> AdminPage[AdminPayment]:
        query = _scope(Payment, business_id)
        if status:
            query = query.where(Payment.status == status)
        if q:
            query = query.where(
                or_(
                    Payment.id == q,
                    Payment.provider_ref == q,
                    Payment.invoice_id == q,
                    Payment.client_id == q,
                    Payment.order_id == q,
                    Payment.booking_id == q,
                )
            )
        rows = (
            await self.db.execute(
                query.add_columns(Business.name)
                .join(Business, Business.id == Payment.business_id)
                .order_by(Payment.created_at.desc(), Payment.id)
                .offset(offset)
                .limit(51)
            )
        ).all()
        return AdminPage(
            items=[
                AdminPayment.model_validate(row).model_copy(update={"business_name": name})
                for row, name in rows[:50]
            ],
            has_more=len(rows) > 50,
        )

    async def payment(self, payment_id: str) -> AdminPaymentDetail:
        row = await self.db.get(Payment, payment_id)
        if row is None:
            raise NotFound("payment not found")
        business = (await self.business(row.business_id)).business
        client = (
            await self.db.scalar(scoped(Client, row.business_id).where(Client.id == row.client_id))
            if row.client_id
            else None
        )
        refunds = (
            await self.db.scalars(
                scoped(Payment, row.business_id)
                .where(Payment.parent_payment_id == row.id)
                .order_by(Payment.created_at.desc())
                .limit(100)
            )
        ).all()
        entries = (
            await self.db.execute(
                scoped(Entry, row.business_id)
                .add_columns(Account.category)
                .join(Account, Account.id == Entry.account_id)
                .where(or_(Entry.source_id == row.id, Entry.subject_id == row.id))
                .order_by(Entry.occurred_at.desc(), Entry.id)
                .limit(100)
            )
        ).all()
        stripe_url = None
        if (
            row.provider == "stripe"
            and row.provider_ref
            and row.provider_ref.startswith("pi_")
            and business.stripe_account_id
        ):
            mode = "test/" if get_settings().stripe_secret_key.startswith("sk_test_") else ""
            account = quote(business.stripe_account_id, safe="")
            ref = quote(row.provider_ref, safe="")
            stripe_url = f"https://dashboard.stripe.com/{account}/{mode}payments/{ref}"
        return AdminPaymentDetail(
            payment=AdminPayment.model_validate(row),
            business=business,
            client=AdminClient.model_validate(client) if client else None,
            refunds=[AdminPayment.model_validate(r) for r in refunds],
            entries=[
                AdminLedgerLeg(
                    id=e.id,
                    journal_id=e.journal_id,
                    account_id=e.account_id,
                    account_category=category,
                    event=e.event,
                    amount_cents=e.amount_cents,
                    currency=e.currency,
                    occurred_at=e.occurred_at,
                )
                for e, category in entries
            ],
            stripe_url=stripe_url,
        )

    async def activity(
        self, q: str, business_id: str | None, offset: int
    ) -> AdminPage[AdminActivity]:
        query = _scope(Audit, business_id)
        if q:
            matches = [
                Audit.entity_id == q,
                Audit.performed_by == q,
                Audit.action.icontains(q, autoescape=True),
            ]
            if q.startswith("cl_"):
                for model, entity in (
                    (Booking, "booking"),
                    (Invoice, "invoice"),
                    (Order, "order"),
                    (Payment, "payment"),
                    (Signature, "signature"),
                    (FormResponse, "form_response"),
                    (Thread, "thread"),
                ):
                    related = (
                        _scope(model, business_id)
                        .with_only_columns(model.id)
                        .where(model.client_id == q)
                    )
                    matches.append(and_(Audit.entity_type == entity, Audit.entity_id.in_(related)))
            query = query.where(or_(*matches))
        rows = (
            await self.db.execute(
                query.add_columns(Business.name, User.name)
                .join(Business, Business.id == Audit.business_id)
                .outerjoin(User, User.id == Audit.performed_by)
                .order_by(Audit.created_at.desc(), Audit.id)
                .offset(offset)
                .limit(51)
            )
        ).all()
        return AdminPage(
            items=[
                AdminActivity.model_validate(row).model_copy(
                    update={"business_name": name, "actor_name": actor}
                )
                for row, name, actor in rows[:50]
            ],
            has_more=len(rows) > 50,
        )

    async def overview(self) -> AdminOverview:
        return AdminOverview(
            businesses=await self._count(select(Business)),
            users=await self._count(select(User)),
            clients=await self._count(select(Client).where(Client.deleted_at.is_(None))),
            failed_payments=await self._count(select(Payment).where(Payment.status == "failed")),
            failed_webhooks=await self._count(select(Webhook).where(Webhook.status == "failed")),
            recent_businesses=(await self.businesses("", 0)).items[:5],
            activity=(await self.activity("", None, 0)).items[:8],
        )

    async def operations(self, status: str | None, offset: int) -> AdminOperations:
        query = select(Webhook)
        if status:
            query = query.where(Webhook.status == status)
        rows = (
            await self.db.scalars(
                query.order_by(Webhook.created_at.desc(), Webhook.id).offset(offset).limit(51)
            )
        ).all()
        settings = get_settings()
        cfg = Config()
        packaged = Path(__file__).resolve().parents[1] / "migrations"
        migrations = (
            packaged if packaged.is_dir() else Path(__file__).resolve().parents[3] / "migrations"
        )
        cfg.set_main_option("script_location", str(migrations))
        email = self.email_config()
        return AdminOperations(
            environment=settings.env,
            database_revision=list(
                (await self.db.scalars(text("SELECT version_num FROM alembic_version"))).all()
            ),
            expected_revision=list(ScriptDirectory.from_config(cfg).get_heads()),
            webhooks=AdminPage(
                items=[AdminWebhook.model_validate(row) for row in rows[:50]],
                has_more=len(rows) > 50,
            ),
            pending_webhooks=await self._count(select(Webhook).where(Webhook.status == "pending")),
            failed_webhooks=await self._count(select(Webhook).where(Webhook.status == "failed")),
            email_transports=email.email_transports,
            email_transport=email.email_transports[0] if email.email_transports else "unconfigured",
        )

    def access(self) -> AdminAccessInfo:
        settings = get_settings()
        return AdminAccessInfo(
            identity_id=self.identity.id,
            email=self.identity.email,
            environment=settings.env,
            development_grant=settings.env == "dev"
            and self.identity.id
            in {v.strip() for v in settings.dev_platform_admin_identity_ids.split(",")},
            second_factor=self.identity.second_factor,
        )

    def email_config(self) -> AdminEmailConfig:
        settings = get_settings()
        transports: list[Literal["smtp", "resend"]] = []
        if settings.smtp_url:
            transports.append("smtp")
        if settings.resend_api_key and settings.email_from:
            transports.append("resend")
        return AdminEmailConfig(email_transports=transports)

    def email_preview(self, key: str) -> AdminEmailPreview:
        from clientbridge.services.email_samples import browser_html, samples

        mail = samples().get(key)
        if mail is None:
            raise NotFound("email sample not found")
        return AdminEmailPreview(
            key=key, subject=mail.subject, html=browser_html(mail), text=mail.body
        )

    async def send_email(
        self, key: str, body: AdminEmailSend, sender: EmailSender
    ) -> AdminEmailResult:
        from dataclasses import replace

        from clientbridge.core.errors import AppError, TooManyRequests
        from clientbridge.services.email_samples import samples

        mail = samples().get(key)
        if mail is None:
            raise NotFound("email sample not found")
        settings = get_settings()
        available = (body.transport == "smtp" and bool(settings.smtp_url)) or (
            body.transport == "resend" and bool(settings.resend_api_key and settings.email_from)
        )
        if not available:
            raise AppError(
                "email transport unavailable", code="email_transport_unavailable", status_code=503
            )
        if not await allow_action(self.identity.id, "admin-email", _send_limit):
            raise TooManyRequests("email test rate exceeded")
        demo = replace(
            mail,
            to=str(body.recipient),
            subject=f"[TEST] {mail.subject}",
            reply_to=None,
            idempotency_key=f"admin-test/{self.identity.id}/{body.request_id}",
            tags={"purpose": "email-preview", "sample": key, "actor": self.identity.id},
        )
        identity = await enqueue(
            self.db,
            EmailDelivery(message=demo, transport=body.transport),
            key=f"admin:{self.identity.id}:{body.request_id}",
            business_id=None,
        )
        await self.db.commit()
        await dispatch(
            self.db, identity, sender, get_sms_sender(), get_push_sender(), transport_override=True
        )
        delivery = await self.db.get(Delivery, identity)
        assert delivery is not None
        return AdminEmailResult(delivery_id=identity, state=delivery.state)

    async def deliveries(self, offset: int) -> AdminPage[AdminDelivery]:
        rows = list(
            await self.db.scalars(
                select(Delivery)
                .where(Delivery.key.startswith("admin:"))
                .order_by(Delivery.created_at.desc(), Delivery.id.desc())
                .offset(offset)
                .limit(51)
            )
        )
        items: list[AdminDelivery] = []
        for row in rows[:50]:
            mail = EmailDelivery.model_validate(row.payload).message
            items.append(
                AdminDelivery(
                    id=row.id,
                    business_id=row.business_id,
                    state=row.state,
                    created_at=row.created_at,
                    provider_ref=row.provider_ref,
                    error=row.error,
                    recipient=mail.to,
                    subject=mail.subject,
                    actor=mail.tags.get("actor"),
                )
            )
        return AdminPage(items=items, has_more=len(rows) > 50)

    async def assign_sms(self, business_id: str, body: AdminSmsAssignment) -> AdminBusiness:
        async def run(cmd: Command) -> AdminBusiness:
            if body.number is not None:
                await self.db.execute(
                    select(
                        func.pg_advisory_xact_lock(func.hashtextextended(f"sms:{body.number}", 0))
                    )
                )
            business = await self.db.scalar(
                select(Business)
                .where(Business.id == business_id)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
            if business is None:
                raise NotFound("business not found")
            if business.sms_number == body.number:
                return AdminBusiness.model_validate(business)
            if body.number is not None:
                owner = await self.db.scalar(
                    select(Business.id).where(Business.sms_number == body.number)
                )
                retired = await self.db.scalar(
                    select(Audit.id)
                    .where(
                        Audit.action == "business.sms_assignment",
                        Audit.business_id != business_id,
                        or_(
                            Audit.changes["old"].astext == body.number,
                            Audit.changes["new"].astext == body.number,
                        ),
                    )
                    .limit(1)
                )
                if (owner is not None and owner != business_id) or retired is not None:
                    raise Conflict(
                        "SMS number belongs to another business", code="sms_number_unavailable"
                    )
            previous = business.sms_number
            business.sms_number = body.number
            cmd.record(
                "business.sms_assignment",
                entity_type="business",
                entity_id=business_id,
                changes={"old": previous, "new": body.number, "identity_id": self.identity.id},
            )
            await self.db.flush()
            return AdminBusiness.model_validate(business)

        return await run_command(
            self.db,
            PublicPrincipal(business_id),
            action="business.sms_assignment",
            run=run,
            response_model=AdminBusiness,
        )
