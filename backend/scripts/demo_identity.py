from uuid import NAMESPACE_URL, uuid5

from clientbridge.models.base import TimestampMixin
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, Webhook
from scripts.demo_context import DemoContext


def placeholder_identity(email: str) -> str:
    """Stable until the seed links the real auth identity, so the demo graph builds offline."""
    return str(uuid5(NAMESPACE_URL, f"clientbridge-demo:{email}"))


def build_identity(ctx: DemoContext) -> None:
    ctx.add(
        User(
            id="us_admin",
            identity_id=placeholder_identity("admin@birchbarkpets.ca"),
            email="admin@birchbarkpets.ca",
            name="Alex Chen",
        ),
        Staff(
            id="st_admin",
            business_id=ctx.business_id,
            user_id="us_admin",
            role="admin",
            title="Studio manager",
            status="active",
            payee=False,
        ),
        Business(
            id="bz_demo_second",
            name="Cedar Coast Pet Care",
            slug="cedar-coast-demo",
            subject="pet",
            timezone="America/Vancouver",
            province="BC",
            street_number="455",
            street_name="Granville Street",
            city="Vancouver",
            postal_code="V6C 1T1",
            legal_phone="+16045550120",
            status="active",
            plan="team",
            plan_status="active",
            brand={
                "tagline": "A separate demo business for tenant isolation checks.",
                "address": "455 Granville Street, Vancouver, BC V6C 1T1",
            },
        ),
        User(
            id="us_second_owner",
            identity_id=placeholder_identity("owner@cedarcoast.example.test"),
            email="owner@cedarcoast.example.test",
            name="Rowan Ellis",
        ),
        Staff(
            id="st_owner_second",
            business_id="bz_demo_second",
            user_id="us_second_owner",
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
