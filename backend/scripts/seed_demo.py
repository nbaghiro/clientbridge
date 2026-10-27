"""Build, validate and write the demo, replacing only the demo businesses' rows on every run."""

from __future__ import annotations

import argparse
import asyncio
import os
import random
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from time import monotonic
from zoneinfo import ZoneInfo

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import ColumnElement, and_, delete, event, func, or_, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import Base, engine
from clientbridge.core.errors import AppError
from clientbridge.core.security import hash_token
from clientbridge.integrations.identity import IdentityProvider
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.integrations.s3 import S3_CONFIG
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import GiftCard, Item, Package, StockMovement, Subscription
from clientbridge.models.clients import Client, Consent, Note, Subject
from clientbridge.models.documents import (
    Contract,
    Form,
    FormField,
    FormResponse,
    Signature,
    VisitRecord,
)
from clientbridge.models.ledger import Entry
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Audit, File, Webhook
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import (
    Addon,
    Booking,
    Hours,
    Recurrence,
    Resource,
    Slot,
)
from clientbridge.services.forms import form_definition
from scripts import demo_copy
from scripts.demo_calendar import build_calendar
from scripts.demo_catalog import add_catalog_images
from scripts.demo_chronology import align_chronology, chronology_errors
from scripts.demo_context import (
    DEMO_BUSINESSES,
    DEMO_IDS,
    DEMO_PASSWORD,
    DEMO_VERSION,
    DemoContext,
    demo_business,
)
from scripts.demo_engagement import build_engagement
from scripts.demo_engine import Demo, build_edition, edition_of, editions, seed_ledger
from scripts.demo_finance import add_finance_scenarios, prepare_finance, seed_finance
from scripts.demo_identity import FOUNDED_DAY, build_identity, placeholder_identity
from scripts.demo_logins import prune_logins
from scripts.demo_photos import add_people_photos
from scripts.demo_scenarios import add_scenarios
from scripts.demo_schedule import add_class_timetable, add_repeat_visits, finish_schedule
from scripts.demo_validate import cross_business_errors, validate_database, validate_graph
from scripts.demo_visits import add_visit_day

VANCOUVER = ZoneInfo("America/Vancouver")
now = clock.now().astimezone(VANCOUVER)
BIZ = "bz_birchbark"
STAGING_DATABASE = "staging_clientbridge"
# the database each environment's API serves, whose users own the auth service's demo logins
APP_DATABASES = {"dev": "clientbridge", "staging": STAGING_DATABASE}
rows: list[Base] = []
UPLOADS = 16
MAX_JOBS = 8
PACKAGE_USED = {"pkg_marcus": 2, "pkg_grace": 5, "pkg_sophie": 4}


def at(days_offset: float, hour: int = 9, minute: int = 0) -> datetime:
    """A local business-hour timestamp relative to now, stored as UTC, so demo times read well."""
    return (
        (now + timedelta(days=days_offset))
        .replace(hour=hour, minute=minute, second=0, microsecond=0)
        .astimezone(UTC)
    )


ASSETS = Path(__file__).parent / "demo_assets"
ITEM_COLORS = {
    "it_groom_sm": "#3F5E80",
    "it_groom_lg": "#2E6670",
    "it_bath": "#3A7CA5",
    "it_nails": "#7D5A82",
    "it_deshed": "#86621E",
    "it_cat": "#A95C43",
    "it_puppy": "#2E7A5A",
    "it_daycare": "#5C6B3A",
    "it_pkg5": "#3A7CA5",
    "it_gift": "#A44A5F",
    "it_shampoo": "#5E7391",
    "it_brush": "#7A6A55",
    "it_spray": "#5E7391",
    "it_balm": "#3F5E50",
    "it_comb": "#6B7280",
    "it_clippers": "#3F5E50",
    "it_treats": "#A0703A",
    "it_chews": "#86621E",
    "it_leash": "#2E4A3F",
    "it_bandana": "#5C6B3A",
    "it_rope": "#2E4A3F",
    "it_plush": "#A95C43",
    "it_towel": "#2E4A3F",
}


def seed_identity() -> tuple[str, str]:
    owner_id = "us_dev"
    rows.append(
        Business(
            id=BIZ,
            name="Birchbark Pet Studio",
            slug="birchbark",
            timezone="America/Vancouver",
            **asdict(demo_business(BIZ).legal),
            gst_hst_number="847201539RT0001",
            pst_number="PST10218845",
            tax_registered=True,
            brand={
                "logo_file_id": "fl_logo",
                "primary": "#2E4A3F",
                "tagline": "Calm, careful grooming on Vancouver Island.",
            },
            booking_policy={"approve_new_clients": True},
            billing_email="hello@birchbark.example",
            sms_number="+12365550190",
            # a fixture account, fully onboarded so its status agrees with the seeded payments
            stripe_account_id="acct_demo_birchbark",
            stripe_charges_enabled=True,
            stripe_payouts_enabled=True,
            stripe_requirements={
                "currently_due": [],
                "eventually_due": [],
                "past_due": [],
                "disabled_reason": None,
                "card_status": "active",
                "current_deadline": None,
            },
            status="active",
            plan="team",
            plan_status="active",
            trial_ends_at=at(FOUNDED_DAY) + timedelta(days=14),
            subject="pet",
        )
    )
    rows.append(
        File(
            id="fl_logo",
            business_id=BIZ,
            parent_type="business",
            parent_id=BIZ,
            purpose="logo",
            s3_key=f"{BIZ}/demo/logo.png",
            content_type="image/png",
            size=(ASSETS / "logo.png").stat().st_size,
        )
    )
    rows.append(
        User(
            id=owner_id,
            identity_id=placeholder_identity("hannah@birchbark.example"),
            email="hannah@birchbark.example",
            name="Hannah Wong",
            phone="+12505550110",
        )
    )
    rows.append(
        User(
            id="us_diego",
            identity_id=placeholder_identity("diego@birchbark.example"),
            email="diego@birchbark.example",
            name="Diego Ramirez",
            phone="+12505550111",
        )
    )
    rows.append(
        User(
            id="us_priya",
            identity_id=placeholder_identity("priya@birchbark.example"),
            email="priya@birchbark.example",
            name="Priya Patel",
            phone="+12505550112",
        )
    )
    rows.append(
        Staff(
            id="st_owner",
            business_id=BIZ,
            user_id=owner_id,
            role="owner",
            payee=False,
            title="Owner & Lead Groomer",
            color="#3F5E80",
            status="active",
            bookable_online=True,
        )
    )
    rows.append(
        Staff(
            id="st_diego",
            business_id=BIZ,
            user_id="us_diego",
            role="staff",
            payee=True,
            rate_bps=4500,
            rate_type="percent",
            title="Senior Groomer",
            color="#2E7A5A",
            status="active",
            bookable_online=True,
        )
    )
    rows.append(
        Staff(
            id="st_priya",
            business_id=BIZ,
            user_id="us_priya",
            role="staff",
            payee=False,
            rate_cents=2200,
            rate_type="hourly",
            title="Bather & Front Desk",
            color="#86621E",
            status="active",
            bookable_online=True,
        )
    )
    # a pending invite (staff row with status=invited, no user yet)
    rows.append(
        Staff(
            id="st_invite",
            business_id=BIZ,
            role="staff",
            status="invited",
            invite_email="sam.newhire@example.com",
            invite_token=hash_token("inv_tok_sam"),
            invited_at=now - timedelta(days=1),
            invited_by="us_admin",
            title="Groomer (trial)",
            color="#6E757E",
        )
    )
    return owner_id, "st_diego"


# tax markers driving the line-tax math below (rates are derived at runtime — no table to seed)
GST = "gst"
PST = "pst"


