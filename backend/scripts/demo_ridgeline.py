"""Ridgeline Strength Studio: a three-coach training studio in Edmonton, on the demo engine."""

import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item, ItemKind, Package, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.documents import FormResponse
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
from scripts.demo_context import demo_business
from scripts.demo_engine import Demo, Quote
from scripts.demo_spec import (
    BusinessSpec,
    ContractSpec,
    DocField,
    FormSpec,
    Offering,
    Pacing,
    Person,
    Settle,
    Stage,
    Stock,
)

RIDGELINE = "bz_ridgeline"
RIDGELINE_OWNER = "us_rl_owner"

JENNA, MATEO, SIMRAN = "st_rl_owner", "st_rl_mateo", "st_rl_simran"
INTRO, PT30, PT60, ASSESSMENT = "it_rl_intro", "it_rl_pt30", "it_rl_pt60", "it_rl_assessment"
STRENGTH, MOBILITY, BOOTCAMP, SENIORS = (
    "it_rl_strength",
    "it_rl_mobility",
    "it_rl_bootcamp",
    "it_rl_seniors",
)
BOTTLE, BANDS, LOOPS = "it_rl_bottle", "it_rl_bands", "it_rl_loops"
UNLIMITED, EIGHT = "it_rl_unlimited", "it_rl_eight"
PT10, PASS10, GIFT = "it_rl_pt10", "it_rl_seniors_pass", "it_rl_gift"
PARQ, WAIVER, FEEDBACK = "frm_rl_parq", "frm_rl_waiver", "frm_rl_feedback"
MEMBERSHIP = "con_rl_membership"

WEEKDAYS_6_TO_2 = {d: (time(6, 0), time(14, 0)) for d in range(5)}
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    JENNA: {**WEEKDAYS_6_TO_2, 5: (time(8, 0), time(12, 0))},
    MATEO: {**{d: (time(11, 0), time(20, 0)) for d in range(5)}, 5: (time(9, 0), time(13, 0))},
    SIMRAN: {
        0: (time(9, 0), time(15, 0)),
        1: (time(10, 0), time(19, 0)),
        2: (time(9, 0), time(15, 0)),
        3: (time(10, 0), time(19, 0)),
        4: (time(9, 0), time(15, 0)),
    },
}
# item, coach, weekday (Monday is 0), start
TIMETABLE = (
    (STRENGTH, JENNA, 0, time(6, 0)),
    (STRENGTH, JENNA, 2, time(6, 0)),
    (STRENGTH, JENNA, 4, time(6, 0)),
    (BOOTCAMP, JENNA, 3, time(6, 0)),
    (BOOTCAMP, JENNA, 5, time(9, 0)),
    (SENIORS, SIMRAN, 0, time(10, 30)),
    (SENIORS, SIMRAN, 2, time(10, 30)),
    (MOBILITY, SIMRAN, 1, time(18, 0)),
    (MOBILITY, SIMRAN, 3, time(18, 0)),
    (STRENGTH, MATEO, 0, time(17, 30)),
    (STRENGTH, MATEO, 2, time(17, 30)),
)
CLASS_WEEKS = 30
# month -> share of a class's usual seats taken; January fills up, summer thins out
SEASON = {
    1: 1.2,
    2: 1.1,
    3: 1.05,
    4: 1.0,
    5: 0.95,
    6: 0.85,
    7: 0.75,
    8: 0.8,
    9: 1.05,
    10: 1.05,
    11: 1.0,
    12: 0.85,
}
USUAL_SEATS = {STRENGTH: 6, BOOTCAMP: 8, MOBILITY: 6, SENIORS: 6}

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        INTRO,
        "service",
        "Free intro session",
        0,
        45,
        "Personal training",
        "A first visit for new clients. We talk through your goals and any injuries, go over "
        "your health questionnaire, try a few movements together and suggest a plan that fits.",
    ),
    (
        PT30,
        "service",
        "Personal training, 30 minutes",
        6000,
        30,
        "Personal training",
        "A focused half hour with your coach on one or two lifts or a short conditioning "
        "block. Good between classes or on a lunch break.",
    ),
    (
        PT60,
        "service",
        "Personal training, 60 minutes",
        10000,
        60,
        "Personal training",
        "A full hour with your coach: warm-up, strength work planned around your goals, and "
        "notes on what to practise before the next session.",
    ),
    (
        ASSESSMENT,
        "service",
        "Movement assessment",
        8500,
        60,
        "Personal training",
        "We check how you squat, hinge, push, pull and balance, test grip strength and a short "
        "aerobic step test, then send you a written summary with a starting program.",
    ),
    (
        STRENGTH,
        "class",
        "Small group strength",
        3000,
        60,
        "Classes",
        "Barbell, dumbbell and kettlebell work in a group of up to eight, coached so everyone "
        "lifts at their own level. Drop-in price; unlimited and 8-class members book free.",
    ),
    (
        MOBILITY,
        "class",
        "Mobility",
        2200,
        45,
        "Classes",
        "Slow, guided stretching and joint work with foam rollers and bands, for stiff hips, "
        "backs and shoulders. Up to ten people. Drop-in price.",
    ),
    (
        BOOTCAMP,
        "class",
        "Bootcamp",
        2500,
        45,
        "Classes",
        "A circuit of skipping, carries, light weights and bodyweight work for up to twelve "
        "people. Every station has an easier and a harder option. Drop-in price.",
    ),
    (
        SENIORS,
        "class",
        "Strong seniors",
        1600,
        45,
        "Classes",
        "Strength and balance for adults over 60, with chairs and light dumbbells. Up to eight "
        "people, so the coach can check everyone's form. Drop-in price.",
    ),
    (
        BOTTLE,
        "product",
        "Insulated water bottle, 750 ml",
        2800,
        None,
        "Retail",
        "Stainless steel bottle with a bamboo lid. Keeps water cold through a long session.",
    ),
    (
        BANDS,
        "product",
        "Fabric resistance bands, set of 2",
        3200,
        None,
        "Retail",
        "Two non-slip fabric loop bands, medium and heavy, for glute and hip work at home.",
    ),
    (
        LOOPS,
        "product",
        "Mini loop bands, set of 4",
        1800,
        None,
        "Retail",
        "Four latex loops from light to extra heavy, the same ones we use in mobility class.",
    ),
    (
        UNLIMITED,
        "subscription",
        "Unlimited classes",
        18900,
        None,
        "Memberships",
        "Book any class on the timetable as often as you like, plus 10% off retail. Billed "
        "monthly to the card on file.",
    ),
    (
        EIGHT,
        "subscription",
        "8 classes a month",
        13900,
        None,
        "Memberships",
        "Eight classes in each billing month, for about two a week. Billed monthly to the card "
        "on file.",
    ),
    (
        PT10,
        "package",
        "10 personal training sessions",
        90000,
        None,
        "Packages",
        "Ten 60-minute sessions at $90 each instead of $100. Use them within six months.",
    ),
    (
        PASS10,
        "package",
        "Strong seniors 10-class pass",
        14000,
        None,
        "Packages",
        "Ten Strong seniors classes for the price of about eight and a half. Use them within "
        "six months.",
    ),
    (
        GIFT,
        "gift",
        "Gift card",
        0,
        None,
        "Gift cards",
        "Any amount, for classes, personal training or retail. It doesn't expire.",
    ),
)
COLORS = {
    INTRO: "#5E7391",
    PT30: "#B8663D",
    PT60: "#9C4221",
    ASSESSMENT: "#6B5B3E",
    STRENGTH: "#7A2E1A",
    MOBILITY: "#3F7A6B",
    BOOTCAMP: "#C27C2C",
    SENIORS: "#5B6C8F",
    UNLIMITED: "#9C4221",
    EIGHT: "#B8663D",
}
CAPACITY = {STRENGTH: 8, MOBILITY: 10, BOOTCAMP: 12, SENIORS: 8}
# on hand today, low-stock line, unit cost, SKU; the mini loops sit under their line
STOCK: dict[str, tuple[int, int, int, str]] = {
    BOTTLE: (14, 5, 1100, "RL-BTL-750"),
    BANDS: (9, 4, 1200, "RL-BND-FAB2"),
    LOOPS: (3, 4, 600, "RL-BND-LOOP4"),
}

