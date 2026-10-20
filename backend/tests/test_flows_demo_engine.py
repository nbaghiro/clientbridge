from dataclasses import replace
from datetime import time, timedelta

from scripts.demo_context import DemoBusiness, LegalAddress
from scripts.demo_engine import Demo, Quote, build_edition, seed_ledger
from scripts.demo_spec import (
    BusinessSpec,
    ContractSpec,
    FormSpec,
    Offering,
    Pacing,
    Person,
    Stage,
    Stock,
)
from scripts.demo_validate import validate_database
from scripts.seed_demo import INSERT_ORDER
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.catalog import Package
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger

PROBE = "bz_engine_probe"
WEEK = {day: (time(8), time(17)) for day in range(6)}

SPEC = BusinessSpec(
    listing=DemoBusiness(
        id=PROBE,
        name="Engine Probe",
        email="hello@probe.example",
        first_name="Pat",
        last_name="Probe",
        product_description="A business that uses every engine block",
        primary_color="#3F5E80",
        legal=LegalAddress("10", "Jasper Avenue", "Edmonton", "AB", "T5J 1N8", "+17805550150"),
        owner_login="owner@probe.example",
        timezone="America/Edmonton",
    ),
    code="pb",
    slug="engine-probe",
    login_domain="probe.example",
    assets="nl",
    owner="us_pb_owner",
    people=(
        Person(
            "us_pb_owner",
            "st_pb_owner",
            "owner",
            "Pat Probe",
            "+17805550151",
            "owner",
            "Owner",
            "#3F5E80",
            WEEK,
            photo=False,
        ),
        Person(
            "us_pb_kai",
            "st_pb_kai",
            "kai",
            "Kai Probe",
            "+17805550152",
            "staff",
            "Tech",
            "#2E7A5A",
            WEEK,
            payee=True,
            rate_type="percent",
            rate_bps=4000,
            photo=False,
        ),
    ),
    items=(
        Offering(
            "it_pb_survey",
            "service",
            "Visit",
            9000,
            "Visits",
            "A visit.",
            "standard",
            minutes=60,
            online_bookable=True,
            buffer_after_min=15,
        ),
        Offering(
            "it_pb_service_call",
            "service",
            "Big visit",
            20000,
            "Visits",
            "A big visit.",
            "standard",
            minutes=120,
            deposit_type="fixed",
            deposit_value=5000,
        ),
        Offering(
            "it_pb_system_check",
            "class",
            "Workshop",
            3000,
            "Classes",
            "A workshop.",
            "standard",
            minutes=60,
            capacity=4,
        ),
        Offering(
            "it_pb_turret",
            "product",
            "Part",
            4000,
            "Parts",
            "A part.",
            "standard",
            addon_for=("it_pb_service_call",),
            sku="PB-1",
            cost_cents=1500,
            stock=Stock(12, 3),
        ),
        Offering(
            "it_pb_remote_viewing",
            "subscription",
            "Plan",
            2500,
            "Plans",
            "A plan.",
            "standard",
            frequency="month",
            ref="plan",
            contract="con_pb_plan",
        ),
        Offering(
            "it_pb_maintenance",
            "package",
            "Three visits",
            24000,
            "Packages",
            "Three visits.",
            "standard",
            sessions=3,
            covers="it_pb_survey",
            ref="three",
        ),
        Offering("it_pb_install_home", "gift", "Gift card", 0, "Gifts", "A gift card.", "exempt"),
    ),
    brand={"tagline": "A probe of the demo engine."},
    booking_policy={"approve_new_clients": False},
    subject=None,
    sms_number="+17805550159",
    gst_hst_number="123456789RT0001",
    forms=(
        FormSpec(
            "frm_pb_intake",
            "Intake",
            "ff_pb_",
            (("goal", "text", "Goal", None, True, ()),),
            send_on="booking",
        ),
    ),
    contracts=(
        ContractSpec(
            "con_pb_terms",
            "Terms",
            "Current terms.",
            version=2,
            earlier_body="First terms.",
            revised_day=-60,
        ),
        ContractSpec("con_pb_plan", "Plan terms", "Plan terms."),
    ),
    storyline=(
        Stage("Estimate sent with optional lines", "quote", ("est_pb_quote",)),
        Stage("Booked from the estimate, deposit paid", "booked", ("bk_pb_booked",)),
        Stage("Paid by Tap to Pay", "tap", ("ord_pb_tap",)),
    ),
    pacing=Pacing(
        {"st_pb_owner": 3, "st_pb_kai": 4},
        ("it_pb_survey",),
        weeks=12,
        seasonality={7: 0.5},
        no_show_every=17,
        cancel_every=23,
    ),
)
CLIENTS = (
    "quote",
    "booked",
    "tap",
    "pack",
    "gift",
    "tipper",
    "cash",
    "series",
    "class_a",
    "class_b",
    "class_c",
    "plan",
    "away",
    "regular_a",
    "regular_b",
    "regular_c",
)