# item_id, kind, name, price_cents, duration_min, capacity, tax, category, desc
ITEMS = [
    (
        "it_groom_sm",
        "service",
        "Full Groom — Small Dog",
        7500,
        75,
        1,
        GST,
        "Grooming",
        "Bath, blow-dry, breed-style haircut, nail trim, ear clean. Up to 25 lb.",
    ),
    (
        "it_groom_lg",
        "service",
        "Full Groom — Large Dog",
        11000,
        120,
        1,
        GST,
        "Grooming",
        "Full groom for dogs over 50 lb. De-matting extra if needed.",
    ),
    (
        "it_bath",
        "service",
        "Bath & Tidy",
        4500,
        45,
        1,
        GST,
        "Grooming",
        "Warm bath, blow-dry, brush-out, nail trim and a bandana to finish.",
    ),
    (
        "it_nails",
        "service",
        "Nail Trim & File",
        1800,
        15,
        1,
        GST,
        "Grooming",
        "Quick, low-stress nail trim with a smooth file. Walk-ins welcome.",
    ),
    (
        "it_deshed",
        "service",
        "De-shedding Treatment",
        6000,
        60,
        1,
        GST,
        "Grooming",
        "Deep de-shed for double-coated breeds — cuts shedding by up to 90%.",
    ),
    (
        "it_cat",
        "service",
        "Cat Groom",
        8500,
        75,
        1,
        GST,
        "Grooming",
        "Gentle cat groom: bath, comb-out, sanitary trim and nails.",
    ),
    (
        "it_puppy",
        "class",
        "Puppy Socialization (group)",
        3000,
        60,
        6,
        GST,
        "Classes",
        "Friendly 6-pup class — confidence, handling and first-groom prep.",
    ),
    (
        "it_daycare",
        "subscription",
        "Monthly Daycare",
        32000,
        None,
        None,
        GST,
        "Daycare",
        "Unlimited weekday daycare — supervised play, rest and enrichment.",
    ),
    (
        "it_pkg5",
        "package",
        "5-Bath Package",
        20000,
        None,
        None,
        GST,
        "Packages",
        "Five Bath & Tidy visits at a discount. Valid 12 months.",
    ),
    (
        "it_shampoo",
        "product",
        "Oatmeal Soothe Shampoo (500ml)",
        2400,
        None,
        None,
        PST,
        "Bath and coat",
        "Vet-formulated oatmeal shampoo for itchy, sensitive skin.",
    ),
    (
        "it_brush",
        "product",
        "Self-Cleaning Slicker Brush",
        2900,
        None,
        None,
        PST,
        "Brushes and tools",
        "De-mats and de-sheds; one-click bristle retract.",
    ),
    (
        "it_spray",
        "product",
        "Coat Detangling Spray (250ml)",
        1900,
        None,
        None,
        PST,
        "Bath and coat",
        "Leave-in spray that loosens knots and adds shine between grooms.",
    ),
    (
        "it_balm",
        "product",
        "Paw & Nose Balm (60g)",
        1600,
        None,
        None,
        PST,
        "Bath and coat",
        "Shea and beeswax balm for dry, cracked paw pads and noses.",
    ),
    (
        "it_comb",
        "product",
        "Wide-Tooth Steel Comb",
        1800,
        None,
        None,
        PST,
        "Brushes and tools",
        "Stainless steel finishing comb with wide and fine teeth.",
    ),
    (
        "it_clippers",
        "product",
        "Nail Clippers",
        2200,
        None,
        None,
        PST,
        "Brushes and tools",
        "Scissor-style clippers with a safety stop for small to large dogs.",
    ),
    (
        "it_treats",
        "product",
        "Salmon Training Bites (200g)",
        1200,
        None,
        None,
        PST,
        "Treats",
        "Soft, single-protein salmon bites sized for training.",
    ),
    (
        "it_chews",
        "product",
        "Peanut Butter Dental Chews (6 pack)",
        1500,
        None,
        None,
        PST,
        "Treats",
        "Ridged chews that help keep teeth clean between brushings.",
    ),
    (
        "it_leash",
        "product",
        "Waxed Cotton Leash",
        3800,
        None,
        None,
        PST,
        "Walk and wear",
        "1.5 m waxed cotton lead with a brass clip and leather-wrapped handle.",
    ),
    (
        "it_bandana",
        "product",
        "Birchbark Bandana",
        1400,
        None,
        None,
        PST,
        "Walk and wear",
        "Soft cotton bandana in our leaf print; one size ties to fit.",
    ),
    (
        "it_rope",
        "product",
        "Rope Tug Toy",
        1600,
        None,
        None,
        PST,
        "Toys and comfort",
        "Braided cotton rope for tug and fetch; machine washable.",
    ),
    (
        "it_plush",
        "product",
        "Plush Fox Toy",
        1800,
        None,
        None,
        PST,
        "Toys and comfort",
        "Soft plush fox with a quiet squeaker for gentle players.",
    ),
    (
        "it_towel",
        "product",
        "Quick-Dry Grooming Towel",
        2600,
        None,
        None,
        PST,
        "Toys and comfort",
        "Absorbent microfibre towel that dries a coat in half the time.",
    ),
    (
        "it_gift",
        "gift",
        "Gift Card",
        0,
        None,
        None,
        GST,
        "Gift Cards",
        "A Birchbark gift card — any amount, any service.",
    ),
]


# tracked products: (on hand, low-stock line, unit cost); the brush sits under its line
STOCK = {
    "it_shampoo": (24, 6, 1100),
    "it_brush": (2, 5, 1300),
    "it_spray": (14, 4, 800),
    "it_balm": (3, 4, 650),
    "it_comb": (9, 3, 700),
    "it_clippers": (7, 3, 900),
    "it_treats": (30, 8, 500),
    "it_chews": (22, 6, 650),
    "it_leash": (6, 2, 1700),
    "it_bandana": (12, 4, 500),
    "it_rope": (15, 4, 600),
    "it_plush": (1, 3, 750),
    "it_towel": (8, 3, 1100),
}


def seed_items(owner: str) -> None:
    for iid, kind, name, price, dur, cap, _tax, cat, desc in ITEMS:
        rows.append(
            Item(
                id=iid,
                business_id=BIZ,
                created_by=owner,
                kind=kind,
                name=name,
                description=desc,
                price_cents=price,
                currency="CAD",
                tax_class="standard"
                if kind == "product"
                else "exempt"
                if kind == "gift"
                else "federal_only",
                duration_min=dur,
                capacity=cap,
                category=cat,
                color=ITEM_COLORS[iid],
                online_bookable=kind in {"service", "class"},
                sell_online=kind == "product",
                addon=iid in {"it_shampoo", "it_brush"},
                buffer_before_min=0,
                buffer_after_min=10 if kind == "service" else 0,
                deposit_type="percent" if kind == "service" and price >= 10000 else "none",
                deposit_value=25 if kind == "service" and price >= 10000 else None,
                interval=1 if kind == "subscription" else None,
                frequency="month" if kind == "subscription" else None,
                session_count=5 if iid == "it_pkg5" else None,
                validity_days=365 if iid == "it_pkg5" else None,
                cost_cents=STOCK[iid][2] if iid in STOCK else None,
                track_stock=iid in STOCK,
                stock_on_hand=STOCK[iid][0] if iid in STOCK else None,
                low_stock_at=STOCK[iid][1] if iid in STOCK else None,
                active=True,
            )
        )
        if iid in STOCK:
            rows.append(
                StockMovement(
                    id=f"mv_{iid}",
                    business_id=BIZ,
                    item_id=iid,
                    reason="restock",
                    quantity=STOCK[iid][0],
                    unit_cost_cents=STOCK[iid][2],
                    note="Opening count",
                    created_by=owner,
                )
            )


# id, name, email, phone, tags, ltv($), status, [pets], note
CLIENTS = [
    (
        "cl_amelie",
        "Amélie Tremblay",
        "amelie.t@example.test",
        "+12505550180",
        ["regular", "vip"],
        1240,
        "active",
        [("sj_bella", "Bella", "Goldendoodle", 22, "anxious", "bella")],
        "Bella gets nervous with dryers — towel-dry first, muzzle for nails. Amélie prefers text.",
    ),
    (
        "cl_marcus",
        "Marcus Bennett",
        "marcus.b@example.test",
        "+12505550181",
        ["regular"],
        880,
        "active",
        [
            ("sj_rex", "Rex", "German Shepherd", 38, "friendly", "rex"),
            ("sj_luna", "Luna", "Border Collie", 18, "energetic", "luna"),
        ],
        "Two dogs, usually books them back-to-back on Saturdays.",
    ),
    (
        "cl_sophie",
        "Sophie Nguyen",
        "sophie.n@example.test",
        "+12505550182",
        ["new"],
        95,
        "active",
        [("sj_mochi", "Mochi", "Shih Tzu", 6, "calm", "mochi")],
        "First-time client — found us on Google.",
    ),
    (
        "cl_david",
        "David Okafor",
        "david.o@example.test",
        "+12505550183",
        ["regular", "daycare"],
        2100,
        "active",
        [("sj_zeus", "Zeus", "Rottweiler", 45, "gentle", "zeus")],
        "Daycare regular, M/W/F.",
    ),
    (
        "cl_grace",
        "Grace Lin",
        "grace.l@example.test",
        "+12505550184",
        ["regular"],
        640,
        "active",
        [("sj_pepper", "Pepper", "Mini Schnauzer", 8, "vocal", "pepper")],
        None,
    ),
    (
        "cl_liam",
        "Liam O'Connor",
        "liam.oc@example.test",
        "+12505550185",
        ["regular", "vip"],
        1560,
        "active",
        [("sj_maple", "Maple", "Nova Scotia Duck Toller", 20, "sweet", "maple")],
        "Maple is a show dog — careful around the tail feathering.",
    ),
    (
        "cl_yuki",
        "Yuki Tanaka",
        "yuki.t@example.test",
        "+12505550186",
        ["regular"],
        720,
        "active",
        [("sj_miso", "Miso", "Domestic Shorthair (cat)", 5, "skittish", "miso")],
        "Cat groom only. Books quarterly.",
    ),
    (
        "cl_fatima",
        "Fatima Al-Sayed",
        "fatima.a@example.test",
        "+12505550187",
        ["new"],
        0,
        "active",
        [("sj_simba", "Simba", "Pomeranian", 4, "bouncy", "simba")],
        "Inquiry — hasn't booked yet.",
    ),
    (
        "cl_noah",
        "Noah Schmidt",
        "noah.s@example.test",
        "+12505550188",
        ["regular"],
        410,
        "active",
        [("sj_cooper", "Cooper", "Labrador Retriever", 32, "friendly", "cooper")],
        None,
    ),
    (
        "cl_priscilla",
        "Priscilla Adeyemi",
        "p.adeyemi@example.test",
        "+12505550189",
        ["regular", "daycare"],
        1890,
        "active",
        [("sj_kobe", "Kobe", "French Bulldog", 12, "stubborn", "kobe")],
        "Kobe — watch breathing, keep grooming short and cool.",
    ),
    (
        "cl_ethan",
        "Ethan Wright",
        "ethan.w@example.test",
        "+12505550190",
        [],
        150,
        "active",
        [("sj_willow", "Willow", "Cavalier King Charles", 9, "gentle", "willow")],
        None,
    ),
    (
        "cl_olivia",
        "Olivia Martin",
        "olivia.m@example.test",
        "+12505550191",
        ["churn-risk"],
        320,
        "active",
        [("sj_bandit", "Bandit", "Australian Shepherd", 24, "anxious", "bandit")],
        "Hasn't booked in 4 months — send a win-back.",
    ),
]


