"""Seed a comprehensive, realistic demo business for local QA + demos.

**Birchbark Pet Studio** — a pet grooming & daycare business in Victoria, BC. Owner = the dev user
(`dev_user_id`), so the mobile/web apps stream this business's data via the dev sync token.

Populates all 37 tables with realistic data, real copy, and stock photos (pravatar for people,
picsum for pets/products). Idempotent: TRUNCATEs every table, then re-inserts.

Run: ``make seed``  (= ``uv run python -m scripts.seed_demo``). Requires the DB migrated.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import Base, SessionLocal, engine
from clientbridge.core.security import hash_password
from clientbridge.models.billing import Estimate, Invoice, Line, TaxRate
from clientbridge.models.catalog import GiftCard, Item, Package, Subscription
from clientbridge.models.crm import Client, Note, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod, Payout, PayoutAllocation
from clientbridge.models.platform import AuditLog, File, WebhookEvent
from clientbridge.models.reviews import Review, ReviewRequest
from clientbridge.models.scheduling import Availability, Booking, Resource, Schedule, Session

NOW = datetime.now().astimezone()  # local-tz aware, so demo hours land in the viewer's local day
BIZ = "bz_birchbark"
DEMO_PASSWORD = "demo1234"  # every seeded user logs in with this
rows: list[object] = []


def at(days_offset: float, hour: int = 9, minute: int = 0) -> datetime:
    """A local business-hour timestamp relative to now, stored as UTC, so demo times read sensibly."""
    return (
        (NOW + timedelta(days=days_offset))
        .replace(hour=hour, minute=minute, second=0, microsecond=0)
        .astimezone(UTC)
    )


def face(seed: str) -> str:
    return f"https://i.pravatar.cc/300?u={seed}"


def pic(seed: str) -> str:
    return f"https://picsum.photos/seed/{seed}/640/480"


# ─────────────────────────────────────────── identity ───────────────────────────────────────────
def seed_identity() -> tuple[str, str]:
    owner_id = get_settings().dev_user_id  # = us_dev → matches the dev sync token
    rows.append(
        Business(
            id=BIZ,
            name="Birchbark Pet Studio",
            slug="birchbark",
            locale="en",
            timezone="America/Vancouver",
            province="BC",
            gst_hst_number="84720 1539 RT0001",
            is_tax_registered=True,
            brand={
                "logo_url": pic("birchbark-logo"),
                "primary": "#3F5E80",
                "tagline": "Calm, careful grooming on Vancouver Island.",
            },
            plan="pro",
            billing_email="hello@birchbarkpets.ca",
            stripe_customer_id="cus_demo_birchbark",
            stripe_account_id="acct_demo_birchbark",
            payout_schedule="weekly",
            status="active",
        )
    )
    rows.append(
        User(
            id=owner_id,
            email="hannah@birchbarkpets.ca",
            name="Hannah Wong",
            phone="+12505550110",
            avatar_url=face("hannah"),
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
            avatar_url=face("diego"),
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
            avatar_url=face("priya"),
            password_hash=hash_password(DEMO_PASSWORD),
            oauth={},
        )
    )
    rows.append(
        Staff(
            id="st_owner",
            business_id=BIZ,
            user_id=owner_id,
            role="owner",
            is_payee=True,
            payout_ref="acct_demo_hannah",
            default_rate=1.0,
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
            role="staff",
            is_payee=True,
            payout_ref="acct_demo_diego",
            default_rate=0.45,
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
            role="staff",
            is_payee=False,
            default_rate=22.0,
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
            invite_token="inv_tok_sam",
            title="Groomer (trial)",
            color="#6E757E",
        )
    )
    return owner_id, "st_diego"


# ─────────────────────────────────────────── tax + catalog ──────────────────────────────────────
GST = "tx_gst"
PST = "tx_pst_bc"


def seed_tax() -> None:
    rows.append(
        TaxRate(
            id=GST, business_id=None, jurisdiction="GST", province="BC", rate_bps=500, name="GST 5%"
        )
    )
    rows.append(
        TaxRate(
            id=PST,
            business_id=None,
            jurisdiction="PST",
            province="BC",
            rate_bps=700,
            name="PST (BC) 7%",
        )
    )


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


def seed_items(owner: str) -> None:
    for iid, kind, name, price, dur, cap, tax, cat, desc in ITEMS:
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
                duration_min=dur,
                capacity=cap,
                tax_rate_id=tax,
                category=cat,
                color="#3F5E80",
                online_bookable=kind in {"service", "class"},
                buffer_before_min=0,
                buffer_after_min=10 if kind == "service" else 0,
                deposit_type="percent" if kind == "service" and price >= 10000 else "none",
                deposit_value=25 if kind == "service" and price >= 10000 else None,
                interval=1 if kind == "subscription" else None,
                frequency="monthly" if kind == "subscription" else None,
                session_count=5 if iid == "it_pkg5" else None,
                validity_days=365 if iid == "it_pkg5" else None,
                active=True,
                custom_fields={"image_url": pic(iid)},
            )
        )


# ─────────────────────────────────────────── clients + pets ─────────────────────────────────────
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
    for cid, name, email, phone, tags, ltv, seed, status, pets, note in CLIENTS:
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
                lifetime_value_cents=ltv * 100,
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
                        "photo_url": pic(pseed),
                    },
                )
            )
            rows.append(
                File(
                    id=f"fl_{pid}",
                    business_id=BIZ,
                    parent_type="subject",
                    parent_id=pid,
                    kind="photo",
                    s3_key=pic(pseed),
                    content_type="image/jpeg",
                    size=184320,
                )
            )
        if note:
            rows.append(
                Note(
                    id=f"nt_{cid}",
                    business_id=BIZ,
                    author_user_id=owner,
                    parent_type="client",
                    parent_id=cid,
                    body=note,
                    pinned="anxious" in note or "muzzle" in note or "breathing" in note,
                )
            )


# ─────────────────────────────────────────── resources + availability ───────────────────────────
def seed_resources_availability() -> None:
    rows.append(
        Resource(id="rs_station_a", business_id=BIZ, name="Grooming Station A", kind="equipment")
    )
    rows.append(
        Resource(id="rs_station_b", business_id=BIZ, name="Grooming Station B", kind="equipment")
    )
    rows.append(Resource(id="rs_bath", business_id=BIZ, name="Bath Bay", kind="room"))
    # recurring weekly hours Tue–Sat 9–17 for both groomers
    for member in ("st_owner", "st_diego"):
        for weekday in (1, 2, 3, 4, 5):  # Tue..Sat
            rows.append(
                Availability(
                    id=f"av_{member}_{weekday}",
                    business_id=BIZ,
                    staff_id=member,
                    type="recurring",
                    weekday=weekday,
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    is_available=True,
                )
            )
    # a stat-holiday closure + an extra-open Sunday
    rows.append(
        Availability(
            id="av_holiday",
            business_id=BIZ,
            staff_id="st_owner",
            type="date",
            date=at(12).date(),
            is_available=False,
            note="BC Day — closed",
        )
    )
    rows.append(
        Availability(
            id="av_extra",
            business_id=BIZ,
            staff_id="st_diego",
            type="date",
            date=at(9).date(),
            start_time=time(10, 0),
            end_time=time(14, 0),
            is_available=True,
            note="Extra Sunday for holiday rush",
        )
    )
    # a recurring puppy class schedule
    rows.append(
        Schedule(
            id="sch_puppy",
            business_id=BIZ,
            item_id="it_puppy",
            staff_id="st_owner",
            frequency="weekly",
            interval=1,
            byday=["SA"],
            start_date=at(-30).date(),
            until=at(60).date(),
            status="active",
        )
    )


# ─────────────────── appointments → sessions, bookings, invoices, payments, payouts ──────────────
# Each tuple drives a coherent slice across many tables.
# (day_offset, hour, item, member, client, pet, status)  status: completed|confirmed|pending|canceled|no_show
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
            Session(
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
                booked_count=0 if status in {"canceled"} else 1,
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
                session_id=ses,
                staff_id=member,  # denormalized from the session — drives per-member sync
                client_id=client,
                subject_id=pet,
                status=status,
                source="online" if i % 3 == 0 else "manual",
                price_cents=price,
                deposit_required=price >= 10000,
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
) -> None:
    INV_SEQ[0] += 1
    num = INV_SEQ[0]
    inv = f"inv_{num}"
    rate = 500 if tax == GST else 700
    tax_amt = round(price * rate / 10000)
    total = price + tax_amt
    # mix of paid / partial / overdue across history
    paid = i % 5 != 4
    partial = i % 5 == 2
    amount_paid = total if paid and not partial else (round(total * 0.25) if partial else 0)
    status = "paid" if amount_paid >= total else "partial" if amount_paid > 0 else "overdue"
    rows.append(
        Invoice(
            id=inv,
            business_id=BIZ,
            client_id=client,
            number=num,
            status=status,
            currency="CAD",
            subtotal_cents=price,
            tax_total_cents=tax_amt,
            total_cents=total,
            amount_paid_cents=amount_paid,
            balance_cents=total - amount_paid,
            issued_at=at(d, 17),
            due_at=at(d + 14, 17),
            paid_at=at(d, 18) if status == "paid" else None,
            notes="Thanks for trusting us with your pup! 🐾",
        )
    )
    rows.append(
        Line(
            id=f"ln_{num}_1",
            business_id=BIZ,
            parent_type="invoice",
            parent_id=inv,
            description=next(x[2] for x in ITEMS if x[0] == item_id),
            item_id=item_id,
            booking_id=bk,
            quantity=1,
            unit_amount_cents=price,
            amount_cents=price,
            tax_rate_id=tax,
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
        fee = round(amount_paid * 0.029) + 30 if method == "card" else 0
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
                fee_cents=fee,
                net_cents=amount_paid - fee,
                status="succeeded",
                paid_at=at(d, 18),
            )
        )
        # staff payout allocation (groomer's cut) for the groomers
        if member in {"st_owner", "st_diego"}:
            cut = 1.0 if member == "st_owner" else 0.45
            rows.append(
                PayoutAllocation(
                    id=f"pal_{num}",
                    business_id=BIZ,
                    staff_id=member,
                    source_type="booking",
                    source_id=bk,
                    basis="percent",
                    rate=cut,
                    amount_cents=round(price * cut),
                    status="paid" if d < -7 else "approved",
                    payout_id="po_w1" if d < -7 else None,
                )
            )


# ─────────────────────────────────────────── catalog instances ──────────────────────────────────
def seed_catalog_instances() -> None:
    rows.append(
        Package(
            id="pkg_marcus",
            business_id=BIZ,
            client_id="cl_marcus",
            item_id="it_pkg5",
            sessions_total=5,
            sessions_used=2,
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
            sessions_used=5,
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
            balance_cents=10000,
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
            balance_cents=0,
            purchaser_client_id="cl_david",
            status="redeemed",
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
                type="card",
                brand=brand,
                last4=last4,
                provider="stripe",
                provider_ref=f"pm_demo_{last4}",
                is_default=True,
                mandate_status="none",
                status="active",
            )
        )
    rows.append(
        PaymentMethod(
            id="pm_david_bank",
            business_id=BIZ,
            client_id="cl_david",
            type="bank_eft",
            brand="RBC",
            last4="6677",
            provider="stripe",
            mandate_status="active",
            is_default=False,
            status="active",
        )
    )


def seed_payouts() -> None:
    rows.append(
        Payout(
            id="po_w1",
            business_id=BIZ,
            amount_cents=84200,
            status="paid",
            arrival_at=at(-7, 0),
            provider_ref="po_demo_w1",
            bank_last4="2244",
        )
    )
    rows.append(
        Payout(
            id="po_w2",
            business_id=BIZ,
            amount_cents=61500,
            status="in_transit",
            arrival_at=at(2, 0),
            provider_ref="po_demo_w2",
            bank_last4="2244",
        )
    )
    rows.append(
        Payout(
            id="po_w0",
            business_id=BIZ,
            amount_cents=72100,
            status="paid",
            arrival_at=at(-14, 0),
            provider_ref="po_demo_w0",
            bank_last4="2244",
        )
    )


# ─────────────────────────────────────────── estimates ──────────────────────────────────────────
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
            parent_type="estimate",
            parent_id="est_1001",
            description="Full Groom — Small Dog ×3",
            item_id="it_groom_sm",
            quantity=3,
            unit_amount_cents=7500,
            amount_cents=22500,
            tax_rate_id=GST,
            tax_amount_cents=1125,
            position=0,
        )
    )
    rows.append(
        Line(
            id="ln_est_2",
            business_id=BIZ,
            parent_type="estimate",
            parent_id="est_1001",
            description="De-shedding add-on ×1",
            item_id="it_deshed",
            quantity=1,
            unit_amount_cents=6000,
            amount_cents=6000,
            tax_rate_id=GST,
            tax_amount_cents=300,
            position=1,
        )
    )
    rows.append(
        Line(
            id="ln_est_3",
            business_id=BIZ,
            parent_type="estimate",
            parent_id="est_1001",
            description="Take-home Oatmeal Shampoo ×1",
            item_id="it_shampoo",
            quantity=1,
            unit_amount_cents=2400,
            amount_cents=2400,
            tax_rate_id=PST,
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


# ─────────────────────────────────────────── messaging ──────────────────────────────────────────
def seed_messaging(owner: str) -> None:
    # each message = (direction, body, status, day_offset, hour, minute)
    convos: list[tuple[str, str, str, list[tuple[str, str, str, int, int, int]]]] = [
        (
            "th_amelie",
            "cl_amelie",
            "sms",
            [
                (
                    "out",
                    "Hi Amélie! Bella's all set for tomorrow at 10am. Reply C to confirm 🐾",
                    "delivered",
                    -1,
                    9,
                    0,
                ),
                ("in", "C — thank you! Will she be done by noon?", "read", -1, 9, 14),
                (
                    "out",
                    "Yep, around 11:30. We'll text when she's ready for pickup.",
                    "delivered",
                    -1,
                    9,
                    20,
                ),
            ],
        ),
        (
            "th_marcus",
            "cl_marcus",
            "sms",
            [
                (
                    "out",
                    "Rex & Luna are looking sharp ✂️ Ready for pickup whenever!",
                    "read",
                    -26,
                    13,
                    0,
                ),
                ("in", "On my way, thanks Diego!", "read", -26, 13, 30),
            ],
        ),
        (
            "th_david",
            "cl_david",
            "sms",
            [
                (
                    "out",
                    "Zeus had a great daycare day — napped hard after fetch 😅",
                    "delivered",
                    -1,
                    16,
                    0,
                ),
            ],
        ),
        (
            "th_sophie",
            "cl_sophie",
            "email",
            [
                (
                    "in",
                    "Hi! Do you have anything for Mochi (Shih Tzu) this week?",
                    "read",
                    -11,
                    8,
                    0,
                ),
                (
                    "out",
                    "We do! Thursday 10am works — I've pencilled Mochi in. Sound good?",
                    "read",
                    -11,
                    9,
                    0,
                ),
                ("in", "Perfect, see you then 🙂", "read", -11, 10, 0),
            ],
        ),
        (
            "th_olivia",
            "cl_olivia",
            "sms",
            [
                (
                    "out",
                    "Hi Olivia — we miss Bandit! Here's 15% off your next groom: BANDIT15",
                    "sent",
                    -1,
                    11,
                    0,
                ),
            ],
        ),
    ]
    for tid, client, channel, msgs in convos:
        last = msgs[-1]
        rows.append(
            Thread(
                id=tid,
                business_id=BIZ,
                client_id=client,
                channel=channel,
                last_message_at=at(last[3], last[4], last[5]),
                unread_count=sum(1 for m in msgs if m[0] == "in" and m[2] != "read"),
                status="open",
            )
        )
        for j, m in enumerate(msgs):
            rows.append(
                Message(
                    id=f"msg_{tid}_{j}",
                    business_id=BIZ,
                    thread_id=tid,
                    direction=m[0],
                    channel=channel,
                    sender_user_id=owner if m[0] == "out" else None,
                    body=m[1],
                    status=m[2],
                    attachments=[],
                    provider_ref=f"sm_demo_{tid}_{j}",
                )
            )
    rows.append(
        Broadcast(
            id="bro_holiday",
            business_id=BIZ,
            created_by=owner,
            name="Holiday hours 2025",
            channel="email",
            audience={"segment": "all_active"},
            status="sent",
            scheduled_at=at(-20, 9),
        )
    )
    rows.append(
        Broadcast(
            id="bro_deshed",
            business_id=BIZ,
            created_by=owner,
            name="Spring de-shedding — 15% off",
            channel="sms",
            audience={"tags": ["regular", "vip"]},
            status="sent",
            scheduled_at=at(-9, 10),
        )
    )
    rows.append(
        Broadcast(
            id="bro_winback",
            business_id=BIZ,
            created_by=owner,
            name="We miss you — win-back",
            channel="sms",
            audience={"tags": ["churn-risk"]},
            status="scheduled",
            scheduled_at=at(1, 11),
        )
    )


# ─────────────────────────────────────────── documents ──────────────────────────────────────────
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
    ("photo", "image", "A recent photo", False),
    (
        "matting_consent",
        "signature",
        "I consent to humane de-matting / shave-downs if required",
        True,
    ),
]


def seed_documents(owner: str) -> None:
    rows.append(
        Form(
            id="frm_intake",
            business_id=BIZ,
            name="New Pet Intake",
            attach_to=["client", "booking"],
            require_signature=True,
            active=True,
        )
    )
    for pos, (fname, ftype, label, required) in enumerate(INTAKE_FIELDS):
        opts: list[str] = []
        if ftype == "select":
            opts = ["Dog", "Cat", "Other"]
        if ftype == "multiselect":
            opts = ["Anxious", "Reactive to dryers", "Dislikes nails", "Food motivated", "Friendly"]
        rows.append(
            FormField(
                id=f"ff_{fname}",
                business_id=BIZ,
                form_id="frm_intake",
                type=ftype,
                name=fname,
                label=label,
                required=required,
                options=opts,
                validation={},
                position=pos,
            )
        )
    rows.append(
        Form(
            id="frm_satisfaction",
            business_id=BIZ,
            name="Grooming Satisfaction",
            attach_to=["booking"],
            require_signature=False,
            active=True,
        )
    )
    rows.append(
        FormField(
            id="ff_rating",
            business_id=BIZ,
            form_id="frm_satisfaction",
            type="rating",
            name="rating",
            label="How did we do?",
            required=True,
            options=[],
            validation={},
            position=0,
        )
    )
    rows.append(
        FormField(
            id="ff_comments",
            business_id=BIZ,
            form_id="frm_satisfaction",
            type="longtext",
            name="comments",
            label="Anything we could do better?",
            required=False,
            options=[],
            validation={},
            position=1,
        )
    )
    # a few intake responses
    intakes = [
        ("cl_amelie", "sj_bella", "Bella", "Goldendoodle"),
        ("cl_sophie", "sj_mochi", "Mochi", "Shih Tzu"),
        ("cl_david", "sj_zeus", "Zeus", "Rottweiler"),
        ("cl_priscilla", "sj_kobe", "Kobe", "French Bulldog"),
    ]
    for k, (client, pet, pname, breed) in enumerate(intakes):
        rows.append(
            FormResponse(
                id=f"fr_intake_{k}",
                business_id=BIZ,
                form_id="frm_intake",
                client_id=client,
                parent_type="subject",
                parent_id=pet,
                status="submitted",
                submitted_at=at(-40 + k, 11),
                answers={
                    "pet_name": pname,
                    "species": "Dog",
                    "breed": breed,
                    "vaccinated": True,
                    "emergency_phone": "+12505550100",
                    "behaviour": ["Friendly"],
                },
            )
        )
    # contract + signatures
    rows.append(
        Contract(
            id="con_waiver",
            business_id=BIZ,
            name="Grooming Services Agreement & Waiver",
            version=2,
            always_require=True,
            active=True,
            body=(
                "I authorize Birchbark Pet Studio to groom my pet. I understand that severely "
                "matted coats may require a humane shave-down, and that grooming can occasionally "
                "expose pre-existing skin or health conditions. In an emergency I authorize "
                "Birchbark to seek veterinary care at my expense. Cancellations within 24 hours "
                "may incur a 50% fee."
            ),
        )
    )
    for k, (client, pet) in enumerate(
        [
            ("cl_amelie", "sj_bella"),
            ("cl_marcus", "sj_rex"),
            ("cl_david", "sj_zeus"),
            ("cl_sophie", "sj_mochi"),
            ("cl_priscilla", "sj_kobe"),
            ("cl_liam", "sj_maple"),
        ]
    ):
        rows.append(
            Signature(
                id=f"sig_{k}",
                business_id=BIZ,
                contract_id="con_waiver",
                client_id=client,
                parent_type="subject",
                parent_id=pet,
                signed_at=at(-45 + k * 3, 10),
                signature_image_id=None,
                signed_body="Grooming Services Agreement & Waiver (v2)",
                ip=f"24.84.{k}.{100 + k}",
                status="signed",
            )
        )


# ─────────────────────────────────────────── reviews ────────────────────────────────────────────
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


def seed_reviews(owner: str) -> None:
    for k, (client, bk, rating, body, to_google) in enumerate(REVIEWS):
        responded = rating <= 4
        rows.append(
            Review(
                id=f"rv_{k}",
                business_id=BIZ,
                client_id=client,
                booking_id=bk,
                rating=rating,
                body=body,
                response="Thank you so much — we'll look into the parking/wait!"
                if responded
                else None,
                responded_at=at(-15 + k, 12) if responded else None,
                sent_to_google=to_google,
                status="published",
            )
        )
        rows.append(
            ReviewRequest(
                id=f"rvr_{k}",
                business_id=BIZ,
                client_id=client,
                booking_id=bk,
                channel="sms",
                token=f"rev_tok_{k}",
                status="completed",
                sent_at=at(-16 + k, 18),
                reminder_count=0,
                review_id=f"rv_{k}",
            )
        )
    # a couple of pending requests with no review yet (standalone — not tied to a booking)
    for k, client in enumerate(["cl_ethan", "cl_priscilla"]):
        rows.append(
            ReviewRequest(
                id=f"rvr_p_{k}",
                business_id=BIZ,
                client_id=client,
                booking_id=None,
                channel="email",
                token=f"rev_tok_p_{k}",
                status="sent" if k == 0 else "opened",
                sent_at=at(-4 + k, 18),
                reminder_count=k,
            )
        )


# ─────────────────────────────────────────── platform ───────────────────────────────────────────
def seed_platform(owner: str) -> None:
    rows.append(
        AuditLog(
            id="aud_0",
            business_id=BIZ,
            actor_user_id=owner,
            action="invoice.paid",
            entity_type="invoice",
            entity_id="inv_1001",
            changes={"status": ["sent", "paid"]},
            created_at=at(-28, 18),
        )
    )
    rows.append(
        AuditLog(
            id="aud_1",
            business_id=BIZ,
            actor_user_id="us_diego",
            action="booking.completed",
            entity_type="booking",
            entity_id="bk_001",
            changes={"status": ["confirmed", "completed"]},
            created_at=at(-26, 14),
        )
    )
    rows.append(
        AuditLog(
            id="aud_2",
            business_id=BIZ,
            actor_user_id=owner,
            action="client.created",
            entity_type="client",
            entity_id="cl_sophie",
            changes={},
            created_at=at(-11, 9),
        )
    )
    rows.append(
        WebhookEvent(
            id="wh_0",
            provider="stripe",
            type="payment_intent.succeeded",
            payload={"id": "pi_demo_1001", "amount": 7875},
            status="processed",
            processed_at=at(-28, 18),
        )
    )
    rows.append(
        WebhookEvent(
            id="wh_1",
            provider="stripe",
            type="payout.paid",
            payload={"id": "po_demo_w1", "amount": 84200},
            status="processed",
            processed_at=at(-7, 1),
        )
    )
    rows.append(
        WebhookEvent(
            id="wh_2",
            provider="twilio",
            type="message.delivered",
            payload={"sid": "sm_demo", "status": "delivered"},
            status="processed",
            processed_at=at(-1, 9),
        )
    )


# FK dependency order — parents before children (models define no relationships, so the
# unit-of-work cannot order inserts itself).
INSERT_ORDER = [
    TaxRate,
    Business,
    User,
    Staff,
    Client,
    Item,
    Resource,
    Form,
    Contract,
    Broadcast,
    Payout,
    PaymentMethod,
    Subject,
    Note,
    Package,
    Subscription,
    GiftCard,
    Schedule,
    Availability,
    FormField,
    FormResponse,
    Signature,
    Thread,
    Estimate,
    Session,
    Invoice,
    Booking,
    Message,
    Line,
    Payment,
    PayoutAllocation,
    Review,
    ReviewRequest,
    File,
    AuditLog,
    WebhookEvent,
]


async def main() -> None:
    owner, _ = seed_identity()
    seed_tax()
    seed_items(owner)
    seed_clients(owner)
    seed_resources_availability()
    seed_catalog_instances()
    seed_payment_methods()
    seed_payouts()
    seed_appointments()
    seed_estimates()
    seed_messaging(owner)
    seed_documents(owner)
    seed_reviews(owner)
    seed_platform(owner)

    table_list = ", ".join(Base.metadata.tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE"))
    async with SessionLocal() as session:
        for cls in INSERT_ORDER:
            batch = [r for r in rows if type(r) is cls]
            if batch:
                session.add_all(batch)
                await session.flush()
        await session.commit()
    await engine.dispose()
    print(f"seeded {len(rows)} rows for 'Birchbark Pet Studio' (business {BIZ}, owner {owner})")


if __name__ == "__main__":
    asyncio.run(main())
