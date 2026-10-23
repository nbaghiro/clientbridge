"""Harbourside Massage and Wellness: an RMT and acupuncture clinic in Vancouver."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import GiftCard, Item, ItemKind, TaxClass
from clientbridge.models.clients import Client
from clientbridge.models.documents import FormResponse
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
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
    Stage,
    Stock,
)

HARBOURSIDE = "bz_harbourside"
HARBOURSIDE_OWNER = "us_hs_owner"

LEILA, JUN, WEN, TERESA = "st_hs_owner", "st_hs_jun", "st_hs_wen", "st_hs_teresa"
M30, M60, M90 = "it_hs_m30", "it_hs_m60", "it_hs_m90"
DEEP, PRENATAL, HOTSTONE, COUPLES = (
    "it_hs_deep",
    "it_hs_prenatal",
    "it_hs_hotstone",
    "it_hs_couples",
)
ACU_INITIAL, ACU_FOLLOW = "it_hs_acu_initial", "it_hs_acu_follow"
PACK5, PACK10, GIFT = "it_hs_pack5", "it_hs_pack10", "it_hs_gift"
OIL, HEAT = "it_hs_oil", "it_hs_heat"
INTAKE, FEEDBACK, SOAP = "frm_hs_intake", "frm_hs_feedback", "frm_hs_soap"
POLICY, ACU_CONSENT = "con_hs_cancellation", "con_hs_acupuncture"

# id, kind, name, price, minutes, category, description, tax class
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str, TaxClass], ...] = (
    (
        M30,
        "service",
        "30 minute massage",
        8500,
        30,
        "Massage therapy",
        "A focused treatment for one area, such as the neck and shoulders or the lower back. "
        "Good for a follow-up between longer visits.",
        "federal_only",
    ),
    (
        M60,
        "service",
        "60 minute massage",
        13000,
        60,
        "Massage therapy",
        "Our standard treatment. Your therapist starts with a short assessment, then works on "
        "the areas you want to focus on at the pressure you prefer.",
        "federal_only",
    ),
    (
        M90,
        "service",
        "90 minute massage",
        18500,
        90,
        "Massage therapy",
        "Time for a full-body treatment, or for two or three problem areas without rushing. "
        "Includes an assessment and stretches you can do at home.",
        "federal_only",
    ),
    (
        DEEP,
        "service",
        "Deep tissue massage, 60 minutes",
        14500,
        60,
        "Massage therapy",
        "Slower, firmer work on the deeper layers of muscle, for chronic tension and sports "
        "recovery. Expect some soreness the next day.",
        "federal_only",
    ),
    (
        PRENATAL,
        "service",
        "Prenatal massage, 60 minutes",
        13500,
        60,
        "Massage therapy",
        "For any stage of pregnancy after the first trimester. You lie on your side or "
        "propped up with pillows, never on your stomach, and we focus on the back, hips and legs.",
        "federal_only",
    ),
    (
        HOTSTONE,
        "service",
        "Hot stone massage, 90 minutes",
        19500,
        90,
        "Massage therapy",
        "Heated basalt stones are used along with hands-on massage to warm and relax the "
        "muscles. A $50 deposit holds the time and is taken off the final bill.",
        "federal_only",
    ),
    (
        COUPLES,
        "service",
        "Couples massage, 60 minutes",
        14000,
        60,
        "Massage therapy",
        "Two 60 minute massages side by side in our larger room, each with its own therapist. "
        "Priced per person; please call to book so we can hold both therapists.",
        "federal_only",
    ),
    (
        ACU_INITIAL,
        "service",
        "Acupuncture, initial visit",
        12500,
        75,
        "Acupuncture",
        "A full health history, tongue and pulse assessment, and your first treatment. Wen "
        "will suggest how many visits are likely to help.",
        "exempt",
    ),
    (
        ACU_FOLLOW,
        "service",
        "Acupuncture, follow-up",
        9500,
        45,
        "Acupuncture",
        "A treatment for returning acupuncture clients, with a short check-in on how you've "
        "felt since the last visit.",
        "exempt",
    ),
    (
        PACK5,
        "package",
        "Five 60 minute massages",
        60000,
        None,
        "Packages",
        "Five 60 minute massages for $600, a saving of $50. Use them within a year with any "
        "of our therapists.",
        "federal_only",
    ),
    (
        PACK10,
        "package",
        "Ten 60 minute massages",
        115000,
        None,
        "Packages",
        "Ten 60 minute massages for $1,150, a saving of $150. Use them within a year with any "
        "of our therapists.",
        "federal_only",
    ),
    (
        GIFT,
        "gift",
        "Gift card",
        0,
        None,
        "Gift cards",
        "A gift card for any amount, good for any massage, acupuncture visit or product. It "
        "doesn't expire.",
        "exempt",
    ),
    (
        OIL,
        "product",
        "Unscented massage oil, 250 ml",
        2400,
        None,
        "Retail",
        "The sunflower and grapeseed oil we use in treatment, with no added scent.",
        "standard",
    ),
    (
        HEAT,
        "product",
        "Herbal heat compress",
        3200,
        None,
        "Retail",
        "A cotton compress filled with dried lemongrass and herbs. Warm it in the microwave "
        "for a minute and press it on sore muscles between visits.",
        "federal_only",
    ),
)
COLORS = {
    M30: "#5B8E9B",
    M60: "#2C5F6E",
    M90: "#1F4A57",
    DEEP: "#7A5C3E",
    PRENATAL: "#B07A8C",
    HOTSTONE: "#9A5B3F",
    COUPLES: "#6E7F4C",
    ACU_INITIAL: "#4F6D8F",
    ACU_FOLLOW: "#7B93AE",
    PACK5: "#3F7A6E",
    PACK10: "#2F6357",
    GIFT: "#A0704A",
}
# on hand today, low-stock line, unit cost, SKU; the heat compress sits under its line
STOCK: dict[str, tuple[int, int, int, str]] = {
    OIL: (18, 6, 900, "HS-OIL-250"),
    HEAT: (3, 5, 1250, "HS-HEAT-HRB"),
}
BUFFERS = {ACU_INITIAL: 15, ACU_FOLLOW: 10}
WEEKDAY = range(5)
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    LEILA: {**{d: (time(9, 0), time(15, 0)) for d in WEEKDAY}, 5: (time(9, 0), time(13, 0))},
    JUN: {
        **{d: (time(12, 0), time(20, 0)) for d in (0, 1, 3, 4)},
        2: (time(10, 0), time(16, 0)),
        5: (time(10, 0), time(16, 0)),
    },
    WEN: {
        **{d: (time(10, 0), time(18, 0)) for d in (0, 2, 4)},
        **{d: (time(14, 0), time(19, 0)) for d in (1, 3)},
    },
}
# the name and registration number printed on receipts for extended health claims
CREDENTIALS = {
    LEILA: ("Leila Moradi", "RMT", "10482"),
    JUN: ("Jun Park", "RMT", "13917"),
    WEN: ("Wen Liu", "R.Ac.", "A-2316"),
}


def _registration(staff: str) -> str:
    """A practitioner's title, which their visit receipts print: "RMT · Reg. 10482"."""
    _, credential, number = CREDENTIALS[staff]
    return f"{credential} · Reg. {number}"