def seed_clients(owner: str) -> None:
    for cid, name, _email, phone, tags, _ltv, status, pets, note in CLIENTS:
        rows.append(
            Client(
                id=cid,
                business_id=BIZ,
                created_by=owner,
                name=name,
                phone=phone,
                tags=tags,
                status=status,
                custom_fields={"source": "google" if "new" in tags else "referral"},
            )
        )
        for pid, pname, breed, weight, temperament, pseed in pets:
            rows.append(
                Subject(
                    id=pid,
                    business_id=BIZ,
                    client_id=cid,
                    name=pname,
                    attributes={
                        "breed": breed,
                        "weight_kg": weight,
                        "temperament": temperament,
                    },
                )
            )
            rows.append(
                File(
                    id=f"fl_{pid}",
                    business_id=BIZ,
                    parent_type="subject",
                    parent_id=pid,
                    purpose="photo",
                    s3_key=f"{BIZ}/demo/pet_{pseed}.png",
                    content_type="image/png",
                    size=(ASSETS / f"pet_{pseed}.png").stat().st_size,
                )
            )
        if note:
            rows.append(
                Note(
                    id=f"nt_{cid}",
                    business_id=BIZ,
                    created_by=owner,
                    parent_type="client",
                    parent_id=cid,
                    body=note,
                )
            )


def seed_hours() -> None:
    # recurring weekly hours Tue-Sat 9-17 for both groomers
    for member in ("st_owner", "st_diego"):
        for weekday in (1, 2, 3, 4, 5):  # Tue..Sat
            rows.append(
                Hours(
                    id=f"av_{member}_{weekday}",
                    business_id=BIZ,
                    staff_id=member,
                    basis="recurring",
                    weekday=weekday,
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    available=True,
                )
            )
    # a stat-holiday closure + an extra-open Sunday
    rows.append(
        Hours(
            id="av_holiday",
            business_id=BIZ,
            staff_id="st_owner",
            basis="date",
            date=at(12).date(),
            available=False,
            note="BC Day — closed",
        )
    )
    rows.append(
        Hours(
            id="av_extra",
            business_id=BIZ,
            staff_id="st_diego",
            basis="date",
            date=at(9).date(),
            start_time=time(10, 0),
            end_time=time(14, 0),
            available=True,
            note="Extra Sunday for holiday rush",
        )
    )
    # a recurring puppy class schedule
    rows.append(
        Recurrence(
            id="sch_puppy",
            business_id=BIZ,
            item_id="it_puppy",
            staff_id="st_owner",
            frequency="week",
            interval=1,
            byday=["SA"],
            until=at(60).date(),
            status="active",
        )
    )


# (day_offset, hour, item, member, client, pet, status); each drives a slice across many tables
APPTS = [
    (-28, 9, "it_groom_sm", "st_owner", "cl_amelie", "sj_bella", "completed"),
    (-26, 10, "it_groom_lg", "st_diego", "cl_marcus", "sj_rex", "completed"),
    (-26, 13, "it_bath", "st_diego", "cl_marcus", "sj_luna", "completed"),
    (-21, 11, "it_cat", "st_owner", "cl_yuki", "sj_miso", "completed"),
    (-18, 14, "it_deshed", "st_diego", "cl_liam", "sj_maple", "completed"),
    (-15, 9, "it_groom_sm", "st_owner", "cl_grace", "sj_pepper", "completed"),
    (-12, 15, "it_nails", "st_priya", "cl_noah", "sj_cooper", "completed"),
    (-10, 10, "it_groom_sm", "st_owner", "cl_sophie", "sj_mochi", "completed"),
    (-8, 13, "it_groom_lg", "st_diego", "cl_david", "sj_zeus", "completed"),
    (-5, 11, "it_bath", "st_priya", "cl_ethan", "sj_willow", "completed"),
    (-3, 9, "it_groom_sm", "st_owner", "cl_priscilla", "sj_kobe", "completed"),
    (-2, 14, "it_nails", "st_priya", "cl_grace", "sj_pepper", "no_show"),
    (0, 10, "it_groom_sm", "st_owner", "cl_amelie", "sj_bella", "confirmed"),
    (0, 13, "it_deshed", "st_diego", "cl_marcus", "sj_rex", "confirmed"),
    (1, 9, "it_bath", "st_priya", "cl_noah", "sj_cooper", "confirmed"),
    (2, 11, "it_groom_lg", "st_diego", "cl_david", "sj_zeus", "confirmed"),
    (3, 14, "it_cat", "st_owner", "cl_yuki", "sj_miso", "confirmed"),
    (5, 10, "it_groom_sm", "st_owner", "cl_sophie", "sj_mochi", "confirmed"),
    (6, 13, "it_nails", "st_priya", "cl_ethan", "sj_willow", "confirmed"),
    (7, 9, "it_deshed", "st_diego", "cl_liam", "sj_maple", "confirmed"),
    (9, 11, "it_groom_sm", "st_owner", "cl_olivia", "sj_bandit", "canceled"),
]

INV_SEQ = [1000]


def seed_appointments() -> None:
    for i, (d, h, item_id, member, client, pet, status) in enumerate(APPTS):
        item = next(x for x in ITEMS if x[0] == item_id)
        price, dur, tax = item[3], item[4] or 60, item[6]
        ses = f"ses_{i:03d}"
        bk = f"bk_{i:03d}"
        rows.append(
            Slot(
                id=ses,
                business_id=BIZ,
                item_id=item_id,
                staff_id=member,
                starts_at=at(d, h),
                ends_at=at(d, h) + timedelta(minutes=dur),
                capacity=1,
                status="completed"
                if status == "completed"
                else "canceled"
                if status == "canceled"
                else "scheduled",
            )
        )
        rows.append(
            Booking(
                id=bk,
                business_id=BIZ,
                slot_id=ses,
                starts_at=at(d, h),
                staff_id=member,  # denormalized from the session — drives per-member sync
                client_id=client,
                subject_id=pet,
                status=status,
                source="online" if i % 3 == 0 else "manual",
                manage_token=f"manage_{bk}" if i % 3 == 0 else None,
                price_cents=price,
                confirmed_at=at(d - 1, 12) if status in {"confirmed", "completed"} else None,
                completed_at=at(d, h + 1) if status == "completed" else None,
                canceled_at=at(d - 1, 9) if status == "canceled" else None,
            )
        )
        if status == "completed":
            _invoice_for(i, client, bk, item_id, price, dur, tax, member, d)


def _invoice_for(
    i: int,
    client: str,
    bk: str,
    item_id: str,
    price: int,
    dur: int,
    tax: str,
    member: str,
    d: float,
    settled: bool = False,
) -> None:
    INV_SEQ[0] += 1
    num = INV_SEQ[0]
    inv = f"inv_{num}"
    tax_amt = (price * 5 + 50) // 100
    total = price + tax_amt
    # mix of paid / partial / overdue across history
    paid = settled or i % 5 != 4
    partial = not settled and i % 5 == 2
    amount_paid = total if paid and not partial else (round(total * 0.25) if partial else 0)
    rows.append(
        Invoice(
            id=inv,
            business_id=BIZ,
            client_id=client,
            number=num,
            status="sent",
            currency="CAD",
            subtotal_cents=price,
            tax_total_cents=tax_amt,
            total_cents=total,
            issued_at=at(d, 17),
            due_at=at(d + 14, 17),
            overdue_notified_at=None if amount_paid else at(d + 15, 7),
            notes="Thanks for trusting us with your pup! 🐾",
        )
    )
    rows.append(
        Line(
            id=f"ln_{num}_1",
            business_id=BIZ,
            invoice_id=inv,
            description=next(x[2] for x in ITEMS if x[0] == item_id),
            item_id=item_id,
            booking_id=bk,
            quantity=1,
            unit_amount_cents=price,
            amount_cents=price,
            tax_amount_cents=tax_amt,
            position=0,
        )
    )
    # set the booking's invoice link
    for r in rows:
        if isinstance(r, Booking) and r.id == bk:
            r.invoice_id = inv
    if amount_paid > 0:
        method = "etransfer" if i % 3 == 0 else "card"
        pay = f"pay_{num}"
        rows.append(
            Payment(
                id=pay,
                business_id=BIZ,
                client_id=client,
                kind="payment",
                invoice_id=inv,
                booking_id=bk,
                amount_cents=amount_paid,
                currency="CAD",
                method=method,
                provider="stripe" if method == "card" else "manual",
                provider_ref=f"pi_demo_{num}" if method == "card" else None,
                reference=f"CA{num}ET" if method == "etransfer" else None,
                status="succeeded",
                paid_at=at(d, 18),
            )
        )


