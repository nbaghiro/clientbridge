"""Build and validate an isolated demo, replacing existing demo rows only with --reset-demo."""

from __future__ import annotations

import argparse
import asyncio
import random
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3
import httpx
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import delete, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import Base, SessionLocal, engine
from clientbridge.core.security import hash_password, hash_token
from clientbridge.integrations.s3 import get_file_storage
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import GiftCard, Item, Package, StockMovement, Subscription
from clientbridge.models.clients import Client, Consent, Note, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Audit, File, Webhook
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import (
    Addon,
    Booking,
    Hours,
    Recurrence,
    Resource,
    Slot,
)
from scripts.demo_calendar import build_calendar
from scripts.demo_chronology import align_chronology, chronology_errors
from scripts.demo_context import DEMO_VERSION, DemoContext
from scripts.demo_engagement import build_engagement
from scripts.demo_finance import add_finance_scenarios, prepare_finance, seed_finance
from scripts.demo_identity import build_identity
from scripts.demo_scenarios import add_scenarios
from scripts.demo_validate import validate_database, validate_graph

NOW = datetime.now(ZoneInfo("America/Vancouver"))
BIZ = "bz_birchbark"
DEMO_PASSWORD = "demo1234"  # every seeded user logs in with this
rows: list[Base] = []
EARNING_STAGE: dict[str, str] = {}  # booking id -> how far its groomer's earning has gone
PACKAGE_USED = {"pkg_marcus": 2, "pkg_grace": 5, "pkg_sophie": 4}


def at(days_offset: float, hour: int = 9, minute: int = 0) -> datetime:
    """A local business-hour timestamp relative to now, stored as UTC, so demo times read sensibly."""
    return (
        (NOW + timedelta(days=days_offset))
        .replace(hour=hour, minute=minute, second=0, microsecond=0)
        .astimezone(UTC)
    )


def face(seed: str) -> str:
    return f"https://i.pravatar.cc/300?u={seed}"


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
}


