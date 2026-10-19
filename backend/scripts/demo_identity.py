from dataclasses import asdict
from datetime import time, timedelta
from uuid import NAMESPACE_URL, uuid5

from clientbridge.models.base import TimestampMixin
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import FieldInput, Form, FormField
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, Webhook
from clientbridge.models.scheduling import Hours
from scripts.demo_context import LEGAL_ADDRESSES, DemoContext

SECOND = "bz_demo_second"
# name, input, label, help, required, options
SECOND_FORM: tuple[tuple[str, FieldInput, str, str | None, bool, tuple[str, ...]], ...] = (
    ("owner_phone", "phone", "Mobile number", None, True, ()),
    ("home_address", "address", "Address for visits", None, True, ()),
    (
        "entry",
        "longtext",
        "How do we get in?",
        "Lockbox location, key pick-up or a door code. Only your walker sees this.",
        True,
        (),
    ),
    ("alarm", "text", "Alarm instructions", None, False, ()),
    ("pet_names", "text", "Your pets' names", None, True, ()),
    ("feeding", "longtext", "Feeding and treats", None, False, ()),
    (
        "walks",
        "multiselect",
        "On walks",
        None,
        False,
        ("Pulls on the leash", "Reactive to dogs", "Nervous around traffic", "Fine off leash"),
    ),
    ("vet", "text", "Veterinary clinic", None, True, ()),
    ("emergency_phone", "phone", "Emergency contact phone", None, True, ()),
    (
        "key_consent",
        "checkbox",
        "Cedar Coast may keep my key or lockbox code for booked visits.",
        None,
        True,
        (),
    ),
)
# id, name, price, minutes, description
SECOND_ITEMS = (
    ("it_second_walk", "Dog Walk (45 min)", 3200, 45, "A neighbourhood walk, up to three dogs."),
    ("it_second_visit", "Drop-in Visit", 2800, 30, "Feeding, fresh water and a short play."),
    ("it_second_bath", "Quick Bath", 4000, 45, "Bath, towel and blow-dry, nails included."),
)


def placeholder_identity(email: str) -> str:
    """Stable until the seed links the real auth identity, so the demo graph builds offline."""
    return str(uuid5(NAMESPACE_URL, f"clientbridge-demo:{email}"))


def build_identity(ctx: DemoContext) -> None:
    ctx.add(
        User(
            id="us_admin",
            identity_id=placeholder_identity("admin@birchbark.example"),
            email="admin@birchbark.example",
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
            bookable_online=False,
        ),
        Business(
            id=SECOND,
            name="Cedar Coast Pet Care",
            slug="cedar-coast-demo",
            subject="pet",
            timezone="America/Vancouver",
            **asdict(LEGAL_ADDRESSES[SECOND]),
            status="active",
            plan="team",
            plan_status="trialing",
            trial_ends_at=ctx.now + timedelta(days=14),
            brand={
                "tagline": "Dog walks and drop-in visits in downtown Vancouver.",
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
            business_id=SECOND,
            user_id="us_second_owner",
            role="owner",
            status="active",
            payee=False,
            bookable_online=True,
        ),
        Client(
            id="cl_second_private",
            business_id=SECOND,
            name="Morgan Fraser",
            email="morgan.f@example.test",
            phone="+16045550150",
            status="active",
        ),
        Subject(
            id="sj_second_tofu",
            business_id=SECOND,
            client_id="cl_second_private",
            name="Tofu",
            attributes={
                "species": "dog",
                "breed": "Shiba Inu",
                "weight_kg": 10,
                "temperament": "calm",
            },
        ),
        *(
            Item(
                id=item_id,
                business_id=SECOND,
                created_by="us_second_owner",
                kind="service",
                name=name,
                description=description,
                price_cents=price,
                currency="CAD",
                tax_class="federal_only",
                duration_min=minutes,
                capacity=1,
                online_bookable=True,
                active=True,
            )
            for item_id, name, price, minutes, description in SECOND_ITEMS
        ),
        *(
            Hours(
                id=f"av_st_owner_second_{weekday}",
                business_id=SECOND,
                staff_id="st_owner_second",
                basis="recurring",
                weekday=weekday,
                start_time=time(8, 0),
                end_time=time(16, 0),
                available=True,
            )
            for weekday in range(5)
        ),
        Form(
            id="frm_second_visits",
            business_id=SECOND,
            name="Home visit details",
            require_signature=False,
            active=True,
            send_on="booking",
        ),
        *(
            FormField(
                id=f"ff_second_{name}",
                business_id=SECOND,
                form_id="frm_second_visits",
                name=name,
                input=kind,
                label=label,
                help=hint,
                required=required,
                options=list(options),
                position=position,
            )
            for position, (name, kind, label, hint, required, options) in enumerate(SECOND_FORM)
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