def seed_catalog_instances() -> None:
    rows.append(
        Package(
            id="pkg_marcus",
            business_id=BIZ,
            client_id="cl_marcus",
            subject_id="sj_rex",
            item_id="it_pkg5",
            sessions_total=5,
            expires_at=at(300, 12),
            status="active",
        )
    )
    rows.append(
        Package(
            id="pkg_grace",
            business_id=BIZ,
            client_id="cl_grace",
            item_id="it_pkg5",
            sessions_total=5,
            expires_at=at(-10, 12),
            status="used",
        )
    )
    rows.append(
        Subscription(
            id="sub_david",
            business_id=BIZ,
            client_id="cl_david",
            item_id="it_daycare",
            status="active",
            current_period_end=at(24, 0),
            payment_method_id="pm_david",
            provider_ref="sub_demo_david",
        )
    )
    rows.append(
        Subscription(
            id="sub_priscilla",
            business_id=BIZ,
            client_id="cl_priscilla",
            item_id="it_daycare",
            status="paused",
            current_period_end=at(10, 0),
            provider_ref="sub_demo_pris",
        )
    )
    rows.append(
        GiftCard(
            id="gc_liam",
            business_id=BIZ,
            code="BIRCH-GIFT-7K2M",
            item_id="it_gift",
            initial_cents=10000,
            purchaser_client_id="cl_liam",
            recipient="For Mum — happy birthday!",
            expires_at=at(700, 12),
            status="active",
        )
    )
    rows.append(
        GiftCard(
            id="gc_used",
            business_id=BIZ,
            code="BIRCH-GIFT-9P4X",
            item_id="it_gift",
            initial_cents=5000,
            purchaser_client_id="cl_david",
            status="active",
        )
    )


def seed_lapsed_entitlements() -> None:
    rows.append(
        GiftCard(
            id="gc_expired",
            business_id=BIZ,
            code="BIRCH-GIFT-3QW8",
            item_id="it_gift",
            initial_cents=7500,
            purchaser_client_id="cl_ethan",
            recipient="Happy birthday, Ethan",
            expires_at=at(-35, 12),
            status="expired",
        )
    )
    rows.append(
        Package(
            id="pkg_sophie",
            business_id=BIZ,
            client_id="cl_sophie",
            item_id="it_pkg5",
            sessions_total=5,
            expires_at=at(200, 12),
            status="active",
        )
    )


def seed_online_shop() -> None:
    """A paid online order waiting for pickup, and a product a client added to an upcoming visit."""
    rows.append(
        Order(
            id="ord_web",
            business_id=BIZ,
            number=5,
            client_id="cl_grace",
            staff_id="st_owner",
            status="open",
            subtotal_cents=2900,
            tax_total_cents=348,
            total_cents=3248,
            source="online",
            pickup_status="unfulfilled",
            paid_at=at(-1, 18),
        )
    )
    rows.append(
        Line(
            id="ln_ord_web_0",
            business_id=BIZ,
            order_id="ord_web",
            description="Self-Cleaning Slicker Brush",
            item_id="it_brush",
            quantity=1,
            unit_amount_cents=2900,
            amount_cents=2900,
            tax_amount_cents=348,
            position=0,
        )
    )
    rows.append(
        Payment(
            id="pay_ord_web",
            business_id=BIZ,
            client_id="cl_grace",
            kind="payment",
            order_id="ord_web",
            amount_cents=3248,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_ord_web",
            status="succeeded",
            paid_at=at(-1, 18),
        )
    )
    rows.append(
        Addon(
            id="bka_demo_shampoo",
            business_id=BIZ,
            booking_id="bk_015",
            staff_id="st_diego",
            item_id="it_shampoo",
            description="Oatmeal Soothe Shampoo (500ml)",
            quantity=1,
            unit_amount_cents=2400,
        )
    )


def seed_open_sale() -> None:
    rows.append(
        Order(
            id="ord_open",
            business_id=BIZ,
            number=4,
            client_id="cl_amelie",
            staff_id="st_priya",
            status="open",
            subtotal_cents=5300,
            tax_total_cents=636,
            total_cents=5936,
        )
    )
    for pos, (item_id, name, price) in enumerate(
        (
            ("it_brush", "Self-Cleaning Slicker Brush", 2900),
            ("it_shampoo", "Oatmeal Soothe Shampoo", 2400),
        )
    ):
        rows.append(
            Line(
                id=f"ln_ord_open_{pos}",
                business_id=BIZ,
                order_id="ord_open",
                description=name,
                item_id=item_id,
                quantity=1,
                unit_amount_cents=price,
                amount_cents=price,
                tax_amount_cents=price * 12 // 100,
                position=pos,
            )
        )


def seed_payment_methods() -> None:
    cards = [
        ("pm_amelie", "cl_amelie", "Visa", "4242"),
        ("pm_marcus", "cl_marcus", "Mastercard", "5454"),
        ("pm_david", "cl_david", "Visa", "4111"),
        ("pm_liam", "cl_liam", "Amex", "0005"),
        ("pm_priscilla", "cl_priscilla", "Visa", "8210"),
        ("pm_grace", "cl_grace", "Mastercard", "3119"),
    ]
    for pmid, client, brand, last4 in cards:
        rows.append(
            PaymentMethod(
                id=pmid,
                business_id=BIZ,
                client_id=client,
                method="card",
                brand=brand,
                last4=last4,
                provider_ref=f"pm_demo_{last4}",
                preferred=True,
                mandate_status="none",
            )
        )
    rows.append(
        PaymentMethod(
            id="pm_david_bank",
            business_id=BIZ,
            client_id="cl_david",
            method="bank_eft",
            brand="RBC",
            last4="6677",
            mandate_status="active",
            preferred=False,
        )
    )


def seed_estimates() -> None:
    rows.append(
        Estimate(
            id="est_1001",
            business_id=BIZ,
            client_id="cl_priscilla",
            number=1,
            status="sent",
            subtotal_cents=33000,
            tax_total_cents=1650,
            total_cents=34650,
            valid_until=at(20).date(),
            notes="Three-dog grooming day — siblings' dogs included.",
        )
    )
    rows.append(
        Line(
            id="ln_est_1",
            business_id=BIZ,
            estimate_id="est_1001",
            description="Full Groom — Small Dog \N{MULTIPLICATION SIGN}3",
            item_id="it_groom_sm",
            quantity=3,
            unit_amount_cents=7500,
            amount_cents=22500,
            tax_amount_cents=1125,
            position=0,
        )
    )
    rows.append(
        Line(
            id="ln_est_2",
            business_id=BIZ,
            estimate_id="est_1001",
            description="De-shedding add-on \N{MULTIPLICATION SIGN}1",
            item_id="it_deshed",
            quantity=1,
            unit_amount_cents=6000,
            amount_cents=6000,
            tax_amount_cents=300,
            position=1,
        )
    )
    rows.append(
        Line(
            id="ln_est_3",
            business_id=BIZ,
            estimate_id="est_1001",
            description="Take-home Oatmeal Shampoo \N{MULTIPLICATION SIGN}1",
            item_id="it_shampoo",
            quantity=1,
            unit_amount_cents=2400,
            amount_cents=2400,
            tax_amount_cents=168,
            position=2,
        )
    )
    rows.append(
        Estimate(
            id="est_1002",
            business_id=BIZ,
            client_id="cl_liam",
            number=2,
            status="accepted",
            subtotal_cents=11000,
            tax_total_cents=550,
            total_cents=11550,
            valid_until=at(5).date(),
            accepted_at=at(-3, 14),
            notes="Show-prep groom for Maple.",
        )
    )


REVIEWS = [
    (
        "cl_amelie",
        "bk_000",
        5,
        "Bella always comes home so soft and happy. "
        "Hannah is endlessly patient with her dryer anxiety.",
        True,
    ),
    (
        "cl_marcus",
        "bk_001",
        5,
        "Diego did a fantastic job on Rex's coat. Booking two dogs back-to-back is so convenient.",
        True,
    ),
    (
        "cl_liam",
        "bk_004",
        5,
        "They understood exactly what a show coat needs. Maple looked incredible.",
        True,
    ),
    (
        "cl_grace",
        "bk_005",
        4,
        "Lovely groom, Pepper looks great. Only wish there was a bit more parking.",
        False,
    ),
    (
        "cl_sophie",
        "bk_007",
        5,
        "First visit and I'm a convert. Gentle with my nervous little Shih Tzu.",
        True,
    ),
    (
        "cl_david",
        "bk_008",
        5,
        "Zeus loves daycare and comes home exhausted in the best way. Worth every penny.",
        True,
    ),
    ("cl_yuki", "bk_003", 4, "Great cat groom — Miso tolerated it better than expected!", False),
    (
        "cl_noah",
        "bk_006",
        3,
        "Good nail trim but the wait was a bit long past my appointment time.",
        False,
    ),
]