PARQ_FIELDS: tuple[DocField, ...] = (
    ("date_of_birth", "date", "Date of birth", None, True, ()),
    ("emergency_name", "text", "Emergency contact name", None, True, ()),
    ("emergency_phone", "phone", "Emergency contact phone", None, True, ()),
    (
        "heart_condition",
        "select",
        "Has a doctor ever said you have a heart condition or high blood pressure?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "chest_pain",
        "select",
        "Do you feel pain in your chest at rest, during daily activities or when you exercise?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "dizziness",
        "select",
        "Have you lost balance because of dizziness, or lost consciousness, in the last 12 months?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "chronic_condition",
        "select",
        "Have you been diagnosed with another chronic medical condition, such as diabetes, "
        "asthma or arthritis?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "medications",
        "select",
        "Do you take prescribed medication for a chronic condition?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "joint_problem",
        "select",
        "Do you have a bone, joint or soft tissue problem that could get worse with more activity?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "supervised_only",
        "select",
        "Has a doctor said you should only do medically supervised physical activity?",
        None,
        True,
        ("Yes", "No"),
    ),
    (
        "details",
        "longtext",
        "If you answered yes to any question, tell us more",
        "Include what you've been told by your doctor or physiotherapist. A yes doesn't rule "
        "you out; we may ask for a note before your first class.",
        False,
        (),
    ),
    (
        "activity_level",
        "select",
        "How active are you now?",
        None,
        True,
        (
            "Mostly inactive",
            "Active once or twice a week",
            "Active three or more times a week",
        ),
    ),
    (
        "goals",
        "multiselect",
        "What would you like to work on?",
        None,
        False,
        (
            "Get stronger",
            "Move with less pain",
            "Lose weight",
            "Improve balance",
            "Train for a sport",
            "Build a routine",
        ),
    ),
    (
        "accurate",
        "checkbox",
        "My answers are true to the best of my knowledge, and I'll tell my coach if my health "
        "changes",
        None,
        True,
        (),
    ),
)
WAIVER_FIELDS: tuple[DocField, ...] = (
    (
        "risks",
        "checkbox",
        "I understand that exercise, including lifting weights, carries a risk of injury, and "
        "that I take part voluntarily",
        "Coaches will show you how to do each movement and offer an easier option. Stop and tell "
        "a coach if anything hurts or you feel unwell.",
        True,
        (),
    ),
    (
        "follow_instructions",
        "checkbox",
        "I'll follow my coach's instructions, use equipment as shown and work within my limits",
        None,
        True,
        (),
    ),
    (
        "release",
        "checkbox",
        "I release Ridgeline Strength Studio and its coaches from claims for injury that happens "
        "while I take part, except injury caused by their negligence",
        "This is demo text for a fictional business, not legal advice.",
        True,
        (),
    ),
    (
        "photos",
        "select",
        "May we post class photos that include you on our social media?",
        None,
        True,
        ("Yes", "Only if my face isn't shown", "No"),
    ),
    ("signed_on", "date", "Today's date", None, True, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your session?", None, True, ()),
    ("liked", "longtext", "What worked well?", None, False, ()),
    ("improve", "longtext", "What could we do better?", None, False, ()),
    (
        "recommend",
        "select",
        "Would you recommend us to a friend?",
        None,
        False,
        ("Yes", "Maybe", "No"),
    ),
)
MEMBERSHIP_BODY = "\n\n".join(
    (
        "This agreement covers your class membership at Ridgeline Strength Studio. It is demo "
        "text for a fictional business, not legal advice.",
        "What's included\nThe unlimited membership includes any class on the timetable. The 8 "
        "classes a month membership includes eight classes in each billing month; unused "
        "classes don't carry over. Personal training is booked and paid separately.",
        "Billing\nYour membership is charged to the card on file on the same date each month. "
        "If a charge fails, we'll let you know and try again over the next few days. You can "
        "keep booking while we sort it out.",
        "Booking and cancelling classes\nBook classes online or at the desk. Cancel at least 12 "
        "hours before a class so someone on the waitlist can take your spot. When a spot opens, "
        "the first person on the waitlist gets it and a text to let them know.",
        "Health\nYou've filled in the health questionnaire, and you'll tell your coach about any "
        "change in your health or a new injury before your next class.",
        "Cancelling\nYou can cancel at any time from the link in your receipt email "
        "or by asking at the desk, and the cancellation takes effect at the end of the month "
        "you've paid for. We don't refund part months.",
    )
)


@dataclass(frozen=True)
class Member:
    key: str
    name: str
    since: int
    group: str
    photo: bool = False


# group: unlimited, eight, seniors (pass), pt (personal training), drop (occasional drop-in)
PEOPLE = (
    Member("hailey", "Hailey Bouchard", -3, "lead", True),
    Member("ben", "Ben Tran", -260, "unlimited", True),
    Member("kyle", "Kyle Lambert", -170, "eight"),
    Member("grace", "Grace Okonkwo", -150, "pt", True),
    Member("farah", "Farah Siddiqui", -120, "eight", True),
    Member("devon", "Devon Hrycyk", -90, "drop"),
    Member("lucy", "Lucy Zhang", -140, "drop"),
    Member("omar", "Omar Abdi", -110, "pt", True),
    Member("linh", "Linh Pham", -75, "pt", True),
    Member("carmen", "Carmen Ortega", -230, "unlimited"),
    Member("walter", "Walter Bilodeau", -240, "seniors", True),
    Member("anita", "Anita Desai", -45, "drop"),
    Member("raj", "Raj Malhotra", -200, "pt", True),
    Member("elaine", "Elaine Fraser", -280, "seniors", True),
    Member("jordan", "Jordan Cardinal", -130, "pt", True),
    Member("natalia", "Natalia Petrenko", -250, "pt", True),
    Member("aidan", "Aidan Moore", -100, "pt"),
    Member("sophie", "Sophie Gagné", -160, "pt"),
    Member("marisol", "Marisol Reyes", -210, "unlimited"),
    Member("tom", "Tomasz Wiśniewski", -180, "eight", True),
    Member("priyanka", "Priyanka Nair", -320, "unlimited"),
    Member("hassan", "Hassan El-Masri", -225, "pt"),
    Member("yuna", "Yuna Park", -95, "eight", True),
    Member("kwame", "Kwame Mensah", -60, "drop"),
    Member("dale", "Dale Sorensen", -300, "seniors"),
    Member("lorraine", "Lorraine Laboucan", -220, "seniors"),
    Member("ahmed", "Ahmed Warsame", -80, "drop"),
    Member("jasleen", "Jasleen Dhillon", -250, "unlimited", True),
    Member("kevin", "Kevin Liu", -210, "pt"),
    Member("rachel", "Rachel Friesen", -170, "drop"),
    Member("bilal", "Bilal Qureshi", -120, "pt"),
    Member("tanya", "Tanya Melnyk", -230, "eight"),
    Member("luis", "Luis Herrera", -65, "drop"),
    Member("chloe", "Chloé Gauthier", -130, "eight", True),
    Member("isaac", "Isaac Yohannes", -55, "drop"),
    Member("megan", "Megan O'Brien", -230, "pt"),
    Member("vikram", "Vikram Rao", -175, "unlimited", True),
    Member("joy", "Joy Dela Cruz", -240, "unlimited", True),
    Member("noah", "Noah Wiebe", -40, "drop"),
    Member("fatuma", "Fatuma Hassan", -105, "drop"),
    Member("brent", "Brent Kowalski", -260, "pt"),
    Member("helen", "Helen Ma", -260, "seniors", True),
    Member("george", "George Papadopoulos", -150, "seniors"),
    Member("nicole", "Nicole Gauthier", -85, "drop"),
    Member("daniel", "Daniel Kim", -215, "unlimited", True),
    Member("samira", "Samira Khoury", -125, "eight"),
    Member("ethan", "Ethan Lavallee", -70, "drop"),
    Member("olena", "Olena Shevchenko", -205, "eight", True),
    Member("andres", "Andrés Castillo", -115, "pt"),
    Member("amy", "Amy Nguyen", -50, "drop"),
    Member("patrick", "Patrick Courtorielle", -145, "drop"),
    Member("deepa", "Deepa Raman", -240, "pt"),
    Member("jake", "Jake Henderson", -30, "drop"),
    Member("mariam", "Mariam Hassan", -90, "drop"),
    Member("colleen", "Colleen MacDonald", -330, "seniors"),
    Member("paolo", "Paolo Mendoza", -160, "unlimited"),
    Member("leah", "Leah Steinberg", -100, "pt"),
    Member("yusuf", "Yusuf Demir", -35, "drop"),
    Member("brianna", "Brianna Whitford", -20, "drop"),
    Member("wei", "Wei Chen", -270, "unlimited", True),
    Member("kristin", "Kristin Olsen", -140, "drop"),
    Member("hamza", "Hamza Ali", -60, "pt"),
    Member("rosa", "Rosa Marchetti", -290, "seniors", True),
    Member("cody", "Cody Bearhead", -25, "drop"),
)
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "cash", "etransfer", "card", "card")
CANCELED_AT = -32  # Carmen's unlimited membership ends; she's moving to Calgary