def seed_identity() -> tuple[str, str]:
    owner_id = "us_dev"
    rows.append(
        Business(
            id=BIZ,
            name="Birchbark Pet Studio",
            slug="birchbark",
            locale="en",
            timezone="America/Vancouver",
            province="BC",
            gst_hst_number="84720 1539 RT0001",
            tax_registered=True,
            brand={
                "logo_file_id": "fl_logo",
                "avatar_file_id": "fl_logo_avatar",
                "primary": "#2E4A3F",
                "tagline": "Calm, careful grooming on Vancouver Island.",
            },
            billing_email="hello@birchbarkpets.ca",
            stripe_account_id="acct_demo_birchbark",
            status="active",
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
        File(
            id="fl_logo_avatar",
            business_id=BIZ,
            parent_type="business",
            parent_id=BIZ,
            purpose="logo",
            s3_key=f"{BIZ}/demo/logo-mark.png",
            content_type="image/png",
            size=(ASSETS / "logo-mark.png").stat().st_size,
        )
    )
    rows.append(
        User(
            id=owner_id,
            email="hannah@birchbarkpets.ca",
            name="Hannah Wong",
            phone="+12505550110",
            password_hash=hash_password(DEMO_PASSWORD),
            oauth={},
        )
    )
    rows.append(
        User(
            id="us_diego",
            email="diego@birchbarkpets.ca",
            name="Diego Ramirez",
            phone="+12505550111",
            password_hash=hash_password(DEMO_PASSWORD),
            oauth={},
        )
    )
    rows.append(
        User(
            id="us_priya",
            email="priya@birchbarkpets.ca",
            name="Priya Patel",
            phone="+12505550112",
            password_hash=hash_password(DEMO_PASSWORD),
            oauth={},
        )
    )
    rows.append(
        Staff(
            id="st_owner",
            business_id=BIZ,
            user_id=owner_id,
            name="Hannah Wong",
            role="owner",
            payee=True,
            rate_bps=10000,
            rate_type="percent",
            title="Owner & Lead Groomer",
            color="#3F5E80",
            status="active",
        )
    )
    rows.append(
        Staff(
            id="st_diego",
            business_id=BIZ,
            user_id="us_diego",
            name="Diego Ramirez",
            role="staff",
            payee=True,
            rate_bps=4500,
            rate_type="percent",
            title="Senior Groomer",
            color="#2E7A5A",
            status="active",
        )
    )
    rows.append(
        Staff(
            id="st_priya",
            business_id=BIZ,
            user_id="us_priya",
            name="Priya Patel",
            role="staff",
            payee=False,
            rate_cents=2200,
            rate_type="hourly",
            title="Bather & Front Desk",
            color="#86621E",
            status="active",
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
        "Retail",
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
        "Retail",
        "De-mats and de-sheds; one-click bristle retract.",
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
STOCK = {"it_shampoo": (24, 6, 1100), "it_brush": (2, 5, 1300)}


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
                sell_online=iid in {"it_shampoo", "it_brush"},
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
        rows.append(
            File(
                id=f"fl_img_{iid}",
                business_id=BIZ,
                parent_type="item",
                parent_id=iid,
                purpose="image",
                s3_key=f"{BIZ}/demo/{iid}.png",
                content_type="image/png",
                size=(ASSETS / f"{iid}.png").stat().st_size,
            )
        )


# id, name, email, phone, tags, ltv($), face-seed, status, [pets], note
CLIENTS = [
    (
        "cl_amelie",
        "Amélie Tremblay",
        "amelie.t@example.com",
        "+12505550201",
        ["regular", "vip"],
        1240,
        "amelie",
        "active",
        [("sj_bella", "Bella", "Goldendoodle", 22, "anxious", "bella")],
        "Bella gets nervous with dryers — towel-dry first, muzzle for nails. Amélie prefers text.",
    ),
    (
        "cl_marcus",
        "Marcus Bennett",
        "marcus.b@example.com",
        "+12505550202",
        ["regular"],
        880,
        "marcus",
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
        "sophie.n@example.com",
        "+12505550203",
        ["new"],
        95,
        "sophie",
        "active",
        [("sj_mochi", "Mochi", "Shih Tzu", 6, "calm", "mochi")],
        "First-time client — found us on Google.",
    ),
    (
        "cl_david",
        "David Okafor",
        "david.o@example.com",
        "+12505550204",
        ["regular", "daycare"],
        2100,
        "david",
        "active",
        [("sj_zeus", "Zeus", "Rottweiler", 45, "gentle", "zeus")],
        "Daycare regular, M/W/F. Pays by Interac.",
    ),
    (
        "cl_grace",
        "Grace Lin",
        "grace.l@example.com",
        "+12505550205",
        ["regular"],
        640,
        "grace",
        "active",
        [("sj_pepper", "Pepper", "Mini Schnauzer", 8, "vocal", "pepper")],
        None,
    ),
    (
        "cl_liam",
        "Liam O'Connor",
        "liam.oc@example.com",
        "+12505550206",
        ["regular", "vip"],
        1560,
        "liam",
        "active",
        [("sj_maple", "Maple", "Nova Scotia Duck Toller", 20, "sweet", "maple")],
        "Maple is a show dog — careful around the tail feathering.",
    ),
    (
        "cl_yuki",
        "Yuki Tanaka",
        "yuki.t@example.com",
        "+12505550207",
        ["regular"],
        720,
        "yuki",
        "active",
        [("sj_miso", "Miso", "Domestic Shorthair (cat)", 5, "skittish", "miso")],
        "Cat groom only. Books quarterly.",
    ),
    (
        "cl_fatima",
        "Fatima Al-Sayed",
        "fatima.a@example.com",
        "+12505550208",
        ["new"],
        0,
        "fatima",
        "active",
        [("sj_simba", "Simba", "Pomeranian", 4, "bouncy", "simba")],
        "Inquiry — hasn't booked yet.",
    ),
    (
        "cl_noah",
        "Noah Schmidt",
        "noah.s@example.com",
        "+12505550209",
        ["regular"],
        410,
        "noah",
        "active",
        [("sj_cooper", "Cooper", "Labrador Retriever", 32, "friendly", "cooper")],
        None,
    ),
    (
        "cl_priscilla",
        "Priscilla Adeyemi",
        "p.adeyemi@example.com",
        "+12505550210",
        ["regular", "daycare"],
        1890,
        "priscilla",
        "active",
        [("sj_kobe", "Kobe", "French Bulldog", 12, "stubborn", "kobe")],
        "Kobe — watch breathing, keep grooming short and cool.",
    ),
    (
        "cl_ethan",
        "Ethan Wright",
        "ethan.w@example.com",
        "+12505550211",
        [],
        150,
        "ethan",
        "active",
        [("sj_willow", "Willow", "Cavalier King Charles", 9, "gentle", "willow")],
        None,
    ),
    (
        "cl_olivia",
        "Olivia Martin",
        "olivia.m@example.com",
        "+12505550212",
        ["churn-risk"],
        320,
        "olivia",
        "active",
        [("sj_bandit", "Bandit", "Australian Shepherd", 24, "anxious", "bandit")],
        "Hasn't booked in 4 months — send a win-back.",
    ),
]


def seed_clients(owner: str) -> None:
    for cid, name, email, phone, tags, _ltv, seed, status, pets, note in CLIENTS:
        rows.append(
            Client(
                id=cid,
                business_id=BIZ,
                created_by=owner,
                name=name,
                email=email,
                phone=phone,
                tags=tags,
                status=status,
                custom_fields={
                    "avatar_url": face(seed),
                    "source": "google" if "new" in tags else "referral",
                },
            )
        )
        for pid, pname, breed, weight, temperament, pseed in pets:
            rows.append(
                Subject(
                    id=pid,
                    business_id=BIZ,
                    client_id=cid,
                    kind="pet",
                    name=pname,
                    attributes={
                        "breed": breed,
                        "weight_kg": weight,
                        "temperament": temperament,
                        "vaccinated": True,
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


def seed_resources_hours() -> None:
    rows.append(
        Resource(id="rs_station_a", business_id=BIZ, name="Grooming Station A", category="station")
    )
    rows.append(
        Resource(id="rs_station_b", business_id=BIZ, name="Grooming Station B", category="station")
    )
    rows.append(Resource(id="rs_bath", business_id=BIZ, name="Bath Bay", category="room"))
    # recurring weekly hours Tue–Sat 9–17 for both groomers
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
    (3, 14, "it_cat", "st_owner", "cl_yuki", "sj_miso", "pending"),
    (5, 10, "it_groom_sm", "st_owner", "cl_sophie", "sj_mochi", "confirmed"),
    (6, 13, "it_nails", "st_priya", "cl_ethan", "sj_willow", "pending"),
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
                resource_id="rs_bath"
                if "bath" in item_id or "nails" in item_id
                else "rs_station_a",
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
                staff_id=member,  # denormalized from the session — drives per-member sync
                client_id=client,
                subject_id=pet,
                status=status,
                source="online" if i % 3 == 0 else "manual",
                manage_token=f"manage_{bk}" if i % 3 == 0 else None,
                price_cents=price,
                deposit_amount_cents=2000 if price >= 10000 else 0,
                deposit_status="pending"
                if price >= 10000 and status in {"pending", "confirmed"}
                else "none",
                confirmed_at=at(d - 1, 12) if status in {"confirmed", "completed"} else None,
                completed_at=at(d, h + 1) if status == "completed" else None,
                canceled_at=at(d - 1, 9) if status == "canceled" else None,
                custom_fields={"booked_via": "app"},
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
        method = "interac" if i % 3 == 0 else "card"
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
                provider="stripe" if method == "card" else "interac",
                provider_ref=f"pi_demo_{num}" if method == "card" else None,
                reference_code=f"BIRCH{num}" if method == "interac" else None,
                status="succeeded",
                paid_at=at(d, 18),
            )
        )
        if member in {"st_owner", "st_diego"}:
            EARNING_STAGE[bk] = "paid" if d < -7 else "approved" if d < -3 else "pending"


def seed_catalog_instances() -> None:
    rows.append(
        Package(
            id="pkg_marcus",
            business_id=BIZ,
            client_id="cl_marcus",
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
            current_period_start=at(-6, 0),
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
            current_period_start=at(-20, 0),
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
                provider="stripe",
                provider_ref=f"pm_demo_{last4}",
                preferred=True,
                mandate_status="none",
                status="active",
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
            provider="stripe",
            mandate_status="active",
            preferred=False,
            status="active",
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
            description="Full Groom — Small Dog ×3",
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
            description="De-shedding add-on ×1",
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
            description="Take-home Oatmeal Shampoo ×1",
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


INTAKE_FIELDS = [
    ("pet_name", "text", "Pet's name", True),
    ("species", "select", "Species", True),
    ("breed", "text", "Breed", False),
    ("dob", "date", "Date of birth", False),
    ("weight_kg", "number", "Weight (kg)", False),
    ("vaccinated", "checkbox", "Vaccinations up to date?", True),
    ("allergies", "longtext", "Allergies or skin conditions", False),
    ("behaviour", "multiselect", "Behaviour notes", False),
    ("vet_name", "text", "Veterinarian", False),
    ("emergency_phone", "phone", "Emergency contact", True),
    ("owner_email", "email", "Your email", True),
    ("home_address", "address", "Home address", False),
    ("preferred_time", "time", "Preferred drop-off time", False),
    ("grooming_budget", "currency", "Typical grooming budget", False),
    ("vax_record", "file", "Vaccination record (PDF)", False),
    ("photo", "image", "A recent photo", False),
    (
        "matting_consent",
        "signature",
        "I consent to humane de-matting / shave-downs if required",
        True,
    ),
]


REVIEWS = [
    (
        "cl_amelie",
        "bk_000",
        5,
        "Bella always comes home so soft and happy. Hannah is endlessly patient with her dryer anxiety.",
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
    """Fill the remaining gaps so the demo exercises every surface, apart from the verticals above."""

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
            resource_id="rs_station_b",
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
                custom_fields={"class": "puppy_social"},
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
            resource_id="rs_station_a",
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
            staff_id="st_diego",
            client_id="cl_olivia",
            subject_id="sj_bandit",
            status="completed",
            source="manual",
            price_cents=7500,
            confirmed_at=at(-10, 12),
            completed_at=at(-9, 15),
            invoice_id="inv_1099",
            custom_fields={},
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
            description="Cat Groom ×2",
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
            current_period_start=at(-40, 0),
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
            current_period_start=at(-8, 0),
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

    rows.append(
        PaymentMethod(
            id="pm_amelie_interac",
            business_id=BIZ,
            client_id="cl_amelie",
            method="interac",
            provider="interac",
            preferred=False,
            mandate_status="none",
            status="active",
        )
    )
    rows.append(
        Thread(
            id="th_chat",
            business_id=BIZ,
            client_id="cl_sophie",
            channel="chat",
            status="open",
        )
    )
    rows.append(
        Message(
            id="msg_chat",
            business_id=BIZ,
            thread_id="th_chat",
            direction="in",
            channel="chat",
            body="Hi! Does Mochi need a bath before the puppy class?",
            status="read",
        )
    )

    rows.append(
        Review(
            id="rv_low",
            submitted_at=at(-7, 18),
            business_id=BIZ,
            client_id="cl_david",
            booking_id="bk_008",
            rating=2,
            body="Groom was fine but I waited 20 minutes past my slot.",
            response="So sorry about the wait, David — we've adjusted the schedule.",
            responded_at=at(-6, 10),
            sent_to_google=False,
            status="published",
        )
    )
    rows.append(
        Review(
            id="rv_hidden",
            submitted_at=at(-5, 18),
            business_id=BIZ,
            client_id="cl_olivia",
            booking_id="bk_refund",
            rating=1,
            body="[flagged as spam]",
            response=None,
            responded_at=None,
            sent_to_google=False,
            status="hidden",
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
    Addon,
    Message,
    Line,
    StockMovement,
    Payment,
    Review,
    File,
    Audit,
    Webhook,
]


FILLER_ITEMS = ["it_groom_sm", "it_bath", "it_nails", "it_deshed", "it_cat"]
FILLER_STAFF = {"st_owner": "rs_station_a", "st_diego": "rs_station_b", "st_priya": "rs_bath"}


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
    busy = [
        (r.staff_id, r.resource_id, r.starts_at, r.ends_at) for r in rows if isinstance(r, Slot)
    ]
    n = 0
    for d in range(-120, 31):
        for member, resource in FILLER_STAFF.items():
            hours = _working_hours(member, at(d).astimezone(NOW.tzinfo).date())
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
                            (staff == member or res == resource)
                            and start < e
                            and b < start + timedelta(minutes=dur)
                            for staff, res, b, e in busy
                        )
                    ),
                    None,
                )
                if slot is None:
                    continue
                start, end = slot
                busy.append((member, resource, start, end))
                client, pet = rng.choice(pairs)
                done = end < NOW
                status = "completed" if done else "pending" if rng.random() < 0.2 else "confirmed"
                ses, bk = f"ses_f{n:03d}", f"bk_f{n:03d}"
                n += 1
                rows.append(
                    Slot(
                        id=ses,
                        business_id=BIZ,
                        item_id=item_id,
                        staff_id=member,
                        resource_id=resource,
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
                        staff_id=member,
                        client_id=client,
                        subject_id=pet,
                        status=status,
                        source="online" if n % 3 == 0 else "manual",
                        manage_token=f"manage_{bk}" if n % 3 == 0 else None,
                        price_cents=price,
                        deposit_amount_cents=0,
                        confirmed_at=start - timedelta(days=1) if status != "pending" else None,
                        completed_at=end if done else None,
                    )
                )
                if done:
                    _invoice_for(n, client, bk, item_id, price, dur, tax, member, d, settled=True)


SERIES_VISITS = 8
DISPUTED = "pay_1006"


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
    first = next(d for d in range(-21, -14) if at(d).astimezone(NOW.tzinfo).weekday() == 2)
    for n in range(SERIES_VISITS):
        d = first + 14 * n
        start = at(d, 15)
        end = start + timedelta(minutes=dur)
        done = end < NOW
        ses, bk = f"ses_s{n}", f"bk_s{n}"
        rows.append(
            Slot(
                id=ses,
                business_id=BIZ,
                item_id="it_groom_sm",
                staff_id="st_owner",
                resource_id="rs_station_a",
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


def build_demo(as_of: datetime | None = None) -> DemoContext:
    global NOW, rows
    if as_of is not None:
        if as_of.tzinfo is None:
            raise ValueError("--as-of must include a timezone offset")
        NOW = as_of.astimezone(ZoneInfo("America/Vancouver"))
    rows = []
    EARNING_STAGE.clear()
    INV_SEQ[0] = 1000
    owner, _ = seed_identity()
    seed_items(owner)
    seed_clients(owner)
    seed_resources_hours()
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
    seed_calendar_filler()
    seed_dispute()
    ctx = DemoContext(NOW, BIZ, owner, rows)
    add_scenarios(ctx)
    add_finance_scenarios(ctx)
    build_calendar(ctx)
    prepare_finance(ctx)
    rows[:] = [r for r in rows if not isinstance(r, (Thread, Message, Review))]
    build_identity(ctx)
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
                "as_of": NOW.isoformat(),
            },
            created_at=NOW,
        )
    )
    errors = validate_graph(ctx) + chronology_errors(ctx)
    if errors:
        raise ValueError("Invalid demo graph: " + "; ".join(errors[:20]))
    return ctx


def validate_seed_target(reset_demo: bool) -> None:
    settings = get_settings()
    url = make_url(settings.database_url)
    if settings.env != "dev" or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Demo seeding requires ENV=dev and a localhost database.")
    if url.database != "clientbridge" and not (url.database or "").startswith("clientbridge_test"):
        raise SystemExit(
            "Seed the local clientbridge database or an isolated clientbridge_test database."
        )


async def replace_demo_rows(session: AsyncSession, ctx: DemoContext) -> None:
    business_ids = [row.id for row in ctx.all(Business)]
    user_ids = [row.id for row in ctx.all(User)]
    shared_users = await session.scalar(
        select(Staff.id).where(Staff.user_id.in_(user_ids), Staff.business_id.not_in(business_ids))
    )
    if shared_users is not None:
        raise ValueError("Seeded users belong to another business; refusing to replace them")
    await session.execute(
        update(Payment).where(Payment.business_id.in_(business_ids)).values(booking_id=None)
    )
    # The table lock and trigger change last only through this local seed transaction.
    await session.execute(text("ALTER TABLE entries DISABLE TRIGGER entries_append_only"))
    for table in reversed(Base.metadata.sorted_tables):
        if "business_id" in table.c:
            condition = table.c.business_id.in_(business_ids)
        elif table.name == "businesses":
            condition = table.c.id.in_(business_ids)
        elif table.name == "users":
            condition = table.c.id.in_(user_ids)
        elif table.name in {"sessions", "tokens"}:
            condition = table.c.user_id.in_(user_ids)
        else:
            continue
        await session.execute(delete(table).where(condition))
    await session.execute(text("ALTER TABLE entries ENABLE TRIGGER entries_append_only"))


async def main(*, reset_demo: bool = False, as_of: datetime | None = None) -> None:
    validate_seed_target(reset_demo)
    ctx = build_demo(as_of)
    upload_demo_assets()
    async with SessionLocal() as session:
        business_ids = [row.id for row in ctx.all(Business)]
        exists = await session.scalar(select(Business.id).where(Business.id.in_(business_ids)))
        if exists and not reset_demo:
            print("Demo accounts already exist; use --reset-demo to refresh only those accounts.")
            return
        await replace_demo_rows(session, ctx)
        for cls in INSERT_ORDER:
            batch = [r for r in rows if type(r) is cls]
            if batch:
                session.add_all(batch)
                await session.flush()
        await seed_finance(session, ctx)
        await session.flush()
        report = await validate_database(session, as_of=ctx.now)
        if not report["ok"]:
            raise ValueError(f"Demo validation failed: {report['errors']}")
        await session.commit()
    await engine.dispose()
    print(f"Seeded {len(ctx.rows)} rows; demo {DEMO_VERSION}, as of {NOW.isoformat()}.")


def upload_demo_assets() -> None:
    """Upload and verify every demo asset before replacing any database rows."""
    s = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        config=BotoConfig(connect_timeout=2, retries={"max_attempts": 1}),
    )
    try:
        if s.s3_bucket not in {b["Name"] for b in client.list_buckets().get("Buckets", [])}:
            client.create_bucket(Bucket=s.s3_bucket)
        for asset in (r for r in rows if isinstance(r, File)):
            path = ASSETS / Path(asset.s3_key).name
            if not path.is_file() or path.stat().st_size != asset.size:
                raise ValueError(f"Missing or mismatched demo asset: {asset.id}")
            client.upload_file(
                str(path),
                s.s3_bucket,
                asset.s3_key,
                ExtraArgs={"ContentType": asset.content_type},
            )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError("Demo asset upload failed; database was not reset") from exc


async def refresh_demo_avatar() -> None:
    path = ASSETS / "logo-mark.png"
    key = f"{BIZ}/demo/{path.name}"
    async with SessionLocal() as db:
        business = await db.get(Business, BIZ)
        if business is None or business.brand.get("logo_file_id") != "fl_logo":
            raise SystemExit("The original demo brand is not present; no changes made.")
        async with httpx.AsyncClient() as client:
            response = await client.put(
                get_file_storage().presign_upload(key, "image/png"),
                content=path.read_bytes(),
                headers={"Content-Type": "image/png"},
            )
            response.raise_for_status()
        avatar = await db.get(File, "fl_logo_avatar")
        if avatar is None:
            db.add(
                File(
                    id="fl_logo_avatar",
                    business_id=BIZ,
                    parent_type="business",
                    parent_id=BIZ,
                    purpose="logo",
                    s3_key=key,
                    content_type="image/png",
                    size=path.stat().st_size,
                )
            )
            await db.flush()
        business.brand = {**business.brand, "avatar_file_id": "fl_logo_avatar"}
        await db.commit()
    await engine.dispose()
    print("Updated the demo avatar; all other demo data was preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-demo-avatar", action="store_true")
    parser.add_argument("--reset-demo", action="store_true")
    parser.add_argument("--as-of", type=datetime.fromisoformat)
    args = parser.parse_args()
    asyncio.run(
        refresh_demo_avatar()
        if args.refresh_demo_avatar
        else main(reset_demo=args.reset_demo, as_of=args.as_of)
    )