def seed_platform(owner: str) -> None:
    rows.append(
        Audit(
            id="aud_0",
            business_id=BIZ,
            performed_by=owner,
            action="invoice.paid",
            entity_type="invoice",
            entity_id="inv_1001",
            changes={"status": ["sent", "paid"]},
            created_at=at(-28, 18),
        )
    )
    rows.append(
        Audit(
            id="aud_1",
            business_id=BIZ,
            performed_by="us_diego",
            action="booking.completed",
            entity_type="booking",
            entity_id="bk_001",
            changes={"status": ["confirmed", "completed"]},
            created_at=at(-26, 14),
        )
    )
    rows.append(
        Audit(
            id="aud_2",
            business_id=BIZ,
            performed_by=owner,
            action="client.created",
            entity_type="client",
            entity_id="cl_sophie",
            changes={},
            created_at=at(-11, 9),
        )
    )


def seed_coverage() -> None:
    """Fill the remaining gaps so the demo exercises every surface beyond the verticals above."""

    rows.append(
        Order(
            id="ord_1",
            business_id=BIZ,
            number=1,
            client_id="cl_grace",
            staff_id="st_priya",
            status="open",
            subtotal_cents=4800,
            tax_total_cents=576,
            total_cents=5376,
        )
    )
    rows.append(
        Line(
            id="ln_ord1_1",
            business_id=BIZ,
            order_id="ord_1",
            description="Nail Trim & File",
            item_id="it_nails",
            quantity=1,
            unit_amount_cents=2400,
            amount_cents=2400,
            tax_amount_cents=288,
            position=0,
        )
    )
    rows.append(
        Line(
            id="ln_ord1_2",
            business_id=BIZ,
            order_id="ord_1",
            description="Oatmeal Shampoo — retail",
            item_id="it_shampoo",
            quantity=1,
            unit_amount_cents=2400,
            amount_cents=2400,
            tax_amount_cents=288,
            position=1,
        )
    )
    rows.append(
        Payment(
            id="pay_ord1",
            business_id=BIZ,
            client_id="cl_grace",
            kind="payment",
            order_id="ord_1",
            amount_cents=5376,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_ord1",
            status="succeeded",
            paid_at=at(-4, 15),
        )
    )

    rows.append(
        Order(
            id="ord_2",
            business_id=BIZ,
            number=2,
            client_id="cl_noah",
            staff_id="st_owner",
            status="open",
            subtotal_cents=2600,
            tax_total_cents=312,
            total_cents=2912,
        )
    )
    rows.append(
        Line(
            id="ln_ord2_1",
            business_id=BIZ,
            order_id="ord_2",
            description="Nail Trim & File",
            item_id="it_nails",
            quantity=1,
            unit_amount_cents=2600,
            amount_cents=2600,
            tax_amount_cents=312,
            position=0,
        )
    )
    rows.append(
        Payment(
            id="pay_ord2",
            business_id=BIZ,
            client_id="cl_noah",
            kind="payment",
            order_id="ord_2",
            amount_cents=2912,
            currency="CAD",
            method="cash",
            provider="manual",
            status="succeeded",
            paid_at=at(-1, 16),
        )
    )

    rows.append(
        Order(
            id="ord_3",
            business_id=BIZ,
            number=3,
            client_id=None,
            staff_id="st_priya",
            status="void",
            subtotal_cents=1800,
            tax_total_cents=216,
            total_cents=2016,
        )
    )
    rows.append(
        Line(
            id="ln_ord3_1",
            business_id=BIZ,
            order_id="ord_3",
            description="Slicker Brush — retail",
            item_id="it_shampoo",
            quantity=1,
            unit_amount_cents=1800,
            amount_cents=1800,
            tax_amount_cents=216,
            position=0,
        )
    )

    rows.append(
        Slot(
            id="ses_class",
            business_id=BIZ,
            item_id="it_puppy",
            staff_id="st_owner",
            starts_at=at(4, 11),
            ends_at=at(4, 11) + timedelta(minutes=60),
            capacity=6,
            recurrence_id="sch_puppy",
            status="scheduled",
        )
    )
    for j, (cl, pet) in enumerate(
        [("cl_sophie", "sj_mochi"), ("cl_noah", "sj_cooper"), ("cl_liam", "sj_maple")]
    ):
        rows.append(
            Booking(
                id=f"bk_class_{j}",
                business_id=BIZ,
                slot_id="ses_class",
                starts_at=at(4, 11),
                staff_id="st_owner",
                client_id=cl,
                subject_id=pet,
                status="confirmed",
                source="online",
                manage_token=f"manage_bk_class_{j}",
                price_cents=2800,
                deposit_amount_cents=1400,
                deposit_status="collected" if j == 0 else "pending",
                confirmed_at=at(1, 12),
            )
        )
    rows.append(
        Payment(
            id="pay_dep_class",
            business_id=BIZ,
            client_id="cl_sophie",
            kind="deposit",
            booking_id="bk_class_0",
            amount_cents=1400,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_dep_class",
            status="succeeded",
            paid_at=at(-1, 12),
        )
    )

    rows.append(
        Slot(
            id="ses_refund",
            business_id=BIZ,
            item_id="it_groom_sm",
            staff_id="st_diego",
            starts_at=at(-9, 14),
            ends_at=at(-9, 14) + timedelta(minutes=60),
            capacity=1,
            status="completed",
        )
    )
    rows.append(
        Booking(
            id="bk_refund",
            business_id=BIZ,
            slot_id="ses_refund",
            starts_at=at(-9, 14),
            staff_id="st_diego",
            client_id="cl_olivia",
            subject_id="sj_bandit",
            status="completed",
            source="manual",
            price_cents=7500,
            confirmed_at=at(-10, 12),
            completed_at=at(-9, 15),
            invoice_id="inv_1099",
        )
    )
    rows.append(
        Invoice(
            id="inv_1099",
            business_id=BIZ,
            client_id="cl_olivia",
            number=1099,
            status="sent",
            currency="CAD",
            subtotal_cents=7500,
            tax_total_cents=900,
            total_cents=8400,
            issued_at=at(-9, 15),
            due_at=at(5, 17),
            notes="Groom for Bandit.",
        )
    )
    rows.append(
        Line(
            id="ln_1099_1",
            business_id=BIZ,
            invoice_id="inv_1099",
            description="Full Groom — Small Dog",
            item_id="it_groom_sm",
            booking_id="bk_refund",
            quantity=1,
            unit_amount_cents=7500,
            amount_cents=7500,
            tax_amount_cents=900,
            position=0,
        )
    )
    rows.append(
        Payment(
            id="pay_refo",
            business_id=BIZ,
            client_id="cl_olivia",
            kind="payment",
            invoice_id="inv_1099",
            booking_id="bk_refund",
            amount_cents=8400,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="pi_demo_1099",
            status="succeeded",
            paid_at=at(-9, 16),
        )
    )
    rows.append(
        Payment(
            id="pay_refr",
            business_id=BIZ,
            client_id="cl_olivia",
            kind="refund",
            parent_payment_id="pay_refo",
            invoice_id="inv_1099",
            booking_id="bk_refund",
            amount_cents=8400,
            currency="CAD",
            method="card",
            provider="stripe",
            provider_ref="re_demo_1099",
            status="succeeded",
            paid_at=at(-8, 10),
        )
    )

    for iid, num, st in [
        ("inv_void", 1096, "void"),
        ("inv_draft", 1097, "draft"),
        ("inv_sent", 1098, "sent"),
    ]:
        rows.append(
            Invoice(
                id=iid,
                business_id=BIZ,
                client_id="cl_ethan",
                number=num,
                status=st,
                currency="CAD",
                subtotal_cents=4800,
                tax_total_cents=576,
                total_cents=5376,
                issued_at=None if st == "draft" else at(-2, 10),
                due_at=at(12, 17),
                voided_at=at(-1, 9) if st == "void" else None,
                notes="Bath & tidy for Willow.",
            )
        )
        rows.append(
            Line(
                id=f"ln_{iid}",
                business_id=BIZ,
                invoice_id=iid,
                description="Bath & Brush",
                item_id="it_bath",
                quantity=1,
                unit_amount_cents=4800,
                amount_cents=4800,
                tax_amount_cents=576,
                position=0,
            )
        )

    rows.append(
        Estimate(
            id="est_1003",
            business_id=BIZ,
            client_id="cl_yuki",
            number=3,
            status="declined",
            subtotal_cents=9000,
            tax_total_cents=1080,
            total_cents=10080,
            valid_until=at(-5).date(),
            declined_at=at(-6, 14),
            notes="Two-cat spa day.",
        )
    )
    rows.append(
        Line(
            id="ln_est3",
            business_id=BIZ,
            estimate_id="est_1003",
            description="Cat Groom \N{MULTIPLICATION SIGN}2",
            item_id="it_cat",
            quantity=2,
            unit_amount_cents=4500,
            amount_cents=9000,
            tax_amount_cents=1080,
            position=0,
        )
    )
    rows.append(
        Invoice(
            id="inv_1095",
            business_id=BIZ,
            client_id="cl_sophie",
            number=1095,
            status="sent",
            currency="CAD",
            subtotal_cents=7500,
            tax_total_cents=900,
            total_cents=8400,
            issued_at=at(-1, 11),
            due_at=at(13, 17),
            notes="Converted from estimate #4.",
        )
    )
    rows.append(
        Line(
            id="ln_1095",
            business_id=BIZ,
            invoice_id="inv_1095",
            description="Full Groom — Small Dog",
            item_id="it_groom_sm",
            quantity=1,
            unit_amount_cents=7500,
            amount_cents=7500,
            tax_amount_cents=900,
            position=0,
        )
    )
    rows.append(
        Estimate(
            id="est_1004",
            business_id=BIZ,
            client_id="cl_sophie",
            number=4,
            status="accepted",
            subtotal_cents=7500,
            tax_total_cents=900,
            total_cents=8400,
            valid_until=at(10).date(),
            accepted_at=at(-2, 10),
            converted_invoice_id="inv_1095",
            notes="Approved by Sophie — converted to an invoice.",
        )
    )

    rows.append(
        Subscription(
            id="sub_canceled",
            business_id=BIZ,
            client_id="cl_grace",
            item_id="it_daycare",
            status="canceled",
            current_period_end=at(-10, 0),
            provider_ref="sub_demo_grace",
        )
    )
    rows.append(
        Subscription(
            id="sub_pastdue",
            business_id=BIZ,
            client_id="cl_ethan",
            item_id="it_daycare",
            status="past_due",
            current_period_end=at(22, 0),
            provider_ref="sub_demo_ethan",
        )
    )
    rows.append(
        Payment(
            id="pay_sub_david",
            business_id=BIZ,
            client_id="cl_david",
            kind="payment",
            amount_cents=18000,
            currency="CAD",
            method="bank_eft",
            provider="stripe",
            provider_ref="pi_demo_sub_david",
            status="succeeded",
            paid_at=at(-6, 6),
        )
    )