def _ascii(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()


def _email(name: str) -> str:
    first, last = name.split(" ", 1)
    return f"{_ascii(first)}.{_ascii(last).replace(' ', '').replace(chr(39), '')}@example.test"


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="exempt" if kind == "gift" else "standard",
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=kind in {"service", "class"},
        sell_online=kind == "product",
        capacity=CAPACITY.get(item_id),
        buffer_after_min=15 if kind == "class" else 10 if kind == "service" else 0,
        frequency="month" if kind == "subscription" else None,
        sku=stock[3] if stock else None,
        cost_cents=stock[2] if stock else None,
        stock=Stock(stock[0], stock[1]) if stock else None,
        sessions=10 if kind == "package" else None,
        covers={PT10: PT60, PASS10: SENIORS}.get(item_id),
        validity_days=180 if kind == "package" else None,
        ref={UNLIMITED: "unlimited", EIGHT: "eight", PASS10: "seniors"}.get(item_id),
        visits_per_period=8 if item_id == EIGHT else None,
        member_discount_bps=1000 if item_id == UNLIMITED else None,
        contract=MEMBERSHIP if kind == "subscription" else None,
    )


GROUPS = {member.key: member.group for member in PEOPLE}
LONG_TIME = -200  # members who joined before this day had their intro before the seeded history
FILL_CLIENTS = tuple(m.key for m in PEOPLE if m.group == "pt" and m.since < -215)
PT_REGULARS = ("omar", "linh", "jordan", "aidan", "sophie", "bilal", "andres", "leah", "hamza")

