from dataclasses import replace
from datetime import time, timedelta

import pytest
from scripts.demo_context import DEMO_BUSINESSES, DemoBusiness, LegalAddress
from scripts.demo_engine import Demo, Quote, build_edition, editions, seed_ledger
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
from scripts.demo_validate import validate_database, validate_graph
from scripts.seed_demo import INSERT_ORDER
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Package, Subscription
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import File
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger

PROBE = "bz_engine_probe"
# the database seed for tests holds only the core businesses, so the rest are checked in memory
OUTSIDE_CORE = [b.id for b in DEMO_BUSINESSES if b.edition is not None and not b.core]
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
            retail_rate_bps=1000,
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
            visits_per_period=8,
            member_discount_bps=1000,
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
        staff_services={"st_pb_kai": ("it_pb_survey", "it_pb_service_call")},
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
    "late",
    "lapsed",
    "debit",
    "term",
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
        term = self.package("term", "it_pb_maintenance", self.at(-30, 12))
        self.series(
            "term",
            "term",
            "it_pb_survey",
            "st_pb_owner",
            weekday=3,
            at=time(15),
            every=1,
            visits=4,
            before=2,
            package_id=term.id,
            canceled=(1,),
        )
        self.series(
            "debit",
            "debit",
            "it_pb_survey",
            "st_pb_owner",
            weekday=4,
            at=time(15),
            every=1,
            visits=3,
            before=1,
            price=0,
        )
        self.subscribe("debit", "it_pb_remote_viewing", self.at(-70, 11), bank=("RBC", "6677"))
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
        kept = self.visit(
            "kept", "away", "it_pb_service_call", "st_pb_kai", -26, status="no_show", settle=None
        )
        assert kept is not None
        self.deposit(kept, kept.created_at + timedelta(minutes=10))
        self.forfeit(kept)
        retail = self.visit("retail", "cash", "it_pb_survey", "st_pb_kai", -6, settle=None)
        assert retail is not None and retail.completed_at is not None
        self.sale(
            "retail",
            "cash",
            "st_pb_kai",
            Quote("it_pb_survey", (("it_pb_turret", 2),)),
            retail,
            retail.created_at,
            retail.completed_at + timedelta(minutes=5),
            tip=("st_pb_kai", 1000),
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
        self.subscribe("late", "it_pb_remote_viewing", self.at(-80, 11), status="past_due")
        self.subscribe(
            "lapsed",
            "it_pb_remote_viewing",
            self.at(-100, 11),
            status="canceled",
            ended=self.at(-40, 9),
        )
        self.package("pack", "it_pb_maintenance", self.at(-20, 12), key="pack_2")
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
        self.fill(
            (),
            by_staff={
                "st_pb_owner": ["regular_a", "regular_b"],
                "st_pb_kai": ["regular_c", "away", "regular_b"],
            },
        )
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
    plan = demo.ctx.get(Item, "it_pb_remote_viewing")
    assert (plan.visits_per_period, plan.member_discount_bps) == (8, 1000)
    assert demo.ctx.get(Package, "pkg_pb_three_pack_2").client_id == "cl_pb_pack"


def test_a_lapsed_plan_stops_billing_and_a_past_due_plan_leaves_its_renewal_unpaid() -> None:
    demo = build_edition(Probe, clock.now())
    renewals = {
        key: [i for i in demo.ctx.all(Invoice) if i.id.startswith(f"inv_pb_plan_{key}_")]
        for key in ("plan", "late", "lapsed")
    }
    assert len(renewals["late"]) == len(renewals["plan"]) - 1
    assert all(
        i.issued_at is not None and i.issued_at < demo.at(-40, 9) for i in renewals["lapsed"]
    )
    late = demo.ctx.get(Subscription, "sub_pb_plan_late")
    assert late.status == "past_due"
    assert late.current_period_end is not None and late.current_period_end > demo.now
    assert demo.ctx.get(Subscription, "sub_pb_plan_lapsed").status == "canceled"


def test_series_and_plans_take_packages_cancellations_and_debit() -> None:
    demo = build_edition(Probe, clock.now())
    ctx = demo.ctx
    term = [b for b in ctx.all(Booking) if b.id.startswith("bk_pb_term_")]
    assert [b.status for b in sorted(term, key=lambda b: b.starts_at)][:2] == [
        "completed",
        "canceled",
    ]
    assert all(b.package_id == "pkg_pb_three_term" and b.invoice_id is None for b in term)
    debit = [b for b in ctx.all(Booking) if b.id.startswith("bk_pb_debit_")]
    assert all(b.price_cents == 0 and b.invoice_id is None for b in debit)
    method = ctx.get(PaymentMethod, "pm_pb_debit")
    assert (method.method, method.mandate_status) == ("bank_eft", "active")
    charges = [p for p in ctx.all(Payment) if p.client_id == "cl_pb_debit"]
    assert charges and all(p.method == "bank_eft" and p.provider == "stripe" for p in charges)


def test_fill_takes_a_pacing_per_call() -> None:
    class Paced(Probe):
        spec = replace(SPEC, pacing=None)

        def story(self) -> None:
            super().story()
            self.fill(
                ["regular_a", "regular_b"],
                Pacing({"st_pb_kai": 2}, ("it_pb_survey",), weeks=3, ahead_weeks=1),
            )

    demo = build_edition(Paced, clock.now())
    filled = [b for b in demo.ctx.all(Booking) if b.id.startswith("bk_pb_fill_")]
    assert filled and all(b.staff_id == "st_pb_kai" for b in filled)


def test_fill_books_the_services_of_each_month() -> None:
    assert SPEC.pacing is not None
    month = clock.now().astimezone(SPEC.listing.zone).month
    pacing = replace(SPEC.pacing, services_by_month={month: ("it_pb_service_call",)})

    class Seasonal(Probe):
        spec = replace(SPEC, pacing=pacing)

    demo = build_edition(Seasonal, clock.now())
    # Kai's own services win over the month's, so only the owner's visits follow the season
    filled = [b for b in demo.ctx.all(Booking) if b.id.startswith("bk_pb_fill_owner")]
    by_item = {demo.ctx.get(Slot, b.slot_id).item_id for b in filled}
    assert by_item == {"it_pb_survey", "it_pb_service_call"}
    assert all(
        demo.local(b.starts_at).month in {month, month % 12 + 1}
        for b in filled
        if demo.ctx.get(Slot, b.slot_id).item_id == "it_pb_service_call"
    )


def test_a_renewal_backs_its_tax_out_of_the_amount_charged() -> None:
    demo = build_edition(Probe, clock.now())
    plan = demo.items["it_pb_remote_viewing"]
    assert demo.renewals
    for invoice_id, renewal in demo.renewals.items():
        invoice = demo.ctx.get(Invoice, invoice_id)
        paid = [p.amount_cents for p in demo.ctx.all(Payment) if p.invoice_id == invoice_id]
        assert paid == [invoice.total_cents]
        assert (invoice.subtotal_cents, invoice.tax_total_cents) == (
            renewal.subtotal_cents,
            renewal.tax_total_cents,
        )
        assert invoice.subtotal_cents == plan.price_cents


def test_a_missing_storyline_stage_is_reported() -> None:
    class Gap(Probe):
        spec = replace(SPEC, storyline=(Stage("Lost", "nobody"),))

    demo = Gap(clock.now())
    demo.build()
    assert "Lost: cl_pb_nobody is missing" in demo.errors()


def test_a_business_on_trial_ends_its_trial_from_today() -> None:
    class Trial(Probe):
        spec = replace(SPEC, trial_days=14)

    demo = build_edition(Trial, clock.now())
    business = demo.ctx.get(Business, PROBE)
    assert business.plan_status == "trialing"
    assert business.trial_ends_at == demo.now + timedelta(days=14)


def test_a_visit_past_midnight_fits_only_a_day_without_hours() -> None:
    demo = build_edition(Probe, clock.now())
    sunday = 6 - demo.local(demo.now).weekday() + 7
    for key, day, hour in (("overnight", sunday, 20), ("late", sunday + 1, 16)):
        booking = demo.book(
            key, "away", "it_pb_survey", "st_pb_kai", demo.at(day, hour), "confirmed", demo.now
        )
        demo.ctx.get(Slot, booking.slot_id).ends_at = demo.at(day + 1, 8)
    errors = validate_graph(demo.ctx)
    assert "ses_pb_overnight: outside working hours" not in errors
    assert "ses_pb_late: outside working hours" in errors


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
    forfeits = await db.scalar(
        select(func.sum(Entry.amount_cents)).where(
            Entry.business_id == PROBE,
            Entry.event == "forfeit",
            Entry.subject_id == "bk_pb_kept",
            Entry.amount_cents > 0,
        )
    )
    assert forfeits == 5000
    commission = await db.scalar(
        select(func.count())
        .select_from(Entry)
        .where(Entry.event == "earning", Entry.subject_id == "ord_pb_retail")
    )
    assert commission
    kai = [b for b in demo.ctx.all(Booking) if b.id.startswith("bk_pb_fill_kai")]
    held = {b.deposit_status for b in kai if b.deposit_amount_cents and b.status != "canceled"}
    assert "applied" in held and held <= {"applied", "collected", "forfeited"}
    owner = [b for b in demo.ctx.all(Booking) if b.id.startswith("bk_pb_fill_owner")]
    assert owner and not any(b.deposit_amount_cents for b in owner)


async def test_an_invoice_settled_by_its_deposit_and_balance_counts_as_paid(
    owner_db: AsyncSession,
) -> None:
    db = owner_db
    demo = build_edition(Probe, clock.now())
    for cls in INSERT_ORDER:
        batch = [row for row in demo.ctx.rows if type(row) is cls]
        if batch:
            db.add_all(batch)
            await db.flush()
    await seed_ledger(db, demo)
    db.add(
        File(
            id="fl_face_cl_pb_booked",
            business_id=PROBE,
            parent_type="client",
            parent_id="cl_pb_booked",
            purpose="photo",
            s3_key=f"{PROBE}/demo/face_cl_pb_booked.jpg",
            content_type="image/jpeg",
            size=1,
            uploaded_at=demo.now,
        )
    )
    await db.flush()
    report = await validate_database(db, as_of=demo.now, business_ids=[PROBE])
    assert report["errors"] == []


def test_pacing_gives_a_member_their_own_services_and_clients() -> None:
    assert SPEC.pacing is not None
    pacing = replace(SPEC.pacing, staff_services={"st_pb_kai": ("it_pb_service_call",)})

    class Split(Probe):
        spec = replace(SPEC, pacing=pacing, storyline=())

        def story(self) -> None:
            for index, key in enumerate(("owners", "kais", "kais_too")):
                self.client(
                    key,
                    key.title(),
                    f"{key}@example.test",
                    f"+1780555{2000 + index}",
                    since=self.at(-120),
                )
            self.fill(["owners"], by_staff={"st_pb_kai": ["kais", "kais_too"]})

    demo = build_edition(Split, clock.now())
    visits = {
        (b.staff_id, demo.ctx.get(Slot, b.slot_id).item_id, b.client_id)
        for b in demo.ctx.all(Booking)
    }
    assert {(staff, item) for staff, item, _ in visits} == {
        ("st_pb_owner", "it_pb_survey"),
        ("st_pb_kai", "it_pb_service_call"),
    }
    assert {client for staff, _, client in visits if staff == "st_pb_kai"} == {
        "cl_pb_kais",
        "cl_pb_kais_too",
    }
    assert {client for staff, _, client in visits if staff == "st_pb_owner"} == {"cl_pb_owners"}


@pytest.mark.parametrize("business_id", OUTSIDE_CORE)
def test_an_edition_outside_the_core_seed_builds_a_valid_graph(business_id: str) -> None:
    edition = next(e for e in editions() if e.spec.listing.id == business_id)
    demo = build_edition(edition, clock.now())
    assert validate_graph(demo.ctx) == []