class Probe(Demo):
    spec = SPEC

    def story(self) -> None:
        for index, key in enumerate(CLIENTS):
            self.client(
                key,
                key.title(),
                f"{key}@example.test",
                f"+1780555{1000 + index}",
                since=self.at(-120 + index),
            )
        self.series(
            "weekly",
            "series",
            "it_pb_survey",
            "st_pb_kai",
            weekday=2,
            at=time(9),
            every=1,
            visits=6,
            before=3,
        )
        self.time_off("kai_away", "st_pb_kai", self.at(9, 8), self.at(9, 17), "Training day")
        self.estimate(
            "quote",
            "quote",
            Quote("it_pb_service_call", (("it_pb_turret", 2),)),
            self.at(-3, 10),
            status="sent",
            optional=(("it_pb_turret", 1, "A spare part", 4000),),
        )
        accepted = self.estimate(
            "booked",
            "booked",
            Quote("it_pb_service_call", (("it_pb_turret", 1),)),
            self.at(-6, 10),
            status="accepted",
            decided=self.at(-5, 10),
        )
        booked = self.visit("booked", "booked", "it_pb_service_call", "st_pb_kai", 5)
        assert booked is not None
        self.addons(booked, accepted, Quote("it_pb_service_call", (("it_pb_turret", 1),)))
        self.deposit(booked, booked.created_at + timedelta(minutes=10))
        done = self.visit("deposit", "booked", "it_pb_service_call", "st_pb_kai", -20, settle=None)
        assert done is not None and done.completed_at is not None
        self.deposit(done, done.created_at + timedelta(minutes=10))
        self.bill(done, "card")
        tap = self.visit("tap", "tap", "it_pb_survey", "st_pb_owner", -4, settle=None)
        assert tap is not None and tap.completed_at is not None
        self.sale(
            "tap",
            "tap",
            "st_pb_owner",
            Quote("it_pb_survey", (("it_pb_turret", 1),)),
            tap,
            tap.created_at,
            tap.completed_at + timedelta(minutes=10),
            tip=("st_pb_owner", 1000),
        )
        package = self.package("pack", "it_pb_maintenance", self.at(-50, 12))
        for index, day in enumerate((-40, -12)):
            self.visit(
                f"pack_{index}", "pack", "it_pb_survey", "st_pb_kai", day, package_id=package.id
            )
        card = self.gift_card("spring", "gift", "it_pb_install_home", 5000, self.at(-30, 12))
        self.redeem(card, 2000, self.at(-10, 15))
        self.visit("tipper", "tipper", "it_pb_survey", "st_pb_kai", -8, tip=("st_pb_kai", 1500))
        cash = self.visit("cash", "cash", "it_pb_survey", "st_pb_owner", -9, settle="cash")
        assert cash is not None and cash.invoice_id is not None
        paid = next(p for p in self.ctx.all(Payment) if p.invoice_id == cash.invoice_id)
        assert paid.paid_at is not None
        self.refund(paid, 2000, paid.paid_at + timedelta(days=1), "Goodwill credit")
        self.visit(
            "missed", "regular_a", "it_pb_survey", "st_pb_owner", -15, status="no_show", settle=None
        )
        self.visit("dropped", "regular_b", "it_pb_survey", "st_pb_owner", 3, status="canceled")
        past = self.session("workshop_past", "it_pb_system_check", "st_pb_owner", self.at(-7, 13))
        upcoming = self.session(
            "workshop_next", "it_pb_system_check", "st_pb_owner", self.at(7, 13)
        )
        for seat, key in enumerate(("class_a", "class_b", "class_c")):
            status = "no_show" if seat == 2 else "completed"
            booking = self.book(
                f"workshop_past_{seat}",
                key,
                "it_pb_system_check",
                "st_pb_owner",
                past.starts_at,
                status,
                self.at(-14),
                slot=past,
            )
            self.bill(booking, "etransfer")
            self.book(
                f"workshop_next_{seat}",
                key,
                "it_pb_system_check",
                "st_pb_owner",
                upcoming.starts_at,
                "confirmed",
                self.at(-2),
                slot=upcoming,
            )
        self.subscribe("plan", "it_pb_remote_viewing", self.at(-80, 11))
        self.sign("terms_old", "regular_c", "con_pb_terms", self.at(-90, 11), None)
        self.sign("terms_new", "away", "con_pb_terms", self.at(-20, 11), None)
        self.response(
            "intake",
            "tipper",
            "frm_pb_intake",
            self.ctx.get(Booking, "bk_pb_tipper"),
            {"goal": "Tidy"},
            self.at(-9, 8),
        )
        self.fill(["regular_a", "regular_b", "regular_c", "away"])
        self.consents()
        self.withdraw("away", "email", self.at(-5))
        self.broadcast("news", "News", "A short note to clients.", self.at(-20, 10))
        thread = self.thread("tipper", "sms", self.at(-8, 8))
        self.say(thread, "On my way.", self.at(-8, 8))
        self.say(thread, "Thanks.", self.at(-8, 8, 5), sender=None)
        for key in ("tipper", "cash", "tap"):
            self.review(key)


