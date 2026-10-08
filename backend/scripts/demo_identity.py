from clientbridge.core.security import hash_password
from clientbridge.models.base import TimestampMixin
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, Webhook
from scripts.demo_context import DemoContext


def build_identity(ctx: DemoContext) -> None:
    for user in ctx.all(User):
        user.email_verified_at = ctx.at(-450)
        user.pin_hash = hash_password("2468")
    ctx.add(
        User(
            id="us_admin",
            email="admin@birchbarkpets.ca",
            name="Alex Chen",
            password_hash=hash_password("demo1234"),
            pin_hash=hash_password("2468"),
            email_verified_at=ctx.at(-450),
        ),
        Staff(
            id="st_admin",
            business_id=ctx.business_id,
            user_id="us_admin",
            name="Alex Chen",
            role="admin",
            title="Studio manager",
            status="active",
            payee=False,
        ),
        Business(
            id="bz_demo_second",
            name="Cedar Coast Pet Care",
            slug="cedar-coast-demo",
            timezone="America/Vancouver",
            province="BC",
            status="active",
            brand={"tagline": "A separate demo business for tenant isolation checks."},
        ),
        User(
            id="us_second_owner",
            email="owner@cedarcoast.example.test",
            name="Rowan Ellis",
            password_hash=hash_password("demo1234"),
            pin_hash=hash_password("2468"),
            email_verified_at=ctx.at(-450),
        ),
        Staff(
            id="st_owner_second",
            business_id="bz_demo_second",
            user_id="us_second_owner",
            name="Rowan Ellis",
            role="owner",
            status="active",
            payee=False,
        ),
        Client(
            id="cl_second_private",
            business_id="bz_demo_second",
            name="Cedar Private Client",
            email="cedar.client@example.test",
            status="active",
        ),
    )
    for row in ctx.rows:
        if isinstance(row, TimestampMixin):
            row.created_at = row.created_at or ctx.at(-450)
            row.updated_at = row.updated_at or row.created_at
    for invoice in ctx.all(Invoice):
        if invoice.status == "sent":
            invoice.pay_token = f"demo_pay_{invoice.id}"
        paid = sum(
            p.amount_cents
            for p in ctx.all(Payment)
            if p.invoice_id == invoice.id and p.status == "succeeded" and p.kind != "refund"
        )
        if paid >= invoice.total_cents:
            invoice.overdue_notified_at = None
    for estimate in ctx.all(Estimate):
        estimate.view_token = f"demo_estimate_{estimate.id}"
    ctx.get(Client, "cl_sophie").created_at = ctx.at(-30)
    ctx.get(Client, "cl_fatima").created_at = ctx.at(-30)
    ctx.rows[:] = [row for row in ctx.rows if not isinstance(row, Webhook)]
    for audit in ctx.all(Audit):
        if audit.entity_type == "client":
            client = ctx.get(Client, audit.entity_id)
            audit.created_at = client.created_at