# Parents before children: models declare no relationships, so inserts aren't ordered for us.
INSERT_ORDER = [
    Business,
    User,
    Staff,
    Client,
    Consent,
    Item,
    Resource,
    Form,
    Contract,
    Broadcast,
    PaymentMethod,
    Subject,
    Note,
    Package,
    Subscription,
    GiftCard,
    Recurrence,
    Hours,
    FormField,
    FormResponse,
    Signature,
    Thread,
    Slot,
    Invoice,
    Order,
    Estimate,
    Booking,
    VisitRecord,
    Addon,
    Message,
    Line,
    StockMovement,
    Payment,
    ReviewRequest,
    File,
    Audit,
    Webhook,
]


FILLER_ITEMS = ["it_groom_sm", "it_bath", "it_nails", "it_deshed", "it_cat"]
FILLER_STAFF = ["st_owner", "st_diego", "st_priya"]


def _working_hours(member: str, day: date) -> tuple[time, time] | None:
    """A member's open window on a day; a dated row wins, and no rows means 9 to 5."""
    mine = [r for r in rows if isinstance(r, Hours) and r.staff_id == member]
    if not mine:
        return time(9, 0), time(17, 0)
    dated = [r for r in mine if r.basis == "date" and r.date == day]
    chosen = dated or [r for r in mine if r.basis == "recurring" and r.weekday == day.weekday()]
    window = next((r for r in chosen if r.available), None)
    if window is None or window.start_time is None or window.end_time is None:
        return None
    return window.start_time, window.end_time


def seed_calendar_filler() -> None:
    """Steady bookings from four months back to a month out; past ones are completed and paid."""
    rng = random.Random(7)
    INV_SEQ[0] = max(INV_SEQ[0], 1100)  # above the hand-numbered invoices
    pairs = sorted({(client, pet) for *_, client, pet, _ in APPTS})
    busy = [(r.staff_id, r.starts_at, r.ends_at) for r in rows if isinstance(r, Slot)]
    n = 0
    for d in range(-120, 31):
        for member in FILLER_STAFF:
            hours = _working_hours(member, at(d).astimezone(now.tzinfo).date())
            if hours is None:
                continue
            for _ in range(rng.randint(1, 2)):
                item_id = rng.choice(FILLER_ITEMS)
                item = next(x for x in ITEMS if x[0] == item_id)
                price, dur, tax = item[3], item[4] or 60, item[6]
                options = [
                    (h, m)
                    for h in range(hours[0].hour, hours[1].hour)
                    for m in (0, 30)
                    if time(h, m) >= hours[0]
                    and (datetime.combine(date.min, time(h, m)) + timedelta(minutes=dur)).time()
                    <= hours[1]
                ]
                rng.shuffle(options)
                slot = next(
                    (
                        (start, start + timedelta(minutes=dur))
                        for start in (at(d, h, m) for h, m in options)
                        if not any(
                            staff == member and start < e and b < start + timedelta(minutes=dur)
                            for staff, b, e in busy
                        )
                    ),
                    None,
                )
                if slot is None:
                    continue
                start, end = slot
                busy.append((member, start, end))
                client, pet = rng.choice(pairs)
                done = end < now
                status = "completed" if done else "confirmed"
                ses, bk = f"ses_f{n:03d}", f"bk_f{n:03d}"
                n += 1
                rows.append(
                    Slot(
                        id=ses,
                        business_id=BIZ,
                        item_id=item_id,
                        staff_id=member,
                        starts_at=start,
                        ends_at=end,
                        capacity=1,
                        status="completed" if done else "scheduled",
                    )
                )
                rows.append(
                    Booking(
                        id=bk,
                        business_id=BIZ,
                        slot_id=ses,
                        starts_at=start,
                        staff_id=member,
                        client_id=client,
                        subject_id=pet,
                        status=status,
                        source="online" if n % 3 == 0 else "manual",
                        manage_token=f"manage_{bk}" if n % 3 == 0 else None,
                        price_cents=price,
                        confirmed_at=start - timedelta(days=1),
                        completed_at=end if done else None,
                    )
                )
                if done:
                    _invoice_for(n, client, bk, item_id, price, dur, tax, member, d, settled=True)


SERIES_VISITS = 8
DISPUTED = "pay_1006"
# client, name, email, phone, pet, pet name, breed, weight, day, item, member
FIRST_VISITS = [
    (
        "cl_nadia",
        "Nadia Kowalczyk",
        "nadia.k@example.test",
        "+12505550192",
        "sj_biscuit",
        "Biscuit",
        "Cavapoo",
        7,
        5,
        "it_groom_sm",
        "st_owner",
    ),
    (
        "cl_tom",
        "Tom Becker",
        "tom.b@example.test",
        "+12505550193",
        "sj_juno",
        "Juno",
        "Labrador Retriever",
        28,
        8,
        "it_bath",
        "st_priya",
    ),
]


def seed_first_visits() -> None:
    """New clients' first online bookings, which wait for approval under the booking policy."""
    for index, (cid, name, _email, phone, pid, pet, breed, kg, d, item_id, member) in enumerate(
        FIRST_VISITS
    ):
        item = next(x for x in ITEMS if x[0] == item_id)
        start = at(d, 10)
        joined = at(-3, 19)
        rows.append(
            Client(
                id=cid,
                business_id=BIZ,
                name=name,
                phone=phone,
                tags=["new"],
                status="active",
                custom_fields={"source": "online booking"},
                created_at=joined,
                updated_at=joined,
            )
        )
        rows.append(
            Subject(
                id=pid,
                business_id=BIZ,
                client_id=cid,
                name=pet,
                attributes={"breed": breed, "weight_kg": kg, "temperament": "friendly"},
                created_at=joined,
                updated_at=joined,
            )
        )
        rows.append(
            Slot(
                id=f"ses_welcome_{index}",
                business_id=BIZ,
                item_id=item_id,
                staff_id=member,
                starts_at=start,
                ends_at=start + timedelta(minutes=item[4] or 60),
                capacity=1,
                status="scheduled",
            )
        )
        rows.append(
            Booking(
                id=f"bk_welcome_{index}",
                business_id=BIZ,
                slot_id=f"ses_welcome_{index}",
                starts_at=start,
                staff_id=member,
                client_id=cid,
                subject_id=pid,
                status="pending",
                source="online",
                manage_token=f"manage_bk_welcome_{index}",
                price_cents=item[3],
            )
        )


def seed_client_series() -> None:
    """Sophie's fortnightly groom booked as a series: past visits done and paid, the rest ahead."""
    rows.append(
        Recurrence(
            id="sch_mochi",
            business_id=BIZ,
            item_id="it_groom_sm",
            staff_id="st_owner",
            client_id="cl_sophie",
            frequency="week",
            interval=2,
            byday=["WE"],
            count=SERIES_VISITS,
            status="active",
        )
    )
    item = next(x for x in ITEMS if x[0] == "it_groom_sm")
    price, dur, tax = item[3], item[4] or 60, item[6]
    first = next(d for d in range(-21, -14) if at(d).astimezone(now.tzinfo).weekday() == 2)
    for n in range(SERIES_VISITS):
        d = first + 14 * n
        start = at(d, 15)
        end = start + timedelta(minutes=dur)
        done = end < now
        ses, bk = f"ses_s{n}", f"bk_s{n}"
        rows.append(
            Slot(
                id=ses,
                business_id=BIZ,
                item_id="it_groom_sm",
                staff_id="st_owner",
                recurrence_id="sch_mochi",
                starts_at=start,
                ends_at=end,
                capacity=1,
                status="completed" if done else "scheduled",
            )
        )
        rows.append(
            Booking(
                id=bk,
                business_id=BIZ,
                slot_id=ses,
                starts_at=start,
                staff_id="st_owner",
                client_id="cl_sophie",
                subject_id="sj_mochi",
                status="completed" if done else "confirmed",
                source="manual",
                price_cents=price,
                deposit_amount_cents=0,
                confirmed_at=at(first - 1, 12),
                completed_at=end if done else None,
            )
        )
        if done:
            _invoice_for(n, "cl_sophie", bk, "it_groom_sm", price, dur, tax, "st_owner", d, True)