def test_every_engine_block_builds_a_valid_graph() -> None:
    demo = build_edition(Probe, clock.now())
    assert demo.errors() == []
    statuses = {b.status for b in demo.ctx.all(Booking)}
    assert {"completed", "confirmed", "canceled", "no_show"} <= statuses
    assert any(s.capacity > 1 for s in demo.ctx.all(Slot))


def test_a_missing_storyline_stage_is_reported() -> None:
    class Gap(Probe):
        spec = replace(SPEC, storyline=(Stage("Lost", "nobody"),))

    demo = Gap(clock.now())
    demo.build()
    assert "Lost: cl_pb_nobody is missing" in demo.errors()


async def test_engine_rows_post_through_the_ledger_and_validate(owner_db: AsyncSession) -> None:
    db = owner_db
    demo = build_edition(Probe, clock.now())
    for cls in INSERT_ORDER:
        batch = [row for row in demo.ctx.rows if type(row) is cls]
        if batch:
            db.add_all(batch)
            await db.flush()
    await seed_ledger(db, demo)
    await db.flush()
    report = await validate_database(db, as_of=demo.now, business_ids=[PROBE])
    assert report["errors"] == []
    package = demo.ctx.get(Package, "pkg_pb_three_pack")
    assert await ledger.sessions_used(db, package) == 2
    deposit = demo.ctx.get(Booking, "bk_pb_deposit")
    assert deposit.deposit_status == "applied"
    invoice = demo.ctx.get(Invoice, deposit.invoice_id or "")
    assert await ledger.invoice_balance(db, invoice) == 0
    order = demo.ctx.get(Order, "ord_pb_tap")
    tapped = next(p for p in demo.ctx.all(Payment) if p.order_id == order.id)
    assert (tapped.tip_cents, tapped.amount_cents) == (1000, order.total_cents + 1000)
    stripe = await db.scalar(
        select(func.sum(Entry.amount_cents))
        .join(Account, Account.id == Entry.account_id)
        .where(
            Account.business_id == PROBE,
            Account.owner_type == "business",
            Account.category == "stripe",
        )
    )
    assert stripe == 0