SPEC = BusinessSpec(
    listing=demo_business(RIDGELINE),
    code="rl",
    slug="ridgeline",
    login_domain="ridgeline.example",
    owner=RIDGELINE_OWNER,
    people=(
        Person(
            RIDGELINE_OWNER,
            JENNA,
            "owner",
            "Jenna Kowalchuk",
            "+17805550190",
            "owner",
            "Owner and head coach",
            "#9C4221",
            HOURS[JENNA],
        ),
        Person(
            "us_rl_mateo",
            MATEO,
            "mateo",
            "Mateo Santos",
            "+17805550191",
            "staff",
            "Personal trainer",
            "#2F6B5E",
            HOURS[MATEO],
            payee=True,
            rate_type="percent",
            rate_bps=5000,
        ),
        Person(
            "us_rl_simran",
            SIMRAN,
            "simran",
            "Simran Gill",
            "+17805550192",
            "staff",
            "Coach, mobility and Strong seniors",
            "#5B6C8F",
            HOURS[SIMRAN],
            payee=True,
            rate_type="hourly",
            rate_cents=3000,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Personal training and small group strength classes in Old Strathcona, "
        "Edmonton.",
        "about": (
            "Ridgeline Strength Studio is a small training studio on Whyte Avenue run by three "
            "coaches. Classes are capped at eight to twelve people so a coach can watch "
            "everyone's form, and personal training is booked in 30 or 60 minute sessions. New "
            "clients start with a free intro session and a short health questionnaire. We run "
            "a Strong seniors class twice a week for adults over 60."
        ),
        "address": "10418 82 Avenue NW, Edmonton, AB T6E 2A2",
        "phone": "+1 780-555-0198",
        "email": "hello@ridgeline.example",
        "neighbourhood": "Old Strathcona",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 2,
        "cancel_cutoff_hours": 12,
        "reschedule_cutoff_hours": 12,
    },
    subject=None,
    sms_number="+17805550199",
    gst_hst_number="786512340RT0001",
    forms=(
        FormSpec(
            PARQ,
            "Health questionnaire (PAR-Q)",
            "ff_rl_parq_",
            PARQ_FIELDS,
            require_signature=True,
            send_on="booking",
        ),
        FormSpec(
            WAIVER,
            "Liability waiver",
            "ff_rl_waiver_",
            WAIVER_FIELDS,
            require_signature=True,
            send_on="booking",
        ),
        FormSpec(FEEDBACK, "Session feedback", "ff_rl_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(ContractSpec(MEMBERSHIP, "Membership agreement", MEMBERSHIP_BODY),),
    storyline=(
        Stage(
            "New lead, free intro booked online with a health questionnaire",
            "hailey",
            ("bk_rl_hailey_intro", "fr_rl_parq_hailey"),
        ),
        Stage("Member on the unlimited plan", "ben", ("sub_rl_unlimited_ben",)),
        Stage("Member whose card failed, past due", "kyle", ("sub_rl_eight_kyle",)),
        Stage(
            "Halfway through a 10-session pack",
            "grace",
            ("pkg_rl_pt10_grace", "bk_rl_grace_pack_5"),
        ),
        Stage(
            "Full class, waitlist seat given after a cancellation",
            "farah",
            ("ses_rl_full_class", "bk_rl_full_farah", "bk_rl_full_lucy", "bk_rl_full_devon"),
        ),
        Stage("Personal training in progress, checked in", "omar", ("bk_rl_omar_today",)),
        Stage("Today's class with check-ins", "joy", ("ses_rl_today_class",)),
        Stage("Personal training later today, rescheduled by text", "linh", ("bk_rl_linh_today",)),
        Stage("Cancelled membership", "carmen", ("sub_rl_unlimited_carmen",)),
        Stage("Strong seniors on a 10-class pass", "elaine", ("pkg_rl_seniors_elaine",)),
        Stage("Five-star session feedback", "walter", ("fr_rl_feedback_walter",)),
        Stage(
            "Four-star feedback about parking, with a reply",
            "anita",
            ("fr_rl_feedback_anita", "th_rl_anita_email"),
        ),
        Stage("Paid by Tap to Pay with a retail add-on", "jordan", ("ord_rl_jordan",)),
    ),
    pacing=Pacing(
        {MATEO: 5, JENNA: 2, SIMRAN: 1},
        (PT60, PT30, PT60, PT60, PT30),
        weeks=28,
        ahead_weeks=4,
        seasonality={1: 1.2, 2: 1.1, 6: 0.85, 7: 0.7, 8: 0.75, 12: 0.8},
        settlements=("card", "card", "etransfer", "card", "card", "cash"),
        cancel_every=17,
    ),
    photo_clients=tuple(m.key for m in PEOPLE if m.photo),
    founded_day=-900,
    catalog_day=-340,
    documents_day=-335,
    restock_days=(-330, -270, -210, -150, -90, -30),
    payouts_from_day=-230,
    invoice_start=4100,
    estimate_start=100,
    cheque_start=5100,
    seed=31,
)


class Ridgeline(Demo):
    spec = SPEC

    def __init__(self, now: datetime) -> None:
        super().__init__(now)
        self.member_since: dict[str, datetime] = {}
        self.ended: dict[str, datetime] = {}

    def story(self) -> None:
        self.clients()
        self.time_off(
            "mateo_away", MATEO, self.at(-96, 0), self.at(-89, 23, 59), "Family trip to Manila"
        )
        self.repeats()
        self.today()
        self.full_class()
        self.intros()
        self.memberships()
        self.timetable()
        self.training()
        self.fill(list(FILL_CLIENTS))
        self.retail()
        self.paid_at_the_desk()
        self.engagement()

    def visit_note(self, item: Item, booking: Booking) -> str:
        day = self.local(booking.starts_at)
        return f"{item.name}, {day:%B} {day.day}."

    def clients(self) -> None:
        for index, member in enumerate(PEOPLE):
            long_time = member.since < LONG_TIME
            tags = {
                "unlimited": ["member"],
                "eight": ["member"],
                "seniors": ["seniors"],
                "lead": ["new"],
            }.get(member.group, [])
            self.client(
                member.key,
                member.name,
                _email(member.name),
                f"+1780555{100 + index:04}",
                tags=tags,
                channel="email" if index % 3 == 0 else "sms",
                fields={"source": ("referral", "google", "walk-in", "instagram")[index % 4]},
                since=self.at(member.since, 12) if long_time else None,
            )
        self.photos()

    def repeats(self) -> None:
        self.series(
            "raj", "raj", PT60, MATEO, weekday=1, at=time(12, 0), every=1, visits=14, before=10
        )
        self.series(
            "kevin", "kevin", PT30, JENNA, weekday=3, at=time(7, 30), every=1, visits=12, before=8
        )

    def fits(self, staff: str, start: datetime, minutes: int) -> bool:
        end = start + timedelta(minutes=minutes)
        return self.within_hours(staff, start, end) and self.free(staff, None, start, end, 0, 15)

    def today(self) -> None:
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        pt_start = (floor - timedelta(minutes=30)).astimezone(UTC)
        coach = next((s for s in (JENNA, MATEO, SIMRAN) if self.fits(s, pt_start, 60)), None)
        if coach is not None:
            omar = self.book(
                "omar_today", "omar", PT60, coach, pt_start, "confirmed", self.at(-3, 9)
            )
            omar.checked_in_at = pt_start - timedelta(minutes=4)
        else:
            start = self.place(MATEO, PT60, 1, None, past=False)
            assert start is not None
            omar = self.book("omar_today", "omar", PT60, MATEO, start, "confirmed", self.at(-3, 9))
        self.note(
            omar.id,
            "booking",
            "Second session back after the shoulder strain. Keep pressing light and add the band "
            "pull-aparts from last week.",
            omar.created_at,
        )
        class_start = (floor - timedelta(minutes=15)).astimezone(UTC)
        teacher = next(
            (
                s
                for s in (SIMRAN, JENNA, MATEO)
                if s != omar.staff_id and self.fits(s, class_start, 45)
            ),
            None,
        )
        live = teacher is not None
        if teacher is None:
            teacher = SIMRAN
            found = self.place(SIMRAN, MOBILITY, 1, None, past=False)
            assert found is not None
            class_start = found
        session = self.session("today_class", MOBILITY, teacher, class_start)
        for seat, key in enumerate(("joy", "ben", "yuna", "tom", "daniel", "wei")):
            booking = self.book(
                f"today_class_{key}",
                key,
                MOBILITY,
                teacher,
                class_start,
                "confirmed",
                self.at(-4 + seat * 0.3, 19),
                source="online",
                price=0,
                slot=session,
            )
            if live and seat < 5:
                booking.checked_in_at = class_start - timedelta(minutes=8 - seat)
        later = (floor + timedelta(minutes=150)).astimezone(UTC)
        coach = next((s for s in (MATEO, SIMRAN, JENNA) if self.fits(s, later, 60)), None)
        if coach is None:
            coach = MATEO
            found = self.place(MATEO, PT60, 1, None, past=False)
            assert found is not None
            later = found
        self.book("linh_today", "linh", PT60, coach, later, "confirmed", self.at(-6, 14))

    def full_class(self) -> None:
        today = self.local(self.now).date()
        day = next(
            today + timedelta(days=n)
            for n in range(2, 12)
            if (today + timedelta(days=n)).weekday() in {0, 2}
        )
        start = datetime.combine(day, time(17, 30), self.ctx.zone).astimezone(UTC)
        session = self.session("full_class", STRENGTH, MATEO, start)
        seated = ("ben", "jasleen", "vikram", "marisol", "tom", "olena", "priyanka")
        for index, key in enumerate(seated):
            self.book(
                f"full_{key}",
                key,
                STRENGTH,
                MATEO,
                start,
                "confirmed",
                self.now - timedelta(days=5, hours=index * 3),
                source="online",
                price=0,
                slot=session,
            )
        lucy = self.book(
            "full_lucy",
            "lucy",
            STRENGTH,
            MATEO,
            start,
            "canceled",
            self.now - timedelta(days=4, hours=2),
            source="online",
            slot=session,
        )
        canceled = lucy.canceled_at = self.now - timedelta(hours=7)
        farah = self.book(
            "full_farah",
            "farah",
            STRENGTH,
            MATEO,
            start,
            "confirmed",
            self.now - timedelta(days=2, hours=5),
            source="online",
            price=0,
            slot=session,
        )
        farah.confirmed_at = canceled + timedelta(minutes=1)
        self.book(
            "full_devon",
            "devon",
            STRENGTH,
            MATEO,
            start,
            "waitlisted",
            self.now - timedelta(days=1, hours=3),
            source="online",
            slot=session,
        )
        self.ctx.add(
            Audit(
                id="aud_rl_full_farah_seat",
                business_id=RIDGELINE,
                performed_by=None,
                action="class.seat_opened",
                entity_type="booking",
                entity_id=farah.id,
                changes={"slot_id": session.id},
                created_at=farah.confirmed_at,
            )
        )

    def parq(self, key: str, booking: Booking, *, joint: str | None = None) -> None:
        client = self.ctx.get(Client, booking.client_id)
        submitted = min(booking.created_at + timedelta(hours=6), self.now - timedelta(hours=2))
        index = sum(map(ord, key))
        answers: dict[str, object] = {
            "date_of_birth": date(1958 + index % 45, 1 + index % 12, 1 + index % 27).isoformat(),
            "emergency_name": ("Sam", "Alex", "Chris", "Jordan", "Pat")[index % 5]
            + " "
            + client.name.split(" ", 1)[1],
            "emergency_phone": f"+1780555{100 + (index * 7) % 90:04}",
            **{
                question: "No"
                for question in (
                    "heart_condition",
                    "chest_pain",
                    "dizziness",
                    "chronic_condition",
                    "medications",
                    "supervised_only",
                )
            },
            "joint_problem": "Yes" if joint else "No",
            "activity_level": (
                "Mostly inactive",
                "Active once or twice a week",
                "Active three or more times a week",
            )[index % 3],
            "goals": [("Get stronger", "Build a routine", "Move with less pain")[index % 3]],
            "accurate": True,
        }
        if joint:
            answers["details"] = joint
        signature: dict[str, object] = {"name": client.name, "strokes": None, "ip": "192.0.2.41"}
        self.response("parq", key, PARQ, booking, answers, submitted, signature=signature)

    def waiver(self, key: str, booking: Booking, *, signed: bool = True) -> None:
        client = self.ctx.get(Client, booking.client_id)
        submitted = min(
            booking.created_at + timedelta(hours=6, minutes=4), self.now - timedelta(hours=2)
        )
        if not signed:
            self.response("waiver", key, WAIVER, booking, {}, None)
            return
        self.response(
            "waiver",
            key,
            WAIVER,
            booking,
            {
                "risks": True,
                "follow_instructions": True,
                "release": True,
                "photos": ("Yes", "Only if my face isn't shown", "No")[len(key) % 3],
                "signed_on": self.local(submitted).date().isoformat(),
            },
            submitted,
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.42"},
        )

    def intros(self) -> None:
        hailey = self.place(MATEO, INTRO, 2, None, past=False)
        assert hailey is not None
        lead = self.book(
            "hailey_intro",
            "hailey",
            INTRO,
            MATEO,
            hailey,
            "pending",
            self.now - timedelta(hours=20),
            source="online",
        )
        self.parq(
            "hailey",
            lead,
            joint="I had ACL surgery on my left knee in 2024. My physio cleared me for "
            "strength training last spring, but deep lunges still feel unstable.",
        )
        self.waiver("hailey", lead, signed=False)
        self.note(
            "cl_rl_hailey",
            "client",
            "Booked the intro online. ACL repair on the left knee in 2024; ask about her "
            "physio's exercise list before anything single-leg.",
            self.now - timedelta(hours=18),
        )
        for index, member in enumerate(PEOPLE):
            if member.since < LONG_TIME or member.group == "lead":
                continue
            coach = (JENNA, MATEO, SIMRAN)[index % 3]
            booking = self.visit(
                f"{member.key}_intro", member.key, INTRO, coach, member.since, settle=None
            )
            assert booking is not None, member.key
            booking.source = "online" if index % 2 else "manual"
            if booking.source == "online":
                booking.manage_token = f"manage_bk_rl_{member.key}_intro"
            self.parq(
                member.key,
                booking,
                joint="Lower back gets sore after long drives; nothing diagnosed."
                if index % 7 == 3
                else None,
            )
            self.waiver(member.key, booking)

    def joined_at(self, key: str) -> datetime:
        intro = next((b for b in self.ctx.all(Booking) if b.id == f"bk_rl_{key}_intro"), None)
        if intro is not None and intro.completed_at is not None:
            return intro.completed_at + timedelta(minutes=40)
        client = self.ctx.get(Client, self.client_id(key))
        assert client.created_at is not None
        return client.created_at + timedelta(days=1)

    def memberships(self) -> None:
        for member in PEOPLE:
            if member.group not in {"unlimited", "eight"}:
                continue
            item = UNLIMITED if member.group == "unlimited" else EIGHT
            start = self.joined_at(member.key)
            self.member_since[member.key] = start
            if member.key == "kyle":
                self.subscribe(member.key, item, start, status="past_due")
            elif member.key == "carmen":
                ended = self.at(CANCELED_AT, 15)
                self.ended[member.key] = ended
                self.subscribe(member.key, item, start, status="canceled", ended=ended)
            else:
                self.subscribe(member.key, item, start)

    def active(self, key: str, start: datetime) -> bool:
        group = GROUPS[key]
        if group in {"unlimited", "eight"}:
            since = self.member_since.get(key)
            ended = self.ended.get(key)
            return (
                since is not None
                and since + timedelta(days=1) < start
                and (ended is None or start < ended)
            )
        return self.joined_at(key) + timedelta(days=2) < start

    def timetable(self) -> None:
        """Weekly sessions with rosters; seniors' last ten classes ride on a 10-class pass."""
        today = self.local(self.now).date()
        monday = today - timedelta(days=today.weekday())
        planned: list[tuple[Slot, list[tuple[str, BookingStatus]]]] = []
        monthly: dict[tuple[str, int, int], int] = {}
        photo = {m.key for m in PEOPLE if m.photo}
        for week in range(-CLASS_WEEKS, 5):
            for item_id, coach, weekday, at in TIMETABLE:
                day = monday + timedelta(weeks=week, days=weekday)
                start = datetime.combine(day, at, self.ctx.zone).astimezone(UTC)
                item = self.items[item_id]
                end = start + timedelta(minutes=item.duration_min or 60)
                if start < self.at(-CLASS_WEEKS * 7) or not self.free(
                    coach, None, start, end, 0, 15
                ):
                    continue
                ahead = (start - self.now).days / 7 if start > self.now else 0
                season = SEASON[day.month] * max(0.35, 1 - ahead * 0.18)
                done = end <= self.now
                roster: list[str] = []
                for member in PEOPLE:
                    if not self.active(member.key, start):
                        continue
                    if item_id == SENIORS:
                        chance = 0.72 if member.group == "seniors" else 0
                    else:
                        chance = {"unlimited": 0.4, "eight": 0.28, "drop": 0.08}.get(
                            member.group, 0
                        )
                        if item_id == BOOTCAMP and member.group == "drop":
                            chance = 0.1
                    if member.group == "eight":
                        count = monthly.get((member.key, day.year, day.month), 0)
                        if count >= 8:
                            continue
                    if self.rng.random() < chance * season:
                        roster.append(member.key)
                capacity = item.capacity or 1
                seated = roster[:capacity]
                waiting = [k for k in roster[capacity:] if k not in photo][:2] if not done else []
                seats: list[tuple[str, BookingStatus]] = []
                for key in seated:
                    if GROUPS[key] == "eight":
                        tally = (key, day.year, day.month)
                        monthly[tally] = monthly.get(tally, 0) + 1
                    status: BookingStatus = "confirmed"
                    if done:
                        missed = key not in photo and self.rng.random() < 0.04
                        status = "no_show" if missed else "completed"
                    seats.append((key, status))
                seats.extend((key, "waitlisted") for key in waiting)
                if not seats:
                    continue
                key = f"{item_id.removeprefix('it_rl_')}_{day:%Y%m%d}_{at:%H%M}"
                planned.append((self.session(key, item_id, coach, start), seats))
        passes = self.passes(planned)
        settle = 0
        for slot, seats in planned:
            item_id = slot.item_id
            for order, (key, status) in enumerate(seats):
                member = GROUPS[key] in {"unlimited", "eight"}
                package = passes.get((key, slot.id))
                created = min(
                    slot.starts_at - timedelta(days=1 + (order * 7 + len(key)) % 6, hours=order),
                    self.now - timedelta(hours=2 + order),
                )
                if package is not None:
                    created = max(created, package.created_at + timedelta(minutes=30))
                booking = self.book(
                    f"{slot.id.removeprefix('ses_rl_')}_{key}",
                    key,
                    item_id,
                    slot.staff_id,
                    slot.starts_at,
                    status,
                    created,
                    source="online" if member or order % 2 else "manual",
                    price=0 if member else None,
                    package_id=package.id if package is not None else None,
                    slot=slot,
                )
                if slot.starts_at <= self.now < slot.ends_at and status == "confirmed":
                    booking.checked_in_at = slot.starts_at - timedelta(minutes=3 + order % 5)
                if status == "completed" and not member and package is None:
                    settle += 1
                    self.bill(booking, SETTLEMENTS[settle % len(SETTLEMENTS)])

    def passes(
        self, planned: list[tuple[Slot, list[tuple[str, BookingStatus]]]]
    ) -> dict[tuple[str, str], Package]:
        """Seniors drop in for a class or two, then buy a 10-class pass as each one runs out."""
        seen: dict[str, list[Slot]] = {}
        for slot, seats in planned:
            for key, status in seats:
                if GROUPS[key] == "seniors" and status != "waitlisted":
                    seen.setdefault(key, []).append(slot)
        passes: dict[tuple[str, str], Package] = {}
        for key, slots in sorted(seen.items()):
            ordered = sorted(slots, key=lambda s: s.starts_at)
            starts = range(len(ordered) - 10, 0, -10)
            chunks = [ordered[n : n + 10] for n in reversed(starts)]
            for index, covered in enumerate(chunks):
                last = index == len(chunks) - 1
                bought = min(
                    covered[0].starts_at - timedelta(minutes=50), self.now - timedelta(days=1)
                )
                package = self.package(
                    key, PASS10, bought, key=key if last else f"{key}_{index + 1}"
                )
                if len(covered) == 10 and covered[-1].ends_at <= self.now:
                    package.status = "used"
                for slot in covered:
                    passes[(key, slot.id)] = package
        return passes

    def training(self) -> None:
        for index, day in enumerate((-140, -122, -101, -86)):
            self.visit(f"grace_{index}", "grace", PT60, MATEO, day, settle="card")
        pack = self.package("grace", PT10, self.at(-72, 18, 20))
        for index, day in enumerate((-63, -49, -35, -21, -8, 5)):
            booking = self.visit(
                f"grace_pack_{index}", "grace", PT60, MATEO, day, package_id=pack.id
            )
            assert booking is not None
        self.note(
            "cl_rl_grace",
            "client",
            "Bought the 10-pack after her fourth session. Training for a 10 km trail race in "
            "the River Valley; keep one session a week on single-leg strength.",
            pack.created_at + timedelta(minutes=10),
        )
        member = {m.key: m for m in PEOPLE}
        turn = 0
        for index, key in enumerate(PT_REGULARS):
            since = member[key].since
            for day in range(since + 9, -2, 13 + index % 3):
                turn += 1
                coach = SIMRAN if turn % 4 == 0 else MATEO
                service = PT30 if turn % 3 == 0 else PT60
                missed = key == "aidan" and -26 <= day < -13
                self.visit(
                    f"{key}_pt_{turn:03}",
                    key,
                    service,
                    coach,
                    day,
                    status="no_show" if missed else None,
                    settle=None if missed else SETTLEMENTS[turn % len(SETTLEMENTS)],
                    tip=(coach, 1000 + 500 * (turn % 2)) if turn % 5 == 0 else None,
                )
            if index % 2 == 0 and key not in {"omar", "linh"}:
                self.visit(f"{key}_next", key, PT60, MATEO, 3 + index * 2)
        jordan = self.visit("jordan_tap", "jordan", PT60, MATEO, -6, settle=None)
        assert jordan is not None and jordan.completed_at is not None
        self.sale(
            "jordan",
            "jordan",
            MATEO,
            Quote(PT60, ((BANDS, 1),)),
            jordan,
            jordan.created_at,
            jordan.completed_at + timedelta(minutes=6),
        )
        sophie = self.visit("sophie_alarm", "sophie", PT60, JENNA, -47, settle="card")
        assert sophie is not None and sophie.invoice_id is not None
        paid = next(p for p in self.ctx.all(Payment) if p.invoice_id == sophie.invoice_id)
        assert paid.paid_at is not None
        self.refund(
            paid,
            5000,
            paid.paid_at + timedelta(days=1, hours=2),
            "The building's fire alarm ended the session after 30 minutes",
        )
        mom = self.gift_card(
            "natalia_mom", "natalia", GIFT, 15000, self.at(-163, 13), recipient="Halyna Petrenko"
        )
        self.redeem(mom, 6000, self.at(-128, 11))
        self.gift_card(
            "jasleen_sister", "jasleen", GIFT, 10000, self.at(-41, 17), recipient="Gurleen Dhillon"
        )

    def retail(self) -> None:
        """Bottles and bands added to a training invoice at the desk."""
        products = (BOTTLE, LOOPS, BOTTLE, BANDS)
        bills = sorted(
            (b for b in self.ctx.all(Booking) if b.invoice_id and "_pt_" in b.id),
            key=lambda b: b.id,
        )
        for index, booking in enumerate(bills[3::7]):
            assert booking.invoice_id is not None
            self.line(
                booking.invoice_id,
                products[index % len(products)],
                booking.created_at,
                1,
            )

    def paid_at_the_desk(self) -> None:
        """Pictured clients pay a visit that ended within the hour by card before they leave."""
        photo = {self.client_id(m.key) for m in PEOPLE if m.photo}
        paid = {p.invoice_id for p in self.ctx.all(Payment) if p.invoice_id}
        for booking in self.ctx.all(Booking):
            if booking.client_id not in photo or booking.invoice_id in paid | {None}:
                continue
            invoice = self.ctx.get(Invoice, booking.invoice_id or "")
            issued = min(invoice.issued_at or self.now, self.now - timedelta(minutes=4))
            invoice.issued_at = invoice.updated_at = issued
            invoice.due_at = issued + timedelta(days=14)
            self.payment(
                booking.client_id.removeprefix("cl_rl_"),
                min(issued + timedelta(minutes=3), self.now - timedelta(minutes=1)),
                "card",
                invoice_id=invoice.id,
                size="balance",
            )

    def latest(self, key: str, item_id: str | None = None) -> Booking:
        slots = {s.id: s for s in self.ctx.all(Slot)}
        return max(
            (
                b
                for b in self.ctx.all(Booking)
                if b.client_id == self.client_id(key)
                and b.status == "completed"
                and (b.completed_at or self.now) < self.now - timedelta(hours=20)
                and (item_id is None or slots[b.slot_id].item_id == item_id)
            ),
            key=lambda b: b.starts_at,
        )

    def feedback(self, key: str, booking: Booking, answers: dict[str, object]) -> None:
        assert booking.completed_at is not None
        submitted = min(booking.completed_at + timedelta(hours=5), self.now - timedelta(hours=1))
        self.response(
            "feedback",
            key,
            FEEDBACK,
            booking,
            answers,
            submitted,
            created=booking.completed_at + timedelta(hours=2),
        )

    def engagement(self) -> None:
        self.consents()
        self.withdraw("kyle", "email", self.now - timedelta(days=60))
        self.broadcast(
            "fall",
            "Fall timetable",
            "Our fall timetable starts on Monday. Strength runs at 6:00 on Monday, Wednesday and "
            "Friday and at 5:30 pm on Monday and Wednesday. Mobility moves to Tuesday and "
            "Thursday at 6:00 pm, and Strong seniors stays at 10:30 on Monday and Wednesday. "
            "Book online as usual, and reply to this email if you have any questions.",
            self.at(-44, 10),
        )
        walter = self.latest("walter", SENIORS)
        self.feedback(
            "walter",
            walter,
            {
                "rating": 5,
                "liked": "Simran explains every exercise and watches that we do it right. My "
                "balance is better than it was in the spring and I can get up off the floor "
                "without a chair.",
                "recommend": "Yes",
            },
        )
        anita = self.latest("anita")
        self.feedback(
            "anita",
            anita,
            {
                "rating": 4,
                "liked": "Good class and the coach gave me easier options without making a fuss.",
                "improve": "Parking. I drove around Whyte for 15 minutes and was late for the "
                "warm-up.",
                "recommend": "Maybe",
            },
        )
        for key, booking in (
            ("ben", self.latest("ben")),
            ("grace", self.latest("grace", PT60)),
            ("raj", self.latest("raj")),
        ):
            self.feedback(key, booking, {"rating": 5, "recommend": "Yes"})
        for key in ("walter", "anita", "ben", "grace", "raj", "jordan", "elaine", "helen", "joy"):
            self.review(self.latest(key).id.removeprefix("bk_rl_"))
        self.conversations()

    def conversations(self) -> None:
        ctx = self.ctx
        when = self.now - timedelta(hours=16)
        thread = self.thread("hailey", "email", when)
        self.say(
            thread,
            "Hi, I booked the free intro for this week. What should I wear, and is it okay that "
            "my knee isn't 100%? I put the details in the questionnaire.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Hailey, thanks for filling in the questionnaire. Wear something you can move in "
            "and indoor shoes, and bring water. We'll start with movements that don't load the "
            "knee much and build from there. If your physio gave you an exercise list, bring "
            "it along. We'll confirm your time shortly.",
            when + timedelta(minutes=40),
        )
        linh = ctx.get(Booking, "bk_rl_linh_today")
        when = min(linh.created_at + timedelta(days=4), self.now - timedelta(hours=5))
        thread = self.thread("linh", "sms", when)
        self.say(
            thread,
            "Hi, something came up at work. Could I move my session to later in the day?",
            when,
            sender=None,
        )
        local = self.local(linh.starts_at)
        self.say(
            thread,
            f"No problem, Linh. You're now booked for {local:%A} at {local:%I:%M %p}".replace(
                " 0", " "
            )
            + ". See you then.",
            when + timedelta(minutes=12),
        )
        kyle = ctx.get(Subscription, "sub_rl_eight_kyle")
        failed = (kyle.current_period_end or self.now) - timedelta(days=30)
        when = min(
            max(failed, self.now - timedelta(days=20)) + timedelta(hours=26),
            self.now - timedelta(hours=3),
        )
        thread = self.thread("kyle", "sms", when)
        self.say(
            thread,
            "Hi Kyle, the card on file was declined for this month's 8-class membership. You "
            "can update it from the link in your receipt email, or we can take a new card at "
            "your next class. You can keep booking in the meantime.",
            when,
        )
        self.say(
            thread,
            "Thanks, my card was replaced after a fraud alert. I'll bring the new one Wednesday.",
            when + timedelta(hours=2),
            sender=None,
        )
        farah = ctx.get(Booking, "bk_rl_full_farah")
        assert farah.confirmed_at is not None
        when = farah.confirmed_at + timedelta(minutes=20)
        thread = self.thread("farah", "sms", when)
        self.say(
            thread,
            "Just saw I got a spot in strength. Thank you, I'll be there.",
            when,
            sender=None,
        )
        self.say(
            thread, "Great, Farah. See you then.", when + timedelta(minutes=9), sender="us_rl_mateo"
        )
        devon = ctx.get(Booking, "bk_rl_full_devon")
        when = devon.created_at + timedelta(minutes=30)
        thread = self.thread("devon", "sms", when)
        self.say(thread, "Am I next on the waitlist for the strength class?", when, sender=None)
        self.say(
            thread,
            "You're first in line now, Devon. If a spot opens you'll get a text right away.",
            when + timedelta(minutes=15),
        )
        ended = self.ended["carmen"]
        when = ended - timedelta(days=12)
        thread = self.thread("carmen", "email", when)
        self.say(
            thread,
            "Hi Jenna, we're moving to Calgary at the end of the month, so I need to cancel my "
            "membership. Thanks for everything this year.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks for letting us know, Carmen, and good luck with the move. I've cancelled the "
            "membership, so this month is the last charge. You're welcome to drop in any time "
            "you're back in Edmonton.",
            when + timedelta(hours=3),
        )
        response = ctx.get(FormResponse, "fr_rl_feedback_anita")
        assert response.submitted_at is not None
        when = response.submitted_at + timedelta(hours=2)
        thread = self.thread("anita", "email", when)
        self.say(
            thread,
            "Thanks for the feedback, Anita. Street parking on Whyte is hard after 5. The lot "
            "behind our building, off the lane on 104 Street, is free after 6 pm on weekdays, "
            "and the public parkade a block east is a three-minute walk. I'll add both to the "
            "booking confirmation.",
            when,
        )
        self.say(
            thread,
            "That helps, thanks. I didn't know about the lot.",
            when + timedelta(hours=4),
            sender=None,
        )
        walter = ctx.get(FormResponse, "fr_rl_feedback_walter")
        assert walter.submitted_at is not None
        when = walter.submitted_at + timedelta(hours=1)
        thread = self.thread("walter", "sms", when)
        self.say(
            thread,
            "Thank you for the kind words, Walter. Simran will be pleased to hear it.",
            when,
        )


EDITION = Ridgeline