POLICY_REVISED = 120
POLICY_V1 = (
    "Please give us 24 hours' notice to move or cancel a massage or acupuncture visit. "
    "Cancellations with less notice are charged half the treatment fee. Extended health plans "
    "don't cover cancellation fees."
)
POLICY_BODY = "\n\n".join(
    (
        "This policy covers how to move or cancel a visit at Harbourside Massage and Wellness. "
        "It is demo text for a fictional business, not legal advice.",
        "Notice\nPlease give us at least 24 hours' notice to move or cancel. You can do it from "
        "the link in your confirmation email, by text or by phone. We keep a short waitlist, "
        "so an early cancellation usually lets someone else in.",
        "Late cancellations\nIf you cancel with less than 24 hours' notice, we charge half the "
        "treatment fee to the card on file. We'll waive it once a year for illness or an "
        "emergency; just tell us when you call.",
        "Missed visits\nIf you don't come and haven't told us, we charge the full treatment "
        "fee. A deposit held for a hot stone or couples massage goes toward that fee.",
        "Arriving late\nYour visit ends at its booked time so the next client isn't kept "
        "waiting, and the full fee applies.",
        "Insurance\nExtended health plans don't cover cancellation or missed-visit fees, so "
        "those receipts can't be claimed.",
        "Packages\nA late cancellation or missed visit on a package uses one of its massages "
        "instead of a charge to your card.",
    )
)
ACU_CONSENT_BODY = "\n\n".join(
    (
        "This consent covers acupuncture treatment with Wen Liu, registered acupuncturist, at "
        "Harbourside Massage and Wellness. It is demo text for a fictional business, not legal "
        "advice.",
        "What acupuncture involves\nFine, single-use sterile needles are placed at points on "
        "the body and left for 15 to 30 minutes. Your acupuncturist may also use gentle heat or "
        "cupping, and will explain each one before using it.",
        "Possible effects\nMost people feel a brief pinch, then heaviness or warmth. Small "
        "bruises, short-lived soreness and feeling light-headed are possible. Serious problems "
        "are rare.",
        "Tell us first\nPlease tell us if you are pregnant or might be, take blood thinners, "
        "have a pacemaker, a bleeding disorder or a fear of needles, or feel unwell on the day.",
        "Your choices\nYou can ask questions at any time, ask us to stop, or decline any part "
        "of a treatment. Acupuncture works alongside care from your doctor, not instead of it.",
    )
)
CONDITIONS = (
    "High blood pressure",
    "Heart condition",
    "Diabetes",
    "Arthritis",
    "Osteoporosis",
    "Migraines or frequent headaches",
    "Blood clots or varicose veins",
    "Cancer, now or in the past",
    "Epilepsy or seizures",
    "Skin condition or allergy to oils",
    "None of these",
)
INTAKE_FIELDS: tuple[DocField, ...] = (
    ("date_of_birth", "date", "Date of birth", None, True, ()),
    ("emergency_name", "text", "Emergency contact", None, True, ()),
    ("emergency_phone", "phone", "Emergency contact's phone", None, True, ()),
    (
        "conditions",
        "multiselect",
        "Do you have any of these conditions?",
        "Some conditions change how we treat, so we ask everyone.",
        True,
        CONDITIONS,
    ),
    (
        "conditions_detail",
        "longtext",
        "Anything we should know about those conditions?",
        None,
        False,
        (),
    ),
    (
        "medications",
        "longtext",
        "Medications and supplements you take",
        "Blood thinners and pain medication are the most important for us to know about.",
        False,
        (),
    ),
    (
        "injuries",
        "longtext",
        "Injuries or surgeries in the last five years",
        None,
        False,
        (),
    ),
    (
        "pregnant",
        "select",
        "Are you pregnant?",
        None,
        True,
        ("No", "Yes", "Prefer to discuss in person"),
    ),
    ("pregnancy_weeks", "number", "If so, how many weeks?", None, False, ()),
    (
        "avoid",
        "longtext",
        "Areas you'd like us to avoid",
        "For example the feet, the abdomen or an area that's healing.",
        False,
        (),
    ),
    (
        "pressure",
        "select",
        "Pressure you usually prefer",
        "You can change your mind during the treatment.",
        True,
        ("Light", "Medium", "Firm", "Not sure yet"),
    ),
    ("focus", "longtext", "What would you like help with?", None, False, ()),
    (
        "claim",
        "select",
        "Will you claim this visit with an extended health plan?",
        "Some plans need a doctor's referral for massage therapy.",
        False,
        ("Yes", "No", "Not sure"),
    ),
    (
        "consent",
        "checkbox",
        "I consent to assessment and treatment, and I know I can ask questions or stop at any time",
        None,
        True,
        (),
    ),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your visit?", None, True, ()),
    ("liked", "longtext", "What went well?", None, False, ()),
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

SOAP_FIELDS: tuple[DocField, ...] = (
    (
        "subjective",
        "longtext",
        "Subjective",
        "What the client reports: where it hurts, since when, and what helps.",
        True,
        (),
    ),
    ("objective", "longtext", "Objective", "Posture, range of motion and palpation.", False, ()),
    ("assessment", "longtext", "Assessment", None, False, ()),
    ("plan", "longtext", "Plan", "Treatment given, home care and when to come back.", True, ()),
    ("pressure", "select", "Pressure used", None, False, ("Light", "Medium", "Firm")),
)
# note key, visit key, minutes after the visit ended, answers
SOAP_NOTES: tuple[tuple[str, str, int, dict[str, object]], ...] = (
    (
        "fatemeh",
        "fatemeh_recent",
        20,
        {
            "subjective": "Tension across both shoulders after a week of long desk days.",
            "objective": "Right shoulder elevated; upper trapezius hypertonic, more on the right.",
            "assessment": "Postural muscle tension, no red flags.",
            "plan": "Full-body treatment with focus on the shoulders. Chin tucks twice a day. "
            "Rebook in three weeks.",
            "pressure": "Medium",
        },
    ),
    (
        "hiroshi",
        "hiroshi_recent",
        15,
        {
            "subjective": "Left calf tight since a 10 km race on the weekend.",
            "objective": "Trigger points in the left gastrocnemius; ankle range normal.",
            "plan": "Deep tissue to both calves. Gentle stretching and a rest day.",
            "pressure": "Firm",
        },
    ),
    (
        "hiroshi_amended",
        "hiroshi_recent",
        65,
        {
            "subjective": "Left calf tight since a 10 km race on the weekend.",
            "objective": "Trigger points in the left gastrocnemius and soleus; ankle range normal.",
            "assessment": "Post-race muscle soreness. The soleus was missed in the first note.",
            "plan": "Deep tissue to both calves. Gentle stretching and a rest day. "
            "Rebook in two weeks if it hasn't settled.",
            "pressure": "Firm",
        },
    ),
    (
        "raj",
        "raj_recent",
        25,
        {
            "subjective": "Lower back stiffness in the mornings, about a month now.",
            "objective": "Reduced lumbar flexion; tender quadratus lumborum on both sides.",
            "plan": "90 minutes with focus on the lower back and hips. Cat-cow stretch daily.",
            "pressure": "Medium",
        },
    ),
)
NOTE_AMENDS = {"hiroshi_amended": "hiroshi"}


@dataclass(frozen=True)
class Regular:
    key: str
    name: str
    # days before today that they first came in, before the seeded history began
    since: int | None = None
    photo: bool = False


PEOPLE = (
    Regular("ananya", "Ananya Iyer", photo=True),
    Regular("kenji", "Kenji Watanabe", -420, True),
    Regular("sofia", "Sofia Marquez", -380, True),
    Regular("ethan", "Ethan Ng", -330, True),
    Regular("harjit", "Harjit Gill", photo=True),
    Regular("brendan", "Brendan O'Neill", -500),
    Regular("margaret", "Margaret Lau", -560, True),
    Regular("lucas", "Lucas Fournier", photo=True),
    Regular("aaron", "Aaron Goldberg", -460, True),
    Regular("leah", "Leah Goldberg", -460, True),
    Regular("fatemeh", "Fatemeh Hosseini", -350, True),
    Regular("gwen", "Gwen Morrison", -300),
    Regular("navneet", "Navneet Brar", photo=True),
    Regular("chloe", "Chloe Tremblay"),
    Regular("rosa", "Rosa Aquino", -320),
    Regular("dev", "Dev Malhotra", -340),
    Regular("daniel", "Daniel Cho", -390),
    Regular("tyler", "Tyler Hughes"),
    Regular("hiroshi", "Hiroshi Sato", -410),
    Regular("olivia", "Olivia Sinclair", -360, True),
    Regular("raj", "Rajinder Sidhu", -600, True),
    Regular("mina", "Mina Hashemi", -310),
    Regular("thomas", "Thomas Kowalski"),
    Regular("grace", "Grace Nakamura", -440, True),
    Regular("felix", "Felix Wong"),
    Regular("amara", "Amara Okafor", -330, True),
    Regular("liam", "Liam Fitzgerald"),
    Regular("jessica", "Jessica Vo", -400, True),
    Regular("marcus", "Marcus Coleman"),
    Regular("elif", "Elif Yilmaz", -370, True),
    Regular("andrea", "Andrea Rossi"),
    Regular("vikram", "Vikram Pillai", -345),
    Regular("claudia", "Claudia Weber"),
    Regular("patrick", "Patrick Gagnon", -480),
    Regular("joy", "Joy Bautista"),
    Regular("samuel", "Samuel Abebe", -520, True),
    Regular("diana", "Diana Petrova"),
    Regular("kevin", "Kevin Cheung", -450),
    Regular("isabel", "Isabel Moreno"),
    Regular("nicole", "Nicole MacLeod", -335),
    Regular("ben", "Benjamin Levi"),
    Regular("yuki", "Yuki Sato", photo=True),
    Regular("sarah", "Sarah Thompson", -365),
    Regular("imran", "Imran Qureshi"),
    Regular("lena", "Lena Johansson", -325),
    Regular("carlos", "Carlos Ruiz"),
    Regular("wei", "Wei Liu", -430, True),
    Regular("maria", "Maria Papadopoulos"),
    Regular("megan", "Megan Sinclair"),
    Regular("omar", "Omar Khoury", -390),
    Regular("tina", "Tina Chow", -340),
    Regular("paul", "Paul Henderson"),
    Regular("alicia", "Alicia Gomez"),
    Regular("bilal", "Bilal Siddiqui"),
    Regular("erin", "Erin MacDonald", -470),
    Regular("sunita", "Sunita Patel"),
    Regular("chris", "Christopher Lam"),
    Regular("holly", "Holly Anderson"),
    Regular("farid", "Farid Karimi"),
    Regular("ruby", "Ruby Singh"),
)
# the routine visits: massage regulars see Leila or Jun, acupuncture regulars see Wen
MASSAGE_CLIENTS = (
    "sofia",
    "ethan",
    "brendan",
    "margaret",
    "aaron",
    "leah",
    "fatemeh",
    "gwen",
    "hiroshi",
    "raj",
    "mina",
    "thomas",
    "felix",
    "liam",
    "jessica",
    "marcus",
    "elif",
    "andrea",
    "vikram",
    "claudia",
    "joy",
    "kevin",
    "isabel",
    "nicole",
    "ben",
    "sarah",
    "imran",
    "maria",
    "megan",
    "omar",
    "paul",
    "alicia",
    "erin",
    "chris",
    "ruby",
    "olivia",
    "amara",
    "dev",
    "daniel",
)
ACU_CLIENTS = (
    "rosa",
    "wei",
    "grace",
    "yuki",
    "samuel",
    "sunita",
    "farid",
    "lena",
    "diana",
    "tina",
    "holly",
    "bilal",
    "carlos",
    "patrick",
)
TODAY = ((LEILA, "sofia", M60), (JUN, "ethan", DEEP), (WEN, "rosa", ACU_FOLLOW))
# gift cards bought in December: purchaser, recipient, face value, recipient's client key
DECEMBER_GIFTS = (
    ("margaret", "Lucas Fournier", 20000, "lucas"),
    ("kevin", "Tina Chow", 10000, "tina"),
    ("raj", "Harpreet Sidhu", 15000, None),
    ("jessica", "Linh Tran", 10000, None),
    ("samuel", "Hanna Abebe", 15000, None),
    ("grace", "For Mom, with love", 13000, None),
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str, TaxClass]) -> Offering:
    item_id, kind, name, price, minutes, category, description, tax = row
    stock = STOCK.get(item_id)
    deposit = item_id in {HOTSTONE, COUPLES}
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class=tax,
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=kind == "service" and item_id != COUPLES,
        sell_online=kind == "product",
        addon_for=(M30, M60, M90, DEEP, PRENATAL, HOTSTONE) if kind == "product" else (),
        buffer_after_min=BUFFERS.get(item_id, 15) if kind == "service" else 0,
        deposit_type="fixed" if deposit else "none",
        deposit_value=5000 if deposit else None,
        sku=stock[3] if stock else None,
        cost_cents=stock[2] if stock else None,
        stock=Stock(stock[0], stock[1]) if stock else None,
        sessions={PACK5: 5, PACK10: 10}.get(item_id),
        covers=M60 if kind == "package" else None,
        validity_days=365 if kind == "package" else None,
        ref={PACK5: "pack5", PACK10: "pack10"}.get(item_id),
    )