def seed_dispute() -> None:
    """A card chargeback awaiting a response; seed_ledger books the pulled funds and fee."""
    payment = next(r for r in rows if isinstance(r, Payment) and r.id == DISPUTED)
    assert payment.method == "card"
    payment.dispute_status = "needs_response"
    payment.dispute_reason = "product_not_received"
    payment.dispute_respond_by = at(6, 17)


def build_birchbark(as_of: datetime | None = None) -> DemoContext:
    global now, rows
    if as_of is not None:
        if as_of.tzinfo is None:
            raise ValueError("--as-of must include a timezone offset")
        clock.travel(as_of)
    now = (clock.now() if as_of is None else as_of).astimezone(VANCOUVER)
    rows = []
    INV_SEQ[0] = 1000
    owner, _ = seed_identity()
    seed_items(owner)
    seed_clients(owner)
    seed_hours()
    seed_catalog_instances()
    seed_lapsed_entitlements()
    seed_payment_methods()
    seed_appointments()
    seed_estimates()
    seed_platform(owner)
    seed_coverage()
    seed_open_sale()
    seed_online_shop()
    seed_client_series()
    seed_first_visits()
    seed_calendar_filler()
    seed_dispute()
    ctx = DemoContext(now, BIZ, owner, rows)
    add_scenarios(ctx)
    add_class_timetable(ctx)
    add_repeat_visits(ctx)
    add_catalog_images(ctx)
    add_finance_scenarios(ctx)
    build_calendar(ctx)
    finish_schedule(ctx)
    add_visit_day(ctx)
    prepare_finance(ctx)
    build_identity(ctx)
    add_people_photos(ctx, BIZ)
    build_engagement(ctx)
    align_chronology(ctx)

    ctx.add(
        Audit(
            id="aud_demo_seed",
            business_id=BIZ,
            performed_by=owner,
            action="demo.seed",
            entity_type="business",
            entity_id=BIZ,
            changes={
                "version": DEMO_VERSION,
                "as_of": now.isoformat(),
            },
            created_at=now,
        )
    )
    for file in ctx.all(File):
        file.uploaded_at = now  # every demo file's bytes are uploaded before its row is written
    forms = {form.id: form for form in ctx.all(Form)}
    for response in [*ctx.all(FormResponse), *ctx.all(VisitRecord)]:
        response.definition = form_definition(
            forms[response.form_id],
            [field for field in ctx.all(FormField) if field.form_id == response.form_id],
            "reconstructed",
        )
    errors = validate_graph(ctx) + chronology_errors(ctx)
    if errors:
        raise ValueError("Invalid demo graph: " + "; ".join(errors[:20]))
    return ctx


def build_demo(as_of: datetime | None = None, *, core: bool = False) -> DemoContext:
    """Birchbark's context, holding every edition's rows too, for checks of the whole demo."""
    ctx = build_birchbark(as_of)
    for edition in editions(core=core):
        rows.extend(build_edition(edition, now).ctx.rows)
    return ctx


def validate_seed_target() -> None:
    settings = get_settings()
    url = make_url(settings.migration_database_url)
    # staging's pods reach their own database through the Cloud SQL proxy on localhost too
    if settings.env not in ("dev", "staging") or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Demo seeding requires ENV=dev or staging and a localhost database.")
    if settings.env == "staging":
        if url.database != STAGING_DATABASE:
            raise SystemExit(f"Seed staging's own {STAGING_DATABASE} database.")
        return
    if url.database != "clientbridge" and not (url.database or "").startswith("clientbridge_test"):
        raise SystemExit(
            "Seed the local clientbridge database or an isolated clientbridge_test database."
        )


def validate_prune_target(*, core: bool) -> None:
    if core:
        raise SystemExit("--prune-logins needs a full seed; a core seed leaves out demo logins.")
    settings = get_settings()
    target = make_url(settings.migration_database_url).database
    app = APP_DATABASES.get(settings.env)
    # every other database on this auth service, test or scratch, holds only some of its users
    if target is None or target != app or make_url(settings.database_url).database != target:
        raise SystemExit(
            f"--prune-logins needs the {app or 'app'} database the API serves, not {target}."
        )


@dataclass
class Graph:
    """One demo business's rows, built and validated in memory, with the posting of its ledger."""

    business_id: str
    ctx: DemoContext
    demo: Demo | None = None

    async def post_ledger(self, db: AsyncSession) -> None:
        if self.demo is None:
            await seed_finance(db, self.ctx)
        else:
            await seed_ledger(db, self.demo)


@dataclass(frozen=True)
class Outcome:
    business_id: str
    rows: int
    seconds: float
    error: str | None = None


def build_graph(business_id: str, as_of: datetime) -> Graph:
    if business_id == BIZ:
        return Graph(BIZ, build_birchbark(as_of))
    clock.travel(as_of)
    demo = build_edition(edition_of(business_id), as_of.astimezone(VANCOUVER))
    return Graph(business_id, demo.ctx, demo)


async def replace_business(session: AsyncSession, business_id: str, seeded: Sequence[User]) -> None:
    """Purge one business and every user who belongs only to it or has one of its seeded emails."""
    members = select(Staff.user_id).where(Staff.user_id.isnot(None))
    inside = members.where(Staff.business_id == business_id)
    outside = members.where(Staff.business_id != business_id)
    named = or_(User.id.in_([u.id for u in seeded]), User.email.in_([u.email for u in seeded]))
    if await session.scalar(select(User.id).where(named, User.id.in_(outside)).limit(1)):
        raise ValueError("Seeded users belong to another business; refusing to replace them")
    stale = await session.scalars(
        select(User.id).where(or_(named, and_(User.id.in_(inside), User.id.not_in(outside))))
    )
    await purge_businesses(session, [business_id], list(stale))


async def purge_businesses(
    session: AsyncSession, business_ids: list[str], user_ids: list[str]
) -> None:
    """Delete these businesses' rows and users; pausing the append-only trigger needs the owner."""
    await session.execute(
        update(Payment).where(Payment.business_id.in_(business_ids)).values(booking_id=None)
    )
    ledgered = await session.scalar(
        select(Entry.id).where(Entry.business_id.in_(business_ids)).limit(1)
    )
    for table in reversed(Base.metadata.sorted_tables):
        if "business_id" in table.c:
            condition = table.c.business_id.in_(business_ids)
        elif table.name == "businesses":
            condition = table.c.id.in_(business_ids)
        elif table.name == "users":
            condition = table.c.id.in_(user_ids)
        else:
            continue
        if table.name != "entries":
            await session.execute(delete(table).where(condition))
        elif ledgered is not None:
            # the trigger change and its table lock last until this seed transaction ends
            await session.execute(text("ALTER TABLE entries DISABLE TRIGGER entries_append_only"))
            await session.execute(delete(table).where(condition))
            await session.execute(text("ALTER TABLE entries ENABLE TRIGGER entries_append_only"))


def stamp_entries(session: Session, context: object, instances: object) -> None:
    """A seeded entry is recorded when it occurred, not when the seed ran."""
    for entry in session.new:
        if isinstance(entry, Entry):
            entry.created_at = entry.occurred_at


async def date_seed_writes(session: AsyncSession, business_id: str, as_of: datetime) -> None:
    """Rows the database stamped while seeding take the scenario's times, not the wall clock."""
    accounts, entries = Base.metadata.tables["accounts"], Base.metadata.tables["entries"]
    span = select(entries.c.occurred_at).where(entries.c.account_id == accounts.c.id)
    await session.execute(
        update(accounts)
        .where(accounts.c.business_id == business_id)
        .values(
            created_at=func.coalesce(
                span.with_only_columns(func.min(entries.c.occurred_at)).scalar_subquery(), as_of
            ),
            updated_at=func.coalesce(
                span.with_only_columns(func.max(entries.c.occurred_at)).scalar_subquery(), as_of
            ),
        )
    )
    for table in Base.metadata.sorted_tables:
        if table.name in {"accounts", "entries"}:
            continue
        scope: ColumnElement[bool]
        if "business_id" in table.c:
            scope = table.c.business_id == business_id
        elif table.name == "businesses":
            scope = table.c.id == business_id
        else:
            continue
        for column in ("created_at", "updated_at"):
            if column in table.c:
                stamped = table.c[column] == func.transaction_timestamp()
                await session.execute(update(table).where(scope, stamped).values({column: as_of}))


async def write_business(graph: Graph, url: str) -> None:
    """Write one purged business, post its ledger and validate it, all in one transaction."""
    owner = create_async_engine(url)
    try:
        async with async_sessionmaker(owner, expire_on_commit=False)() as session:
            event.listen(session.sync_session, "before_flush", stamp_entries)
            for cls in INSERT_ORDER:
                batch = [r for r in graph.ctx.rows if type(r) is cls]
                if batch:
                    session.add_all(batch)
                    await session.flush()
            await graph.post_ledger(session)
            await session.flush()
            await date_seed_writes(session, graph.business_id, graph.ctx.now)
            report = await validate_database(
                session, as_of=graph.ctx.now, business_ids=[graph.business_id]
            )
            if not report["ok"]:
                raise ValueError(f"validation failed: {report['errors']}")
            await session.commit()
    finally:
        await owner.dispose()
        await engine.dispose()