SPEC = BusinessSpec(
    listing=demo_business(HARBOURSIDE),
    code="hs",
    slug="harbourside",
    login_domain="harbourside.example",
    owner=HARBOURSIDE_OWNER,
    people=(
        Person(
            HARBOURSIDE_OWNER,
            LEILA,
            "owner",
            "Leila Moradi",
            "+17785550191",
            "owner",
            _registration(LEILA),
            "#2C5F6E",
            HOURS[LEILA],
        ),
        Person(
            "us_hs_jun",
            JUN,
            "jun",
            "Jun Park",
            "+17785550192",
            "staff",
            _registration(JUN),
            "#7A5C3E",
            HOURS[JUN],
            payee=True,
            rate_type="percent",
            rate_bps=5500,
        ),
        Person(
            "us_hs_wen",
            WEN,
            "wen",
            "Wen Liu",
            "+17785550193",
            "staff",
            _registration(WEN),
            "#4F6D8F",
            HOURS[WEN],
            payee=True,
            rate_type="hourly",
            rate_cents=5200,
        ),
        Person(
            "us_hs_teresa",
            TERESA,
            "teresa",
            "Teresa Santos",
            "+17785550194",
            "admin",
            "Front desk and client care",
            "#6B7280",
            bookable_online=False,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Registered massage therapy and acupuncture in Coal Harbour.",
        "about": (
            "Harbourside Massage and Wellness is a small clinic a block from the Coal Harbour "
            "seawall. Leila and Jun are registered massage therapists and Wen is a registered "
            "acupuncturist. Every first visit starts with a health history and a short "
            "assessment, and receipts include your practitioner's registration number for "
            "extended health claims. We're open Monday to Saturday, with evenings until 8 on "
            "weekdays except Wednesday."
        ),
        "address": "1285 West Pender Street, Vancouver, BC V6E 4B1",
        "phone": "+1 778-555-0190",
        "email": "hello@harbourside.example",
        "website": "https://harbourside.example",
        "neighbourhood": "Coal Harbour",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 12,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject=None,
    sms_number="+17785550199",
    gst_hst_number="742581936RT0001",
    pst_number="PST10583321",
    forms=(
        FormSpec(
            INTAKE,
            "Health history",
            "ff_hs_",
            INTAKE_FIELDS,
            require_signature=True,
            send_on="booking",
        ),
        FormSpec(FEEDBACK, "Visit feedback", "ff_hs_feedback_", FEEDBACK_FIELDS),
        FormSpec(SOAP, "SOAP treatment note", "ff_hs_soap_", SOAP_FIELDS),
    ),
    contracts=(
        ContractSpec(
            POLICY,
            "Cancellation policy",
            POLICY_BODY,
            version=2,
            earlier_body=POLICY_V1,
            revised_day=-POLICY_REVISED,
        ),
        ContractSpec(ACU_CONSENT, "Acupuncture consent", ACU_CONSENT_BODY),
    ),
    storyline=(
        Stage(
            "New client, health history in before the first visit",
            "ananya",
            ("bk_hs_ananya_first", "fr_hs_intake_ananya"),
        ),
        Stage(
            "Regular partway through a 10-pack", "kenji", ("pkg_hs_pack10_kenji", "bk_hs_kenji_6")
        ),
        Stage(
            "Today's treatments, one checked in",
            "sofia",
            ("bk_hs_sofia_today", "bk_hs_ethan_today", "bk_hs_rosa_today"),
        ),
        Stage(
            "Late cancellation inside 24 hours, fee charged",
            "brendan",
            ("bk_hs_brendan_late", "inv_hs_brendan_late"),
        ),
        Stage(
            "December gift card, redeemed in the new year",
            "margaret",
            ("gc_hs_lucas", "bk_hs_lucas_gift"),
        ),
        Stage(
            "Couples massage with both therapists",
            "leah",
            ("bk_hs_couples_leah", "bk_hs_couples_aaron"),
        ),
        Stage("Weekly acupuncture series", "harjit", ("sch_hs_harjit", "bk_hs_harjit_initial")),
        Stage("Five-star feedback", "fatemeh", ("fr_hs_feedback_fatemeh",)),
        Stage("Four-star feedback about the room temperature", "gwen", ("fr_hs_feedback_gwen",)),
    ),
    pacing=Pacing(
        {LEILA: 12, JUN: 18, WEN: 11},
        (M60, M60, M90, DEEP, M30, M60, M90, M60),
        weeks=34,
        ahead_weeks=5,
        seasonality={
            1: 1.1,
            2: 1.0,
            3: 1.0,
            4: 0.95,
            5: 0.95,
            6: 0.9,
            7: 0.75,
            8: 0.8,
            9: 1.0,
            10: 1.05,
            11: 1.1,
            12: 1.15,
        },
        settlements=("card", "card", "card", "etransfer", "card", "cash", "card"),
        cancel_every=19,
        staff_services={
            JUN: (M60, DEEP, M90, M60, DEEP, M30, M60),
            WEN: (ACU_FOLLOW,),
        },
    ),
    photo_clients=tuple(person.key for person in PEOPLE if person.photo),
    inbox_user="us_hs_teresa",
    founded_day=-900,
    catalog_day=-600,
    documents_day=-590,
    restock_days=(-560, -420, -300, -180, -90, -30),
    payouts_from_day=-240,
    invoice_start=5200,
    estimate_start=500,
    cheque_start=6100,
    seed=41,
)


class Harbourside(Demo):
    spec = SPEC

    def story(self) -> None:
        self.clients()
        self.time_off("jun_away", JUN, self.at(-98, 0), self.at(-91, 23, 59), "Holiday in Seoul")
        self.time_off(
            "wen_course", WEN, self.at(-45, 0), self.at(-44, 23, 59), "Continuing education"
        )
        self.acupuncture()
        self.today()
        self.couples()
        self.storyline()
        self.packages()
        self.gifts()
        self.named_visits()
        self.fill(
            list(MASSAGE_CLIENTS),
            by_staff={WEN: list(ACU_CLIENTS)},
        )
        self.retail()
        self.paperwork()
        self.treatment_notes()
        self.engagement()

    def visit_note(self, item: Item, booking: Booking) -> str:
        name, credential, number = CREDENTIALS[booking.staff_id or LEILA]
        day = self.local(booking.starts_at)
        return (
            f"{item.name} on {day:%B} {day.day}, {day.year} with {name}, {credential}, "
            f"registration {number}."
        )

    def clock(self, when: datetime) -> str:
        local = self.local(when)
        return f"{local.hour % 12 or 12}:{local:%M} {'a.m.' if local.hour < 12 else 'p.m.'}"

    def clients(self) -> None:
        for index, person in enumerate(PEOPLE):
            first, last = person.name.lower().replace("'", "").split(" ", 1)
            self.client(
                person.key,
                person.name,
                f"{first}.{last.replace(' ', '')}@example.test",
                f"+17785550{100 + index}",
                tags=["acupuncture"] if person.key in ACU_CLIENTS or person.key == "harjit" else [],
                channel="email" if index % 3 == 0 else "sms",
                fields={"source": ("referral", "google", "walk-in", "insurer list")[index % 4]},
                since=self.at(person.since, 12) if person.since is not None else None,
            )
        self.photos()

    def fits(self, staff: str, item_id: str, start: datetime) -> bool:
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        return self.within_hours(staff, start, end) and self.free(
            staff, None, start, end, item.buffer_before_min, item.buffer_after_min
        )

    def acupuncture(self) -> None:
        """Harjit's weekly series after an initial visit, and every acupuncture regular's start."""
        series = self.series(
            "harjit",
            "harjit",
            ACU_FOLLOW,
            WEN,
            weekday=2,
            at=time(10, 0),
            every=1,
            visits=8,
            before=5,
        )
        first = min(
            b.starts_at
            for b in self.ctx.all(Booking)
            if self.ctx.get(Slot, b.slot_id).recurrence_id == series.id
        )
        initial = first - timedelta(days=7)
        if not self.fits(WEN, ACU_INITIAL, initial):
            raise ValueError("harjit: the initial visit does not fit Wen's calendar")
        booking = self.book(
            "harjit_initial",
            "harjit",
            ACU_INITIAL,
            WEN,
            initial,
            "completed",
            initial - timedelta(days=3),
        )
        self.bill(booking, "card")
        self.note(
            "cl_hs_harjit",
            "client",
            "Lower back pain since a fall on the ice last winter. Physio twice a month. Weekly "
            "acupuncture for eight weeks, then review.",
            booking.completed_at or initial,
        )
        for index, key in enumerate(ACU_CLIENTS):
            start = self.place(WEN, ACU_INITIAL, -250 + index * 4, None, past=True, forward=True)
            if start is None:
                raise ValueError(f"{key}: no room for an initial acupuncture visit")
            visit = self.book(
                f"{key}_initial",
                key,
                ACU_INITIAL,
                WEN,
                start,
                "completed",
                start - timedelta(days=4),
                source="online" if index % 2 else "manual",
            )
            self.bill(visit, "card" if index % 3 else "etransfer")

    def today(self) -> None:
        """One visit for each practitioner today; whoever is working now has a client checked in."""
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 30 * 30, second=0, microsecond=0)
        checked_in = False
        for staff, key, item_id in TODAY:
            start: datetime | None = None
            arrived = False
            length = timedelta(minutes=self.items[item_id].duration_min or 60)
            # the visit in progress must still be running now, so a short treatment starts later
            current = next(
                (
                    candidate
                    for candidate in (
                        (floor - timedelta(minutes=30)).astimezone(UTC),
                        floor.astimezone(UTC),
                    )
                    if candidate <= self.now
                    and candidate + length > self.now + timedelta(minutes=5)
                ),
                None,
            )
            if not checked_in and current is not None and self.fits(staff, item_id, current):
                start, arrived = current, True
            else:
                for step in range(1, 20):
                    later = (floor + timedelta(minutes=30 * step)).astimezone(UTC)
                    if self.local(later).date() != local.date():
                        break
                    if later > self.now + timedelta(minutes=30) and self.fits(
                        staff, item_id, later
                    ):
                        start = later
                        break
            if start is None:
                start = self.place(staff, item_id, 1, None, past=False)
                assert start is not None
            booking = self.book(
                f"{key}_today", key, item_id, staff, start, "confirmed", self.at(-6, 11)
            )
            if arrived:
                booking.checked_in_at = start - timedelta(minutes=6)
                checked_in = True
        self.note(
            "bk_hs_sofia_today",
            "booking",
            "Right shoulder still tight after the move. Avoid the left calf, which she strained "
            "running.",
            self.at(-6, 11, 30),
        )

    def couples(self) -> None:
        """Last Valentine's couples massage and the next one, each with both therapists."""
        today = self.local(self.now).date()
        valentine = date(today.year if today.month > 2 else today.year - 1, 2, 14)
        while valentine.weekday() != 5:
            valentine -= timedelta(days=1)
        upcoming = today + timedelta(days=3)
        while upcoming.weekday() != 5:
            upcoming += timedelta(days=1)
        for key, day, done in (("valentine", valentine, True), ("couples", upcoming, False)):
            start = datetime.combine(day, time(11, 0), self.ctx.zone).astimezone(UTC)
            booked = min(start - timedelta(days=12), self.now - timedelta(days=2))
            for client_key, staff in (("leah", LEILA), ("aaron", JUN)):
                if not self.fits(staff, COUPLES, start):
                    raise ValueError(f"{key}: the couples massage does not fit {staff}'s calendar")
                booking = self.book(
                    f"{key}_{client_key}",
                    client_key,
                    COUPLES,
                    staff,
                    start,
                    "completed" if done else "confirmed",
                    booked,
                )
                self.deposit(booking, booked + timedelta(minutes=15))
                if done:
                    self.bill(booking, "card", tip=(staff, 2000))
        self.note(
            "bk_hs_couples_leah",
            "booking",
            "Couples room. Leah prefers medium pressure and no work on the feet; Aaron wants "
            "deep work on the shoulders. Both deposits are in.",
            self.now - timedelta(days=2),
        )

    def storyline(self) -> None:
        # a new client who booked online and sent her health history before the first visit
        start = self.place(LEILA, M60, 2, None, past=False)
        assert start is not None
        ananya = self.book(
            "ananya_first",
            "ananya",
            M60,
            LEILA,
            start,
            "confirmed",
            self.now - timedelta(days=2, hours=3),
            source="online",
        )
        ananya.confirmed_at = ananya.created_at + timedelta(hours=2)
        self.intake(
            "ananya",
            ananya,
            {
                "conditions": ["Migraines or frequent headaches"],
                "conditions_detail": "Tension headaches two or three times a week, usually by "
                "the end of the work day.",
                "medications": "Ibuprofen when I have a headache.",
                "injuries": "None.",
                "pressure": "Medium",
                "focus": "Neck and shoulders. I work at a laptop all day.",
                "claim": "Yes",
            },
            hours=5,
        )
        # a new client whose health history hasn't come back yet
        start = self.place(JUN, M60, 4, None, past=False)
        assert start is not None
        chloe = self.book(
            "chloe_first",
            "chloe",
            M60,
            JUN,
            start,
            "pending",
            self.now - timedelta(hours=6),
            source="online",
        )
        self.response("intake", "chloe", INTAKE, chloe, {}, None)
        # a late cancellation five hours before the visit, charged half the fee
        start = self.place(LEILA, M60, -3, None, past=True)
        assert start is not None
        late = self.book(
            "brendan_late", "brendan", M60, LEILA, start, "canceled", start - timedelta(days=8)
        )
        late.canceled_at = canceled = start - timedelta(hours=5)
        self.card("brendan", self.at(-200, 12), "Visa", "4242")
        invoice = self.invoice(
            "brendan_late",
            "brendan",
            start + timedelta(hours=1),
            start + timedelta(hours=1),
            "Late cancellation of a 60 minute massage, five hours before the visit. Half the fee "
            "is charged under our cancellation policy.",
        )
        day = self.local(start)
        self.ctx.add(
            Line(
                id=f"ln_{invoice.id}_0",
                business_id=HARBOURSIDE,
                invoice_id=invoice.id,
                description=f"Late cancellation fee, 60 minute massage on {day:%B} {day.day}",
                quantity=1,
                unit_amount_cents=6500,
                amount_cents=6500,
                tax_class="federal_only",
                position=0,
                created_at=invoice.created_at,
                updated_at=invoice.created_at,
            )
        )
        self.settle(invoice, "brendan", "card")
        self.note(
            late.id,
            "booking",
            f"Cancelled by text at {self.clock(canceled)} for the "
            f"{self.clock(start)} visit. Daughter home sick. Fee charged to the card on file; "
            "he has used this year's waiver already.",
            canceled,
        )
        rebooked = self.place(
            LEILA, M60, (start + timedelta(days=7) - self.now).days, None, past=False
        )
        assert rebooked is not None
        self.book(
            "brendan_rebooked",
            "brendan",
            M60,
            LEILA,
            rebooked,
            "confirmed",
            canceled + timedelta(minutes=40),
        )
        # a missed visit with no word
        self.visit("tyler_missed", "tyler", M60, JUN, -20, status="no_show", settle=None)
        self.visit("tyler_first", "tyler", M30, JUN, -48, settle="card")
        self.note(
            "bk_hs_tyler_missed",
            "booking",
            "No answer by phone or text. Sent the missed-visit fee notice.",
            self.at(-20, 18),
        )

    def packages(self) -> None:
        pack = self.package("kenji", PACK10, self.at(-160, 13))
        for index, day in enumerate((-150, -128, -104, -80, -52, -24, 6)):
            self.visit(f"kenji_{index}", "kenji", M60, JUN, day, package_id=pack.id)
        olivia = self.package("olivia", PACK5, self.at(-95, 15))
        for index, day in enumerate((-88, -60, -31)):
            self.visit(f"olivia_{index}", "olivia", M60, LEILA, day, package_id=olivia.id)
        amara = self.package("amara", PACK5, self.at(-42, 10))
        for index, day in enumerate((-35, -8, 12)):
            self.visit(f"amara_{index}", "amara", M60, JUN, day, package_id=amara.id)

    def gifts(self) -> None:
        today = self.local(self.now).date()
        december = date(today.year - 1, 12, 1)
        cards: dict[str, GiftCard] = {}
        for index, (purchaser, recipient, cents, redeemer) in enumerate(DECEMBER_GIFTS):
            bought = datetime.combine(
                december + timedelta(days=3 + index * 3), time(13, 15), self.ctx.zone
            ).astimezone(UTC)
            key = redeemer or f"{purchaser}_december"
            cards[key] = self.gift_card(key, purchaser, GIFT, cents, bought, recipient)
        for key, item_id, staff, weeks, cents in (
            ("lucas", M90, LEILA, 10, 19425),
            ("tina", ACU_FOLLOW, WEN, 6, 9500),
        ):
            card = cards[key]
            day = min((card.created_at + timedelta(weeks=weeks) - self.now).days, -3)
            visit = self.visit(f"{key}_gift", key, item_id, staff, day, settle=None)
            assert visit is not None and visit.completed_at is not None
            if visit.starts_at < card.created_at:
                raise ValueError(f"{key}: the gift card visit comes before the card was bought")
            self.redeem(card, cents, visit.completed_at + timedelta(minutes=10))
        self.note(
            "bk_hs_lucas_gift",
            "booking",
            "Paid with the gift card from Margaret Lau, $194.25 including GST. $5.75 left on it.",
            self.ctx.get(Booking, "bk_hs_lucas_gift").completed_at or self.now,
        )
        self.gift_card("elif_mothers_day", "elif", GIFT, 13000, self.at(-162, 16), "Ayse Yilmaz")

    def named_visits(self) -> None:
        for index, day in enumerate((-62, -34, -12, 14)):
            self.visit(f"navneet_{index}", "navneet", PRENATAL, LEILA, day, settle="card")
        for key, staff, item_id, day, tip in (
            ("fatemeh", LEILA, M90, -16, 2500),
            ("sofia", LEILA, M60, -27, 2000),
            ("margaret", LEILA, M60, -19, 1500),
            ("gwen", JUN, M60, -9, None),
            ("hiroshi", JUN, DEEP, -30, 2000),
            ("raj", JUN, M90, -40, None),
        ):
            self.visit(
                f"{key}_recent",
                key,
                item_id,
                staff,
                day,
                tip=(staff, tip) if tip else None,
            )
        self.visit("hiroshi_moved", "hiroshi", DEEP, JUN, 3)
        self.ctx.get(Booking, "bk_hs_hiroshi_moved").reschedule_count = 1
        daniel = self.visit("daniel_switch", "daniel", M90, JUN, -45)
        assert daniel is not None and daniel.invoice_id is not None
        paid = next(p for p in self.ctx.all(Payment) if p.invoice_id == daniel.invoice_id)
        assert paid.paid_at is not None
        self.refund(
            paid,
            5775,
            paid.paid_at + timedelta(hours=20),
            "Booked 90 minutes but had to leave after 60; refunded the difference",
        )
        for key, staff, day in (("elif", LEILA, -70), ("grace", LEILA, -110)):
            stones = self.visit(f"{key}_stones", key, HOTSTONE, staff, day, settle=None)
            assert stones is not None
            self.deposit(stones, stones.created_at + timedelta(minutes=10))
            self.bill(stones, "card")
        upcoming = self.visit("jessica_stones", "jessica", HOTSTONE, LEILA, 9)
        assert upcoming is not None
        self.deposit(upcoming, upcoming.created_at + timedelta(minutes=10))
        desk = self.visit("dev_desk", "dev", M60, JUN, -5, settle=None)
        assert desk is not None and desk.completed_at is not None
        self.sale(
            "dev",
            "dev",
            JUN,
            Quote(M60, ((HEAT, 1),)),
            desk,
            desk.created_at,
            desk.completed_at + timedelta(minutes=8),
        )

    def retail(self) -> None:
        """Oil and heat compresses added at checkout to some visits' invoices."""
        invoices = sorted(
            (i for i in self.ctx.all(Invoice) if i.id.startswith("inv_hs_fill_")),
            key=lambda i: i.id,
        )
        for index, invoice in enumerate(invoices):
            if index % 9 == 4:
                self.line(invoice.id, OIL, invoice.created_at, 1)
            elif index % 23 == 7:
                self.line(invoice.id, HEAT, invoice.created_at, 1)

    def intake(
        self, key: str, booking: Booking, answers: dict[str, object], *, hours: float
    ) -> None:
        client = self.ctx.get(Client, booking.client_id)
        index = sum(map(ord, key))
        submitted = min(
            booking.created_at + timedelta(hours=hours),
            booking.starts_at - timedelta(hours=2),
            self.now - timedelta(hours=1),
        )
        surname = client.name.split(" ", 1)[1]
        base: dict[str, object] = {
            "date_of_birth": date(1950 + index % 50, 1 + index % 12, 1 + index % 28).isoformat(),
            "emergency_name": ("Sam", "Alex", "Chris", "Jordan", "Robin", "Pat")[index % 6]
            + " "
            + surname,
            "emergency_phone": f"+17785550{160 + index % 30}",
            "conditions": ["None of these"],
            "pregnant": "No",
            "pressure": ("Medium", "Firm", "Light", "Medium", "Not sure yet")[index % 5],
            "claim": ("Yes", "Yes", "No", "Not sure")[index % 4],
            "consent": True,
        }
        self.response(
            "intake",
            key,
            INTAKE,
            booking,
            {**base, **answers},
            submitted,
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.61"},
        )

    def paperwork(self) -> None:
        """Each client's health history and policy on their first visit, and acupuncture consent."""
        firsts: dict[str, Booking] = {}
        for booking in sorted(self.ctx.all(Booking), key=lambda b: b.starts_at):
            if booking.status != "canceled":
                firsts.setdefault(booking.client_id, booking)
        for index, (client_id, booking) in enumerate(sorted(firsts.items())):
            key = client_id.removeprefix("cl_hs_")
            if key in {"ananya", "chloe"}:
                continue
            answers: dict[str, object] = dict(
                PROFILES.get(key, PROFILE_CYCLE[index % len(PROFILE_CYCLE)])
            )
            self.intake(key, booking, answers, hours=3 + index % 20)
        for index, (client_id, booking) in enumerate(sorted(firsts.items())):
            key = client_id.removeprefix("cl_hs_")
            if key == "chloe":
                self.sign(
                    "chloe_policy",
                    key,
                    POLICY,
                    booking.created_at + timedelta(minutes=10),
                    None,
                    status="pending",
                )
                continue
            signed = min(
                booking.created_at + timedelta(hours=2 + index % 5), self.now - timedelta(hours=2)
            )
            self.sign(f"{key}_policy", key, POLICY, signed, None)
        for key in ("harjit", *ACU_CLIENTS):
            initial = self.ctx.get(Booking, f"bk_hs_{key}_initial")
            self.sign(
                f"{key}_acupuncture",
                key,
                ACU_CONSENT,
                initial.created_at + timedelta(hours=1),
                None,
            )

    def treatment_notes(self) -> None:
        """SOAP notes the practitioners wrote after some visits, kept off devices with no token."""
        people = {person.staff_id: person for person in SPEC.people}
        for key, visit, minutes, answers in SOAP_NOTES:
            booking = self.ctx.get(Booking, f"bk_hs_{visit}")
            assert booking.completed_at is not None and booking.staff_id is not None
            person = people[booking.staff_id]
            written = booking.completed_at + timedelta(minutes=minutes)
            amends = NOTE_AMENDS.get(key)
            self.ctx.add(
                FormResponse(
                    id=f"fr_hs_soap_{key}",
                    business_id=self.spec.id,
                    form_id=SOAP,
                    client_id=booking.client_id,
                    parent_type="booking",
                    parent_id=booking.id,
                    status="submitted",
                    token=None,
                    answers=answers,
                    submitted_at=written,
                    signature={
                        "user_id": person.user_id,
                        "staff_id": person.staff_id,
                        "name": person.name,
                        "signed_at": written.isoformat(),
                        "amends": None if amends is None else f"fr_hs_soap_{amends}",
                    },
                    created_at=written,
                    updated_at=written,
                )
            )

    def feedback(self, key: str, booking: Booking, answers: dict[str, object]) -> None:
        assert booking.completed_at is not None
        submitted = min(booking.completed_at + timedelta(hours=7), self.now - timedelta(hours=1))
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
        self.withdraw("brendan", "email", self.now - timedelta(days=60))
        self.broadcast(
            "mothers_day",
            "Gift cards for Mother's Day",
            "Gift cards for Mother's Day are available at the front desk, by phone at "
            "778-555-0190, or by replying to this email. They come in any amount, can be used "
            "for massage or acupuncture with any of us, and don't expire. If you'd like the card "
            "sent straight to the recipient, tell us their email and we'll include a short note "
            "from you.",
            self.at(-170, 10),
        )
        ctx = self.ctx
        self.feedback(
            "fatemeh",
            ctx.get(Booking, "bk_hs_fatemeh_recent"),
            {
                "rating": 5,
                "liked": "Leila found the knot under my shoulder blade that's bothered me for "
                "months and showed me a stretch for it. The receipt went straight to my email "
                "with everything my insurance asked for.",
                "recommend": "Yes",
            },
        )
        self.feedback(
            "gwen",
            ctx.get(Booking, "bk_hs_gwen_recent"),
            {
                "rating": 4,
                "liked": "Jun was great with my lower back and checked the pressure often.",
                "improve": "The room was cold, especially at the start when I was face down. A "
                "warmer room or a heated blanket would help.",
                "recommend": "Yes",
            },
        )
        for key in ("kenji_5", "margaret_recent", "sofia_recent", "navneet_2", "hiroshi_recent"):
            client_key = key.split("_", 1)[0]
            self.feedback(
                client_key,
                ctx.get(Booking, f"bk_hs_{key}"),
                {"rating": 5, "recommend": "Yes"},
            )
        for key in (
            "fatemeh_recent",
            "gwen_recent",
            "kenji_5",
            "margaret_recent",
            "sofia_recent",
            "navneet_2",
            "hiroshi_recent",
            "raj_recent",
            "daniel_switch",
            "harjit_initial",
        ):
            self.review(key)
        self.conversations()

    def conversations(self) -> None:
        ctx = self.ctx
        ananya = ctx.get(Booking, "bk_hs_ananya_first")
        when = ananya.created_at + timedelta(hours=6)
        thread = self.thread("ananya", "email", when)
        self.say(
            thread,
            "Hi, I've filled in the health history form. Is there parking nearby, and should I "
            "bring my insurance card?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Ananya, we have your form. There's pay parking under the building, with "
            "the entrance on Bute Street. You don't need your card: we'll email a receipt with "
            "Leila's registration number after the visit so you can claim it.",
            when + timedelta(minutes=40),
        )
        late = ctx.get(Booking, "bk_hs_brendan_late")
        canceled = late.canceled_at or late.starts_at
        thread = self.thread("brendan", "sms", canceled)
        self.say(
            thread,
            f"Hi, it's Brendan. I need to cancel my {self.clock(late.starts_at)} with Leila "
            "today, my daughter's home sick. Sorry for the short notice.",
            canceled,
            sender=None,
        )
        self.say(
            thread,
            "Sorry to hear that, Brendan, and I hope she feels better soon. Because it's inside "
            "24 hours, half the fee ($65 plus GST) goes to the card on file. Would you like to "
            "rebook for next week?",
            canceled + timedelta(minutes=20),
        )
        self.say(
            thread,
            "Yes please, the same time next week if it's open.",
            canceled + timedelta(minutes=34),
            sender=None,
        )
        navneet = ctx.get(Booking, "bk_hs_navneet_0")
        when = navneet.created_at - timedelta(hours=3)
        thread = self.thread("navneet", "sms", when)
        self.say(
            thread,
            "Hello, I'm 18 weeks pregnant. Is massage safe at this stage, and will I need to "
            "lie on my stomach?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Navneet, yes, from the second trimester on is a good time to start. You'll lie "
            "on your side with pillows, never on your stomach. Leila does most of our prenatal "
            "visits. Shall I book you in?",
            when + timedelta(minutes=25),
        )
        moved = ctx.get(Booking, "bk_hs_hiroshi_moved")
        when = min(moved.created_at + timedelta(days=1), self.now - timedelta(hours=4))
        local = self.local(moved.starts_at)
        thread = self.thread("hiroshi", "sms", when)
        self.say(
            thread,
            "Could I move my deep tissue with Jun to later in the week? Something came up at work.",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"No problem, Hiroshi. You're now booked with Jun on {local:%A, %B} {local.day} at "
            f"{self.clock(moved.starts_at)}.",
            when + timedelta(minutes=15),
        )
        gwen = ctx.get(Booking, "bk_hs_gwen_recent")
        assert gwen.completed_at is not None
        when = min(gwen.completed_at + timedelta(days=1, hours=2), self.now - timedelta(hours=1))
        thread = self.thread("gwen", "email", when)
        self.say(
            thread,
            "Hi Gwen, thank you for the feedback about the room. You're right that it was cold "
            "that morning; the heat comes on late in that room. We've added a heated pad to "
            "every table and now turn the heat on half an hour before the first visit. Jun "
            "says hello.",
            when,
            sender=HARBOURSIDE_OWNER,
        )
        self.say(
            thread,
            "Thanks Leila, that's good to hear. See you next month.",
            when + timedelta(hours=3),
            sender=None,
        )
        kenji = ctx.get(Booking, "bk_hs_kenji_5")
        assert kenji.completed_at is not None
        when = kenji.completed_at + timedelta(days=2)
        thread = self.thread("kenji", "email", when)
        self.say(
            thread,
            "Hi, my insurer asked for a receipt that shows the therapist's registration number "
            "for my last visit. Can you send one?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Kenji, visits on your 10-pack are paid in advance, so there's no receipt for "
            "each one. I've attached the package receipt and a note with each visit date and "
            "Jun's registration number, which most insurers accept.",
            when + timedelta(hours=1),
        )
        fatemeh = ctx.get(Booking, "bk_hs_fatemeh_recent")
        assert fatemeh.completed_at is not None
        when = fatemeh.completed_at + timedelta(days=3)
        thread = self.thread("fatemeh", "sms", when)
        self.say(
            thread,
            "Thank you for fitting me in last week. The stretch Leila showed me is helping, "
            "and I'd like to book again in a month.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Glad it's helping, Fatemeh. I'll text you a few times for next month.",
            when + timedelta(minutes=30),
        )


PROFILES: dict[str, dict[str, object]] = {
    "navneet": {
        "pregnant": "Yes",
        "pregnancy_weeks": 18,
        "conditions": ["None of these"],
        "focus": "Lower back and hips. My midwife suggested massage.",
        "avoid": "The abdomen.",
        "pressure": "Light",
    },
    "harjit": {
        "conditions": ["High blood pressure", "Diabetes"],
        "conditions_detail": "Both well controlled. I check my sugar every morning.",
        "medications": "Metformin and ramipril.",
        "injuries": "Fall on the ice last January; lower back pain since.",
        "focus": "Lower back pain, and sleep.",
    },
    "kenji": {
        "conditions": ["Arthritis"],
        "conditions_detail": "Some arthritis in both knees.",
        "focus": "Upper back and neck from cycling. I ride to work every day.",
        "pressure": "Firm",
    },
    "margaret": {
        "conditions": ["Osteoporosis"],
        "conditions_detail": "Diagnosed three years ago. Please go gently on the spine.",
        "medications": "Calcium and vitamin D.",
        "pressure": "Light",
    },
    "sofia": {
        "focus": "Shoulders and calves. I run three times a week.",
        "injuries": "Left calf strain in March.",
        "avoid": "The left calf until it heals.",
    },
    "gwen": {"focus": "Lower back.", "medications": "None."},
    "fatemeh": {
        "conditions": ["Migraines or frequent headaches"],
        "focus": "Neck and the knot under my right shoulder blade.",
    },
}
PROFILE_CYCLE: tuple[dict[str, object], ...] = (
    {"focus": "Neck and shoulders from desk work."},
    {"focus": "General relaxation.", "avoid": "The feet."},
    {
        "conditions": ["High blood pressure"],
        "medications": "Amlodipine.",
        "focus": "Lower back after gardening.",
    },
    {"injuries": "Rotator cuff repair, 2023.", "focus": "Right shoulder mobility."},
    {"focus": "Hips and legs; I'm training for the half marathon."},
    {
        "conditions": ["Skin condition or allergy to oils"],
        "conditions_detail": "Nut allergy, so no almond oil please.",
        "focus": "Upper back.",
    },
    {"focus": "Jaw and neck tension.", "medications": "None."},
    {"conditions": ["Arthritis"], "focus": "Hands and forearms; I'm a pianist."},
)

EDITION = Harbourside