def written(graph: Graph, as_of: datetime, url: str) -> Outcome:
    clock.travel(as_of)
    started = monotonic()
    try:
        asyncio.run(write_business(graph, url))
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        return Outcome(graph.business_id, len(graph.ctx.rows), monotonic() - started, error)
    return Outcome(graph.business_id, len(graph.ctx.rows), monotonic() - started)


async def retired_demo(owner: AsyncEngine, graphs: Sequence[Graph]) -> list[str]:
    """Demo businesses seeded before, or registered, that this run does not write."""
    async with async_sessionmaker(owner)() as session:
        earlier = await session.scalars(
            select(Audit.business_id).where(Audit.action == "demo.seed").distinct()
        )
        seeding = {graph.business_id for graph in graphs}
        return sorted({*DEMO_IDS, *(b for b in earlier.all() if b)} - seeding)


async def purge_demo(owner: AsyncEngine, graphs: Sequence[Graph], retired: Sequence[str]) -> None:
    """Clear every demo business, registered or not, one short transaction each."""
    seeded = [(graph.business_id, graph.ctx.all(User)) for graph in graphs]
    # purged before any write starts, since a purge locks the ledger until it commits
    for business_id, users in [*seeded, *((b, []) for b in retired)]:
        async with async_sessionmaker(owner)() as session:
            await replace_business(session, business_id, users)
            await session.commit()


async def copy_demo(owner: AsyncEngine, scratch_url: str, graphs: Sequence[Graph]) -> list[str]:
    """Replace each business with its scratch rows in one transaction; a failure keeps the old."""
    scratch = await demo_copy.connect(scratch_url)
    try:
        users = {graph.business_id: graph.ctx.all(User) for graph in graphs}
        stray = await demo_copy.uncovered(
            scratch, list(users), [user.id for each in users.values() for user in each]
        )
        if stray:
            raise SystemExit(f"Scratch rows outside the demo would not be copied: {stray}")
        failed: list[str] = []
        for business_id, seeded in users.items():
            started = monotonic()
            try:
                async with async_sessionmaker(owner)() as session:
                    await replace_business(session, business_id, seeded)
                    rows = await demo_copy.copy_business(
                        scratch, session, business_id, [user.id for user in seeded]
                    )
                    await session.commit()
            except Exception as exc:
                print(f"{business_id}: copy failed, {type(exc).__name__}: {exc}")
                failed.append(business_id)
                continue
            print(f"{business_id}: copied {rows} rows in {monotonic() - started:.1f}s")
        return failed
    finally:
        await scratch.close()


async def cross_business_check(owner: AsyncEngine, seeded: list[str]) -> list[str]:
    async with async_sessionmaker(owner)() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        return await cross_business_errors(session, seeded)


async def link_identities(identities: IdentityProvider, users: Sequence[User]) -> None:
    """Every demo user signs in with the demo password and a verified email, tagged as demo."""
    try:
        for user in users:
            found = await identities.find_identity(user.email)
            if found is None:
                name = user.name or ""
                found = await identities.create_identity(user.email, name, DEMO_PASSWORD, demo=True)
            else:
                await identities.tag_demo(found)
            user.identity_id = found
    except AppError as exc:
        raise SystemExit(
            f"the auth service is not reachable at {get_settings().auth_admin_url}"
        ) from exc


async def finish(
    owner: AsyncEngine,
    business_ids: Sequence[str],
    seeded: Sequence[str],
    prune: IdentityProvider | None,
) -> None:
    """Check the target across businesses, then prune its retired demo logins when asked."""
    errors = await cross_business_check(owner, list(business_ids))
    if errors:
        raise SystemExit(f"Demo validation failed across businesses: {errors[:20]}")
    if prune is not None:
        await prune_stale_logins(owner, prune, seeded)


async def prune_stale_logins(
    owner: AsyncEngine, identities: IdentityProvider, seeded: Sequence[str]
) -> None:
    """Delete the seed's identities for demo logins it no longer writes, once the users are in."""
    try:
        async with async_sessionmaker(owner)() as session, session.begin():
            pruned = await prune_logins(session, identities, seeded)
    except AppError as exc:
        raise SystemExit(
            f"the auth service is not reachable at {get_settings().auth_admin_url}"
        ) from exc
    print(f"Pruned {len(pruned)} stale demo logins: {', '.join(pruned) or 'none'}.")


def default_jobs() -> int:
    return max(1, min(os.cpu_count() or 1, MAX_JOBS))


async def main(
    *,
    as_of: datetime | None = None,
    core: bool = False,
    jobs: int = 1,
    scratch: str | None = None,
    prune: bool = False,
) -> None:
    """Write the demo into the target, or into an empty scratch database to copy from."""
    validate_seed_target()
    if prune:
        validate_prune_target(core=core)
    if as_of is not None and as_of.tzinfo is None:
        raise ValueError("--as-of must include a timezone offset")
    anchor = as_of or clock.now()
    business_ids = [b.id for b in DEMO_BUSINESSES if b.core or not core]
    loop = asyncio.get_running_loop()
    target = get_settings().migration_database_url
    writes = target if scratch is None else await demo_copy.prepare(scratch, target)
    owner = create_async_engine(target)
    # a fresh process per task: the clock and each engine belong to one business
    with ProcessPoolExecutor(min(jobs, len(business_ids)), max_tasks_per_child=1) as pool:
        graphs = list(
            await asyncio.gather(
                *(loop.run_in_executor(pool, build_graph, b, anchor) for b in business_ids)
            )
        )
        await link_identities(
            get_identity_provider(), [user for graph in graphs for user in graph.ctx.all(User)]
        )
        upload_demo_assets([file for graph in graphs for file in graph.ctx.all(File)])
        retired = await retired_demo(owner, graphs)
        if scratch is None:
            await purge_demo(owner, graphs, retired)
        # the largest business first, so the longest ledger is not left for last
        graphs.sort(key=lambda graph: len(graph.ctx.rows), reverse=True)
        outcomes = await asyncio.gather(
            *(loop.run_in_executor(pool, written, graph, anchor, writes) for graph in graphs)
        )
    for outcome in outcomes:
        state = outcome.error or "ok"
        print(f"{outcome.business_id}: {outcome.rows} rows in {outcome.seconds:.1f}s, {state}")
    failed = [outcome.business_id for outcome in outcomes if outcome.error]
    if failed:
        await owner.dispose()
        kept = "the rest were written" if scratch is None else "nothing was copied"
        raise SystemExit(f"Demo seed failed for {', '.join(failed)}; {kept}.")
    if scratch is not None:
        started = monotonic()
        await purge_demo(owner, [], retired)
        failed = await copy_demo(owner, writes, graphs)
        print(f"Copied {len(graphs) - len(failed)} businesses in {monotonic() - started:.1f}s.")
        if failed:
            await owner.dispose()
            raise SystemExit(f"Demo copy failed for {', '.join(failed)}; they keep their old rows.")
    seeded = [user.email for graph in graphs for user in graph.ctx.all(User)]
    try:
        # the target, never scratch: its users are the ones that sign in
        await finish(owner, business_ids, seeded, get_identity_provider() if prune else None)
    finally:
        await owner.dispose()
    total = sum(outcome.rows for outcome in outcomes)
    print(f"Seeded {total} rows; demo {DEMO_VERSION}, as of {anchor.isoformat()}.")


def upload_demo_assets(files: Sequence[File]) -> None:
    """Upload and verify every demo asset before replacing any database rows."""
    s = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        config=S3_CONFIG.merge(
            BotoConfig(
                connect_timeout=2,
                retries={"max_attempts": 1},
                max_pool_connections=UPLOADS,
            )
        ),
    )

    def upload(asset: File) -> None:
        path = ASSETS / Path(asset.s3_key).name
        if not path.is_file() or path.stat().st_size != asset.size:
            raise ValueError(f"Missing or mismatched demo asset: {asset.id}")
        client.upload_file(
            str(path), s.s3_bucket, asset.s3_key, ExtraArgs={"ContentType": asset.content_type}
        )

    try:
        # local MinIO starts empty; a deployed bucket comes from infra, and its key cannot list
        if s.env == "dev" and s.s3_bucket not in {
            b["Name"] for b in client.list_buckets().get("Buckets", [])
        }:
            client.create_bucket(Bucket=s.s3_bucket)
        with ThreadPoolExecutor(UPLOADS) as uploads:
            list(uploads.map(upload, files))
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError("Demo asset upload failed; database was not reset") from exc


def arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", type=datetime.fromisoformat)
    parser.add_argument(
        "--core", action="store_true", help="seed only the core businesses that tests run against"
    )
    parser.add_argument(
        "--jobs", type=int, default=default_jobs(), help="businesses written at the same time"
    )
    parser.add_argument(
        "--scratch",
        help="an empty database to seed first, then copy each business from in one transaction",
    )
    parser.add_argument(
        "--prune-logins",
        action="store_true",
        help="delete the seed's auth identities for retired demo logins; app database only",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    # run from the imported module, so the worker processes find what they are sent by name
    from scripts import seed_demo

    args = seed_demo.arguments()
    asyncio.run(
        seed_demo.main(
            as_of=args.as_of,
            core=args.core,
            jobs=args.jobs,
            scratch=args.scratch,
            prune=args.prune_logins,
        )
    )
