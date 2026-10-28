"""Riverbend Driving School: a five-person driving school in Winnipeg, on the demo engine."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.core.locale import SOURCE_LOCALE, plural
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item, ItemKind, TaxClass
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, BookingStatus, Recurrence, Slot
from clientbridge.schemas.subjects import StudentAttributes
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

RIVERBEND = "bz_riverbend"
RIVERBEND_OWNER = "us_rb_owner"

BOSS, MARCUS, JASMINE, ARJUN, PAUL = (
    "st_rb_owner",
    "st_rb_marcus",
    "st_rb_jasmine",
    "st_rb_arjun",
    "st_rb_paul",
)
LESSON, MANUAL, HIGHWAY, PARKING, ASSESSMENT, ROAD_TEST = (
    "it_rb_lesson_auto",
    "it_rb_lesson_manual",
    "it_rb_highway",
    "it_rb_parallel",
    "it_rb_assessment",
    "it_rb_roadtest",
)
TEN_AUTO, TEN_MANUAL, CLASSROOM, MAGNET, GIFT = (
    "it_rb_ten_auto",
    "it_rb_ten_manual",
    "it_rb_classroom",
    "it_rb_magnet",
    "it_rb_gift",
)
REGISTRATION_FORM, FEEDBACK_FORM = "frm_rb_registration", "frm_rb_feedback"
AGREEMENT = "con_rb_agreement"
# the instructors who teach in the two automatics; Jasmine teaches in the manual Golf
AUTOMATIC = (BOSS, MARCUS, ARJUN)
COROLLA, CIVIC, GOLF = "rs_rb_corolla", "rs_rb_civic", "rs_rb_golf"
CARS: tuple[tuple[str, str], ...] = (
    (COROLLA, "Corolla · auto · ABC 123"),
    (CIVIC, "Civic · auto · DEF 456"),
    (GOLF, "Golf · manual · GHI 789"),
)

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        LESSON,
        "service",
        "Driving lesson, automatic",
        6500,
        60,
        "Lessons",
        "An hour behind the wheel in a dual-brake automatic, picked up and dropped off at home, "
        "school or work in Winnipeg. Bring your learner's licence to every lesson.",
    ),
    (
        MANUAL,
        "service",
        "Driving lesson, manual",
        7000,
        60,
        "Lessons",
        "An hour with Jasmine in the dual-brake manual Golf: the clutch, starting on hills and "
        "smooth shifting, then everyday driving once it clicks.",
    ),
    (
        HIGHWAY,
        "service",
        "Highway lesson, automatic",
        9500,
        90,
        "Lessons",
        "Ninety minutes on the Perimeter Highway and Bishop Grandin: merging, lane changes, "
        "passing and exits. For students who are comfortable on city streets.",
    ),
    (
        PARKING,
        "service",
        "Parking practice",
        5000,
        45,
        "Lessons",
        "Forty-five minutes on parallel parking, reversing into a stall and hill parking, in a "
        "quiet lot and then on the street.",
    ),
    (
        ASSESSMENT,
        "service",
        "Refresher assessment",
        7500,
        60,
        "Lessons",
        "For licensed drivers who are new to Manitoba or getting back behind the wheel: an hour "
        "on the road with a written summary of what to practise.",
    ),
    (
        ROAD_TEST,
        "service",
        "Road test package",
        17500,
        120,
        "Road test",
        "A warm-up lesson on the test area's streets, the use of the school's car for your "
        "road test, and the drive home. The test fee is paid separately. A $50 deposit holds "
        "the date.",
    ),
    (
        TEN_AUTO,
        "package",
        "10 lessons, automatic",
        59000,
        None,
        "Packages",
        "Ten one-hour automatic lessons for one student, to use within a year. Save $60 over "
        "single lessons.",
    ),
    (
        TEN_MANUAL,
        "package",
        "10 lessons, manual",
        64000,
        None,
        "Packages",
        "Ten one-hour manual lessons with Jasmine for one student, to use within a year. Save "
        "$60 over single lessons.",
    ),
    (
        CLASSROOM,
        "class",
        "Classroom course",
        14900,
        150,
        "Courses",
        "Four Tuesday evenings at our office on the rules of the road, sharing the road with "
        "cyclists and transit, winter driving and getting ready for the road test. Up to 12 "
        "students. Enrol once for all four evenings.",
    ),
    (
        MAGNET,
        "product",
        "Student driver magnet",
        1500,
        None,
        "Supplies",
        "A reflective magnetic sign for the back of the family car, so other drivers give a "
        "learner some room.",
    ),
    (
        GIFT,
        "gift",
        "Gift card",
        0,
        None,
        "Gift cards",
        "A gift card for lessons or the road test package. We text the code, and it doesn't "
        "expire.",
    ),
)
COLORS = {
    LESSON: "#2B6E62",
    MANUAL: "#8A5A2B",
    HIGHWAY: "#3B5E8C",
    PARKING: "#6B7F3A",
    ASSESSMENT: "#5E5A8C",
    ROAD_TEST: "#B07A2A",
    CLASSROOM: "#7A3F5A",
}
# the cars each service can take; parking practice goes out in whichever car is free
POOLS: dict[str, tuple[str, ...]] = {
    LESSON: (COROLLA, CIVIC),
    HIGHWAY: (COROLLA, CIVIC),
    ASSESSMENT: (COROLLA, CIVIC),
    ROAD_TEST: (COROLLA, CIVIC),
    MANUAL: (GOLF,),
    PARKING: (COROLLA, CIVIC, GOLF),
}
STAFF: dict[str, tuple[str, ...]] = {
    LESSON: AUTOMATIC,
    HIGHWAY: AUTOMATIC,
    MANUAL: (JASMINE,),
    ASSESSMENT: (BOSS, MARCUS),
    CLASSROOM: (BOSS,),
}
TAX: dict[ItemKind, TaxClass] = {"product": "standard", "gift": "exempt"}
COURSE_EVENINGS, COURSE_AT, COURSE_WEEKDAY = 4, time(18, 0), 1
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {
        0: (time(9, 0), time(17, 0)),
        1: (time(12, 0), time(21, 0)),
        2: (time(9, 0), time(17, 0)),
        3: (time(12, 0), time(20, 0)),
        4: (time(9, 0), time(17, 0)),
    },
    MARCUS: {**{d: (time(10, 0), time(19, 0)) for d in range(5)}, 5: (time(9, 0), time(15, 0))},
    JASMINE: {d: (time(9, 0), time(18, 0)) for d in range(1, 6)},
    ARJUN: {
        0: (time(15, 0), time(20, 0)),
        2: (time(15, 0), time(20, 0)),
        4: (time(15, 0), time(20, 0)),
        6: (time(9, 0), time(15, 0)),
    },
}
PICKUP_MIN = 15
MISSED_FEE = 6500
AGREEMENT_BODY = "\n\n".join(
    (
        "This agreement covers lessons, courses and road test packages from Riverbend Driving "
        "School. It is demo text for a fictional business, not legal advice.",
        "Your licence\nBring a valid Manitoba learner's licence or a higher class of licence "
        "to every lesson. We can't start a lesson without it, and the lesson is charged.",
        "Students under 18\nA parent or guardian signs this agreement and books for the student. "
        "We pick up and drop off at the address on the booking, such as home or school.",
        "The car\nLessons are in one of the school's three dual-brake cars. Manual lessons are "
        "with Jasmine in the Golf, and automatic lessons are with Linda, Marcus or Arjun in the "
        "Corolla or the Civic. The instructor can end a lesson if it isn't safe to continue.",
        "Weather\nLessons go ahead in snow, because winter driving is part of learning in "
        "Winnipeg. We cancel at no charge for freezing rain or a storm warning.",
        "Moving or cancelling\nYou can move or cancel a lesson at no charge up to 24 hours "
        "before it starts. A later cancellation, or a lesson where the student isn't at the "
        "pickup within 15 minutes, is charged in full.",
        "Packages\nA 10-lesson package belongs to one student and is valid for a year. Unused "
        "lessons can be refunded at the single-lesson price for the lessons used.",
        "Road tests\nThe road test fee is paid to the testing office. If the test is cancelled "
        "for weather or by the examiner, we move your package to the new date.",
        "Payment\nLessons are charged to the card on file after each lesson, or paid by "
        "Tap to Pay in the car or by e-Transfer within 7 days.",
    )
)
REGISTRATION_FIELDS: tuple[DocField, ...] = (
    ("student_name", "text", "Student's name", None, True, ()),
    ("birthday", "date", "Student's date of birth", None, True, ()),
    (
        "licence",
        "select",
        "Licence",
        None,
        True,
        (
            "Learner (Class 5L)",
            "Intermediate (Class 5I)",
            "Full (Class 5F)",
            "Licence from another country",
            "No licence yet",
        ),
    ),
    ("learner_since", "date", "Learner's licence issued", None, False, ()),
    ("transmission", "select", "Transmission", None, True, ("Automatic", "Manual")),
    (
        "experience",
        "select",
        "Driving so far",
        None,
        True,
        (
            "None",
            "A few hours with family",
            "Comfortable on quiet streets",
            "Licensed elsewhere",
        ),
    ),
    ("pickup", "address", "Where should we pick you up?", None, True, ()),
    (
        "guardian",
        "text",
        "Parent or guardian, if under 18",
        "Name and phone number.",
        False,
        (),
    ),
    ("glasses", "checkbox", "Needs glasses or contacts to drive", None, False, ()),
    (
        "goals",
        "multiselect",
        "What would you like to work on?",
        None,
        False,
        (
            "Pass the road test",
            "Highway driving",
            "Winter driving",
            "Parking",
            "Confidence after a break",
        ),
    ),
    ("notes", "longtext", "Anything else we should know?", None, False, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your lesson?", None, True, ()),
    (
        "highlights",
        "multiselect",
        "What went well?",
        None,
        False,
        ("Patient instructor", "Clear explanations", "On time", "Felt safe", "Road test ready"),
    ),
    ("comments", "longtext", "Anything we could do better?", None, False, ()),
    ("follow_up", "checkbox", "You can contact me about this", None, False, ()),
)


@dataclass(frozen=True)
class Student:
    name: str
    age: int
    school: str | None = None
    grade: int | None = None
    manual: bool = False
    note: str | None = None


@dataclass(frozen=True)
class Household:
    """A client and the students they book for; an adult student is their own client."""

    key: str
    name: str
    pickup: str
    students: tuple[Student, ...] = ()
    note: str | None = None

    def learners(self) -> tuple[Student, ...]:
        return self.students or (Student(self.name, 0),)


KELVIN, GARDEN_CITY, MASSEY, ST_PAULS, LOUIS_RIEL = (
    "Kelvin High School",
    "Garden City Collegiate",
    "Vincent Massey Collegiate",
    "St. Paul's High School",
    "Collège Louis-Riel",
)
DAKOTA, SISLER, SHAFTESBURY, GLENLAWN, MAPLES = (
    "Dakota Collegiate",
    "Sisler High School",
    "Shaftesbury High School",
    "Glenlawn Collegiate",
    "Maples Collegiate",
)
NAMED = (
    Household(
        "ramos",
        "Angela Ramos",
        "142 Jefferson Avenue, Winnipeg, MB R2V 0M3",
        (Student("Bianca Ramos", 16, GARDEN_CITY, 11),),
    ),
    Household(
        "bergen",
        "Karen Bergen",
        "415 Waterloo Street, Winnipeg, MB R3N 0S9",
        (
            Student(
                "Noah Bergen",
                17,
                KELVIN,
                12,
                note="Learner since February. Confident in the city; working on highway merges "
                "and the Perimeter before his road test.",
            ),
        ),
    ),
    Household(
        "tanaka",
        "Hiroshi Tanaka",
        "67 Brock Street, Winnipeg, MB R3N 0Y5",
        (
            Student(
                "Aiko Tanaka",
                17,
                MASSEY,
                12,
                manual=True,
                note="Learning on a manual because the family car is one. Stalls less each week; "
                "hill starts on Academy Road next.",
            ),
            Student(
                "Ken Tanaka", 16, MASSEY, 11, note="Learner since August. Nervous on left turns."
            ),
        ),
    ),
    Household("emma", "Emma Sigurdson", "88 Lipton Street, Winnipeg, MB R3G 2G5"),
    Household(
        "patel",
        "Meera Patel",
        "1250 Kenaston Boulevard, Winnipeg, MB R3P 0R7",
        (
            Student(
                "Rohan Patel",
                18,
                ST_PAULS,
                12,
                note="Road test booked at the Gateway test centre. Practise the route on Gateway "
                "Road and the school zone on Springfield Road.",
            ),
        ),
    ),
    Household("sophie", "Sophie Lambert", "305 Provencher Boulevard, Winnipeg, MB R2H 0G9"),
    Household(
        "dmytro",
        "Dmytro Kovalenko",
        "Suite 804, 55 Nassau Street North, Winnipeg, MB R3L 2G8",
        note="Licensed in Ukraine for 12 years; converting to a Manitoba licence.",
    ),
    Household(
        "dueck",
        "Tanya Dueck",
        "27 Tellier Place, Winnipeg, MB R2C 1V7",
        (Student("Caleb Dueck", 16, SHAFTESBURY, 11),),
    ),
    Household("amir", "Amir Rahimi", "Suite 1103, 300 Assiniboine Avenue, Winnipeg, MB R3C 4P2"),
    Household(
        "okonkwo",
        "Grace Okonkwo",
        "19 Bridgeland Drive North, Winnipeg, MB R3Y 0B5",
        (Student("Chiamaka Okonkwo", 17, DAKOTA, 12),),
    ),
    Household(
        "chartrand",
        "Mark Chartrand",
        "540 Rue Langevin, Winnipeg, MB R2H 2W7",
        (Student("Luc Chartrand", 16, LOUIS_RIEL, 11),),
    ),
    Household(
        "fontaine",
        "Nicole Fontaine",
        "212 Glenlawn Avenue, Winnipeg, MB R2M 0Y5",
        (Student("Zoé Fontaine", 16, GLENLAWN, 11),),
    ),
    Household("lin", "Lin Zhao", "Suite 1506, 1 Evergreen Place, Winnipeg, MB R3L 0E9"),
    Household("lena", "Lena Hofer", "730 Banning Street, Winnipeg, MB R3E 2J1"),
    Household(
        "alvarez",
        "Ricardo Alvarez",
        "1165 Burrows Avenue, Winnipeg, MB R2X 2H9",
        (Student("Mateo Alvarez", 17, SISLER, 12),),
    ),
    Household("navjot", "Navjot Brar", "18 Templeton Avenue, Winnipeg, MB R2V 3P9"),
    Household(
        "thiessen",
        "Shawn Thiessen",
        "96 Garden Grove Drive, Winnipeg, MB R2R 0A6",
        (Student("Brayden Thiessen", 17, MAPLES, 12),),
    ),
    Household("donald", "Donald Bergen", "Suite 210, 1015 Wilkes Avenue, Winnipeg, MB R3P 2R8"),
)
# generated students: a parent and teen, or an adult learning on their own
PARENTS = (
    ("Jennifer", "Klassen", "Ethan"),
    ("Rajesh", "Kumar", "Anika"),
    ("Michelle", "Bouchard", "Gabriel"),
    ("Joseph", "Mensah", "Ama"),
    ("Kristine", "Dela Cruz", "Miguel"),
    ("Brent", "Wiebe", "Kaylee"),
    ("Olena", "Shevchuk", "Maksym"),
    ("Darren", "McKay", "Owen"),
    ("Priya", "Singh", "Simran"),
    ("Lisa", "Penner", "Hannah"),
    ("Samuel", "Abebe", "Liya"),
    ("Carmen", "Ortega", "Diego"),
)
ADULTS = (
    ("Jordan", "Harper"),
    ("Mariam", "Haidari"),
    ("Kevin", "Tran"),
    ("Rachel", "Goertzen"),
    ("Femi", "Adeyemi"),
    ("Isabel", "Santos"),
    ("Tyler", "Neufeld"),
    ("Hana", "Yusuf"),
    ("Chris", "Lavallee"),
    ("Mei", "Wong"),
    ("Daniel", "Sawatzky"),
    ("Ayesha", "Khan"),
)
STREETS = (
    ("Corydon Avenue", "R3M 0X6"),
    ("St. Mary's Road", "R2M 3L7"),
    ("Henderson Highway", "R2G 1M4"),
    ("Pembina Highway", "R3T 2E6"),
    ("Portage Avenue", "R3J 0A1"),
    ("McPhillips Street", "R2V 3C5"),
    ("Regent Avenue West", "R2C 1R3"),
    ("Grant Avenue", "R3N 0E2"),
    ("Main Street", "R2W 3N4"),
    ("Ness Avenue", "R3J 0Z3"),
)
SCHOOLS = (KELVIN, GARDEN_CITY, MASSEY, ST_PAULS, DAKOTA, SISLER, SHAFTESBURY, GLENLAWN)
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cash", "card")
# running course students, and those enrolled for the next one
COURSE_NOW = ("okonkwo", "chartrand", "alvarez", "teen_01", "teen_04", "teen_07")
COURSE_NEXT = ("fontaine", "dueck", "teen_10")
# who still owes for the running course, after its first evening
COURSE_OWING = "alvarez"
PHOTO_CLIENTS = (
    "ramos",
    "bergen",
    "tanaka",
    "emma",
    "patel",
    "sophie",
    "dmytro",
    "dueck",
    "amir",
    "okonkwo",
    "chartrand",
    "fontaine",
    "lin",
    "lena",
    "alvarez",
    "navjot",
    "donald",
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    package = kind == "package"
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        # lessons and courses carry GST only; Manitoba's RST applies to the magnet
        tax_class=TAX.get(kind, "federal_only"),
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=item_id in {LESSON, MANUAL, HIGHWAY, PARKING, ASSESSMENT, CLASSROOM},
        sell_online=item_id == MAGNET,
        capacity=12 if item_id == CLASSROOM else None,
        addon_for=(LESSON, MANUAL) if item_id == MAGNET else (),
        staff=STAFF.get(item_id, ()),
        resources=POOLS.get(item_id, ()),
        buffer_after_min=PICKUP_MIN if kind == "service" else 0,
        deposit_type="fixed" if item_id == ROAD_TEST else "none",
        deposit_value=5000 if item_id == ROAD_TEST else None,
        sessions=10 if package else COURSE_EVENINGS if item_id == CLASSROOM else None,
        covers=(LESSON if item_id == TEN_AUTO else MANUAL) if package else None,
        validity_days=365 if package else None,
        ref=("ten_auto" if item_id == TEN_AUTO else "ten_manual") if package else None,
        sku="RB-MAGNET" if item_id == MAGNET else None,
        cost_cents=450 if item_id == MAGNET else None,
        stock=Stock(22, 8) if item_id == MAGNET else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(RIVERBEND),
    code="rb",
    slug="riverbend",
    login_domain="riverbend.example",
    owner=RIVERBEND_OWNER,
    people=(
        Person(
            RIVERBEND_OWNER,
            BOSS,
            "owner",
            "Linda Friesen",
            "+12045550193",
            "owner",
            "Owner · Instructor",
            "#2B6E62",
            HOURS[BOSS],
        ),
        Person(
            "us_rb_marcus",
            MARCUS,
            "marcus",
            "Marcus Okafor",
            "+12045550194",
            "staff",
            "Instructor",
            "#3B5E8C",
            HOURS[MARCUS],
            payee=True,
            rate_type="percent",
            rate_bps=4500,
        ),
        Person(
            "us_rb_jasmine",
            JASMINE,
            "jasmine",
            "Jasmine Santos",
            "+12045550195",
            "staff",
            "Instructor · Manual",
            "#8A5A2B",
            HOURS[JASMINE],
            payee=True,
            rate_type="hourly",
            rate_cents=3000,
        ),
        Person(
            "us_rb_arjun",
            ARJUN,
            "arjun",
            "Arjun Mehta",
            "+12045550196",
            "staff",
            "Instructor",
            "#6B7F3A",
            HOURS[ARJUN],
            payee=True,
            rate_type="hourly",
            rate_cents=2800,
        ),
        Person(
            "us_rb_paul",
            PAUL,
            "paul",
            "Paul Desrochers",
            "+12045550197",
            "admin",
            "Office manager",
            "#5E5A8C",
            bookable_online=False,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Driving lessons in Winnipeg for teens and adults, in automatic or manual.",
        "about": (
            "Riverbend Driving School is a team of four instructors and an office manager in "
            "St. Boniface. We teach in three dual-brake cars, two automatics and a manual, and "
            "pick students up at home, school or work. We teach new drivers "
            "and adults new to Manitoba, run a four-evening classroom course, and take students "
            "to their road test in the car they learned in."
        ),
        "address": "180 Provencher Boulevard, Winnipeg, MB R2H 0G3",
        "phone": "+1 204-555-0198",
        "email": "hello@riverbend.example",
        "neighbourhood": "St. Boniface",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject="student",
    sms_number="+12045550199",
    gst_hst_number="719384265RT0001",
    pst_number="PST48217365",
    forms=(
        FormSpec(
            REGISTRATION_FORM,
            "Student registration",
            "ff_rb_registration_",
            REGISTRATION_FIELDS,
            send_on="booking",
        ),
        FormSpec(FEEDBACK_FORM, "Lesson feedback", "ff_rb_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(ContractSpec(AGREEMENT, "Lesson agreement", AGREEMENT_BODY, created_day=-480),),
    resources=CARS,
    storyline=(
        Stage(
            "New teen student booked online, registration in, waiting for approval",
            "ramos",
            ("bk_rb_ramos", "fr_rb_registration_ramos"),
        ),
        Stage(
            "Partway through a 10-lesson pack on a weekly series",
            "bergen",
            ("pkg_rb_ten_auto_bergen", "sch_rb_bergen"),
        ),
        Stage(
            "Two siblings, each with their own pack",
            "tanaka",
            ("pkg_rb_ten_manual_aiko", "pkg_rb_ten_auto_ken"),
        ),
        Stage(
            "Today's lessons: in the car, instructor on the way, later today",
            "lena",
            ("bk_rb_lena", "bk_rb_navjot", "bk_rb_emma"),
        ),
        Stage(
            "Both automatics out, so Arjun's free hour can't be booked",
            "teen_00",
            ("bk_rb_both_cars_linda", "bk_rb_both_cars_marcus", COROLLA, CIVIC),
        ),
        Stage(
            "Road test package booked, deposit paid",
            "patel",
            ("bk_rb_rohan_roadtest",),
        ),
        Stage(
            "Road test passed, five-star feedback and a review request",
            "sophie",
            ("bk_rb_sophie_roadtest", "fr_rb_feedback_sophie"),
        ),
        Stage(
            "Classroom course halfway through, one balance overdue",
            "alvarez",
            ("sch_rb_course", f"inv_rb_course_{COURSE_OWING}"),
        ),
        Stage("Next classroom course enrolling", "fontaine", ("sch_rb_course_next",)),
        Stage("Newcomer's refresher assessment, paid by Tap to Pay", "dmytro", ("ord_rb_dmytro",)),
        Stage(
            "Missed lesson charged in full, invoice overdue",
            "thiessen",
            ("bk_rb_brayden_missed", "inv_rb_brayden_missed"),
        ),
        Stage("Lesson cut short, half refunded", "amir", ("inv_rb_amir_highway",)),
        Stage("Four-star feedback about a late pickup", "dueck", ("fr_rb_feedback_caleb",)),
        Stage("Gift card from a grandparent, used for a highway lesson", "donald", ("gc_rb_noah",)),
    ),
    pacing=Pacing(
        {MARCUS: 12, JASMINE: 6, ARJUN: 6, BOSS: 4},
        (LESSON, LESSON, HIGHWAY, LESSON, PARKING, LESSON),
        staff_services={JASMINE: (MANUAL, MANUAL, PARKING, MANUAL)},
        weeks=30,
        ahead_weeks=4,
        seasonality={1: 0.8, 2: 0.85, 3: 0.95, 4: 1.05, 5: 1.1, 6: 1.15, 7: 1.2, 8: 1.2, 12: 0.7},
        settlements=SETTLEMENTS,
        cancel_every=41,
    ),
    photo_clients=PHOTO_CLIENTS,
    inbox_user="us_rb_paul",
    founded_day=-1100,
    catalog_day=-480,
    documents_day=-480,
    restock_days=(-480, -360, -240, -120, -40),
    payouts_from_day=-210,
    invoice_start=3600,
    estimate_start=100,
    cheque_start=900,
    seed=41,
)


# student -> instructor, weekday, start, visits, visits already done, package
SERIES: dict[str, tuple[str, int, time, int, int, str]] = {
    "bergen": (MARCUS, 5, time(10, 0), 10, 6, TEN_AUTO),
    "aiko": (JASMINE, 3, time(16, 30), 10, 4, TEN_MANUAL),
    "ken": (ARJUN, 6, time(10, 0), 10, 3, TEN_AUTO),
}


def _clock(when: datetime) -> str:
    return f"{when:%I:%M %p}".removeprefix("0")


def _generated() -> list[Household]:
    found: list[Household] = []
    for index, (first, last, kid) in enumerate(PARENTS):
        street, postal = STREETS[index % len(STREETS)]
        found.append(
            Household(
                f"teen_{index:02}",
                f"{first} {last}",
                f"{120 + (index * 157) % 2400} {street}, Winnipeg, MB {postal}",
                (
                    Student(
                        f"{kid} {last}",
                        16 + index % 2,
                        SCHOOLS[index % len(SCHOOLS)],
                        11 + index % 2,
                        manual=index % 4 == 3,
                    ),
                ),
            )
        )
    for index, (first, last) in enumerate(ADULTS):
        street, postal = STREETS[(index + 4) % len(STREETS)]
        found.append(
            Household(
                f"adult_{index:02}",
                f"{first} {last}",
                f"{210 + (index * 233) % 2600} {street}, Winnipeg, MB {postal}",
            )
        )
    return found


class Riverbend(Demo):
    spec = SPEC

    def story(self) -> None:
        self.students()
        self.courses()
        self.regulars()
        self.today_lessons()
        self.both_cars_out()
        self.storyline()
        self.routine()
        self.paperwork()
        self.engagement()

    def finish(self) -> None:
        super().finish()
        self.portraits()

    def visit_note(self, item: Item, booking: Booking) -> str:
        student = self.ctx.get(Subject, booking.subject_id or "").name
        return f"{item.name} for {student}."

    def learner(self, key: str) -> str:
        """The subject id of a student, named by their household or by their first name."""
        for household in (*NAMED, *_generated()):
            for index, student in enumerate(household.learners()):
                first = student.name.split()[0].lower()
                if key in {household.key if index == 0 else "", first}:
                    return self.subject_key(household, index)
        raise KeyError(key)

    def subject_key(self, household: Household, index: int) -> str:
        return f"sj_rb_{household.key}" if index == 0 else f"sj_rb_{household.key}_{index}"

    def household_of(self, subject_id: str) -> str:
        return self.ctx.get(Subject, subject_id).client_id.removeprefix("cl_rb_")

    def students(self) -> None:
        today = self.local(self.now).date()
        for number, household in enumerate((*NAMED, *_generated())):
            self.client(
                household.key,
                household.name,
                f"+1204555{100 + number:04}",
                fields={"source": ("google", "referral", "school newsletter")[number % 3]},
            )
            for index, student in enumerate(household.learners()):
                adult = not household.students
                age = student.age or 22 + number % 15
                birthday = date(today.year - age, 1 + (number * 5 + index) % 12, 1 + number % 27)
                attributes = StudentAttributes(
                    birthday=birthday,
                    grade=None if student.grade is None else f"Grade {student.grade}",
                    school=student.school,
                ).model_dump(mode="json", exclude_none=True)
                key = household.key if index == 0 else f"{household.key}_{index}"
                self.subject(
                    key, household.key, household.name if adult else student.name, attributes
                )
                note = student.note or (household.note if adult else None)
                if note:
                    self.note(self.subject_key(household, index), "subject", note, self.at(-40, 11))

    def pickup(self, booking: Booking) -> str:
        household = next(
            h for h in (*NAMED, *_generated()) if self.client_id(h.key) == booking.client_id
        )
        return household.pickup

    def lesson(
        self,
        key: str,
        subject: str,
        item_id: str,
        staff: str,
        day: int,
        *,
        settle: Settle | None = "card",
        status: BookingStatus | None = None,
        price: int | None = None,
        note: str | None = None,
    ) -> Booking:
        """A lesson for one student, placed near `day` and billed once it's done."""
        booking = self.visit(
            key,
            self.household_of(subject),
            item_id,
            staff,
            day,
            settle=settle,
            subject=subject,
            price=price,
            status=status,
        )
        if booking is None:
            booking = self.visit(
                key,
                self.household_of(subject),
                item_id,
                staff,
                day + (-7 if day < 0 else 7),
                settle=settle,
                subject=subject,
                price=price,
                status=status,
            )
        assert booking is not None, key
        self.note(
            booking.id, "booking", note or f"Pick up at {self.pickup(booking)}.", booking.created_at
        )
        return booking

    def regulars(self) -> None:
        for key, (staff, weekday, at, visits, before, package_item) in SERIES.items():
            subject = self.learner(key)
            household = self.household_of(subject)
            today = self.local(self.now).date()
            first = today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)
            bought = datetime.combine(
                first - timedelta(weeks=before, days=16), time(19, 0), self.ctx.zone
            )
            self.joined(household, bought.astimezone(UTC) - timedelta(hours=1))
            package = self.package(
                household, package_item, bought.astimezone(UTC), key=key, subject=subject
            )
            self.series(
                key,
                household,
                LESSON if package_item == TEN_AUTO else MANUAL,
                staff,
                weekday=weekday,
                at=at,
                every=1,
                visits=visits,
                before=before,
                subject=subject,
                package_id=package.id,
            )

    def today_lessons(self) -> None:
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        plan = (
            (MARCUS, "lena", LESSON, -30),
            (BOSS, "navjot", HIGHWAY, 30),
            (JASMINE, "emma", MANUAL, 90),
        )
        starts = {
            staff: (floor + timedelta(minutes=offset)).astimezone(UTC)
            for staff, _, _, offset in plan
        }
        today = all(
            self.within_hours(
                staff,
                starts[staff],
                starts[staff] + timedelta(minutes=self.items[item].duration_min or 60),
            )
            and self.free(
                staff,
                f"sj_rb_{key}",
                starts[staff],
                starts[staff] + timedelta(minutes=self.items[item].duration_min or 60),
                0,
                PICKUP_MIN,
            )
            for staff, key, item, _ in plan
        )
        lessons: dict[str, Booking] = {}
        for staff, key, item, _ in plan:
            start = starts[staff]
            if not today:
                found = self.place(staff, item, 1, f"sj_rb_{key}", past=False)
                assert found is not None
                start = found
            created = min(start - timedelta(days=6), self.now - timedelta(days=2))
            lessons[key] = self.book(key, key, item, staff, start, "confirmed", created)
        lena, navjot = lessons["lena"], lessons["navjot"]
        if today:
            lena.departed_at = lena.starts_at - timedelta(minutes=18)
            lena.checked_in_at = lena.starts_at + timedelta(minutes=2)
            navjot.departed_at = self.now - timedelta(minutes=6)
        for key, body in (
            (
                "lena",
                "Pick up at 730 Banning Street; Lena waits on the front step. Left turns at "
                "uncontrolled intersections, then Portage Avenue at rush hour.",
            ),
            (
                "navjot",
                "Pick up at 18 Templeton Avenue. First highway lesson: the Perimeter from "
                "McPhillips to Pembina and back.",
            ),
            (
                "emma",
                "Pick up at 88 Lipton Street. Hill starts on the Osborne Bridge approach and "
                "downshifting before stops.",
            ),
        ):
            self.note(lessons[key].id, "booking", body, lessons[key].created_at)

    def both_cars_out(self) -> None:
        """An afternoon when Linda and Marcus have both automatics out while Arjun is free."""
        hour = timedelta(minutes=self.items[LESSON].duration_min or 60)
        teachers = (BOSS, MARCUS, ARJUN)
        starts = (
            datetime.combine(self.local(self.at(offset)).date(), at, self.ctx.zone).astimezone(UTC)
            for offset in range(2, 40)
            for at in (time(15, 0), time(15, 30), time(16, 0))
        )
        start = next(
            (
                start
                for start in starts
                if all(
                    self.within_hours(staff, start, start + hour)
                    and self.free(staff, None, start, start + hour, 0, PICKUP_MIN)
                    for staff in teachers
                )
                and len(self.rooms_free(LESSON, start, start + hour)) == 2
            ),
            None,
        )
        if start is None:
            raise ValueError("no afternoon when all three automatic instructors and cars are free")
        created = self.now - timedelta(days=3)
        for staff, name, household in ((BOSS, "linda", "teen_00"), (MARCUS, "marcus", "teen_02")):
            booking = self.book(
                f"both_cars_{name}",
                household,
                LESSON,
                staff,
                start,
                "confirmed",
                created,
                subject=self.learner(household),
            )
            self.note(
                booking.id, "booking", f"Pick up at {self.pickup(booking)}.", booking.created_at
            )

    def storyline(self) -> None:
        self.lead()
        self.road_tests()
        self.newcomer()
        self.missed()
        self.refund_story()
        self.gift()
        self.feedback_stories()

    def lead(self) -> None:
        start = self.place(MARCUS, LESSON, 4, "sj_rb_ramos", past=False)
        assert start is not None
        created = self.now - timedelta(hours=22)
        booking = self.book(
            "ramos", "ramos", LESSON, MARCUS, start, "pending", created, source="online"
        )
        self.note(
            booking.id,
            "booking",
            "Pick up at Garden City Collegiate, main doors on Jefferson, after school.",
            created,
        )
        submitted = created + timedelta(minutes=25)
        self.response(
            "registration",
            "ramos",
            REGISTRATION_FORM,
            booking,
            {
                "student_name": "Bianca Ramos",
                "birthday": str(self.ctx.get(Subject, "sj_rb_ramos").attributes["birthday"]),
                "licence": "Learner (Class 5L)",
                "learner_since": (self.local(self.now).date() - timedelta(days=41)).isoformat(),
                "transmission": "Automatic",
                "experience": "A few hours with family",
                "pickup": "Garden City Collegiate, 711 Jefferson Avenue, Winnipeg, MB R2V 0P7",
                "guardian": "Angela Ramos, 204-555-0100",
                "goals": ["Pass the road test", "Parking"],
                "notes": "She's had a few practice drives in the mall parking lot with her dad.",
            },
            submitted,
            created=created + timedelta(minutes=5),
        )
        self.sign(
            "ramos", "ramos", AGREEMENT, submitted + timedelta(minutes=6), None, status="pending"
        )

    def road_tests(self) -> None:
        rohan = self.learner("rohan")
        for index, (item, day) in enumerate(
            ((LESSON, -60), (LESSON, -46), (HIGHWAY, -32), (PARKING, -18), (LESSON, -9))
        ):
            self.lesson(f"rohan_{index}", rohan, item, BOSS, day)
        start = self.place(BOSS, ROAD_TEST, 6, rohan, past=False)
        assert start is not None
        booked = self.now - timedelta(days=3, hours=4)
        test = self.book(
            "rohan_roadtest", "patel", ROAD_TEST, BOSS, start, "confirmed", booked, subject=rohan
        )
        self.deposit(test, booked + timedelta(minutes=8))
        test_at = self.local(start + timedelta(minutes=60))
        self.note(
            test.id,
            "booking",
            f"Road test at the Gateway test centre at {_clock(test_at)}. Warm-up from "
            f"{_clock(self.local(start))}, picked up at St. Paul's on Grant Avenue.",
            booked,
        )
        sophie = self.learner("sophie")
        for index, (item, day) in enumerate(
            ((LESSON, -70), (LESSON, -56), (HIGHWAY, -42), (PARKING, -28))
        ):
            self.lesson(f"sophie_{index}", sophie, item, MARCUS, day)
        passed = self.lesson("sophie_roadtest", sophie, ROAD_TEST, MARCUS, -12, settle=None)
        self.deposit(passed, passed.created_at + timedelta(minutes=10))
        assert passed.completed_at is not None
        invoice = self.invoice(
            "sophie_roadtest",
            "sophie",
            passed.completed_at + timedelta(minutes=20),
            passed.created_at,
            "Road test package: warm-up lesson, the car for the test and the drive home. Your "
            "$50 deposit is taken off.",
        )
        passed.invoice_id = invoice.id
        self.line(invoice.id, ROAD_TEST, passed.created_at, booking=passed)
        self.settle(invoice, "sophie", "card")
        self.note(
            self.client_id("sophie"),
            "client",
            "Passed her road test first time.",
            passed.completed_at,
        )

    def newcomer(self) -> None:
        dmytro = self.learner("dmytro")
        booking = self.lesson("dmytro_assessment", dmytro, ASSESSMENT, BOSS, -4, settle=None)
        assert booking.completed_at is not None
        paid = booking.completed_at + timedelta(minutes=4)
        self.sale("dmytro", "dmytro", BOSS, Quote(ASSESSMENT), booking, booking.created_at, paid)
        self.note(
            self.client_id("dmytro"),
            "client",
            "Smooth, careful driver. Practise four-way stops and the right-turn-on-red rule; "
            "book a "
            "highway lesson before the road test.",
            paid,
        )
        self.lesson("dmytro_highway", dmytro, HIGHWAY, MARCUS, 5)

    def missed(self) -> None:
        brayden = self.learner("brayden")
        self.lesson("brayden_0", brayden, LESSON, MARCUS, -48)
        booking = self.lesson(
            "brayden_missed", brayden, LESSON, MARCUS, -22, settle=None, status="no_show"
        )
        self.note(
            booking.id,
            "booking",
            "Waited 15 minutes at Maples Collegiate's front doors. Called Brayden and his dad, no "
            "answer. Charged in full under the agreement.",
            booking.starts_at + timedelta(minutes=20),
        )
        invoice = self.invoice(
            "brayden_missed",
            "thiessen",
            booking.starts_at + timedelta(hours=3),
            booking.starts_at + timedelta(hours=3),
            f"Missed lesson on {self.local(booking.starts_at):%B} "
            f"{self.local(booking.starts_at).day}: "
            "the student wasn't at the pickup, so the lesson is charged in full.",
        )
        booking.invoice_id = invoice.id
        self.line(
            invoice.id,
            LESSON,
            invoice.created_at,
            booking=booking,
            price=MISSED_FEE,
            description="Missed lesson, charged in full",
        )
        self.settle(invoice, "thiessen", "overdue")

    def refund_story(self) -> None:
        amir = self.learner("amir")
        self.lesson("amir_0", amir, LESSON, MARCUS, -40)
        booking = self.lesson("amir_highway", amir, HIGHWAY, MARCUS, -16)
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == booking.invoice_id)
        assert payment.paid_at is not None
        when = payment.paid_at + timedelta(hours=5)
        self.refund(
            payment,
            4988,
            when,
            "A flat tire 40 minutes in ended the lesson early, so half is refunded.",
        )
        self.note(
            booking.id,
            "booking",
            "Flat tire on Bishop Grandin 40 minutes in. Ended the lesson and drove Amir home on "
            "the spare. Refund half.",
            booking.starts_at + timedelta(minutes=55),
        )

    def gift(self) -> None:
        bought = self.at(-52, 15)
        card = self.gift_card("noah", "donald", GIFT, 20000, bought, recipient="Noah Bergen")
        self.joined("donald", bought - timedelta(minutes=20))
        noah = self.learner("noah")
        booking = self.lesson(
            "noah_gift",
            noah,
            HIGHWAY,
            BOSS,
            -30,
            settle=None,
            price=0,
            note="Highway lesson paid with the gift card from Noah's grandfather (RB-GIFT-NOAH). "
            "Redeem $99.75 with GST.",
        )
        assert booking.completed_at is not None
        self.redeem(card, 9975, booking.completed_at + timedelta(minutes=10))

    def feedback_stories(self) -> None:
        sophie = self.ctx.get(Booking, "bk_rb_sophie_roadtest")
        self.feedback(
            "sophie",
            sophie,
            5,
            ["Patient instructor", "Road test ready", "Felt safe"],
            "Marcus had me drive the test area until it felt routine. I passed first time.",
        )
        self.review("sophie_roadtest")
        caleb = self.learner("caleb")
        self.lesson("caleb_0", caleb, LESSON, MARCUS, -30)
        late = self.lesson("caleb_1", caleb, LESSON, MARCUS, -11)
        self.feedback(
            "caleb",
            late,
            4,
            ["Clear explanations", "Felt safe"],
            "Caleb learned a lot, but Marcus was about 15 minutes late picking him up at school.",
            follow_up=True,
        )

    def feedback(
        self,
        key: str,
        booking: Booking,
        rating: int,
        highlights: list[str],
        comment: str | None = None,
        *,
        follow_up: bool = False,
    ) -> None:
        assert booking.completed_at is not None
        submitted = min(booking.completed_at + timedelta(hours=5), self.now - timedelta(hours=1))
        answers: dict[str, object] = {"rating": rating, "highlights": highlights}
        if comment:
            answers["comments"] = comment
        if follow_up:
            answers["follow_up"] = True
        self.response(
            "feedback",
            key,
            FEEDBACK_FORM,
            booking,
            answers,
            submitted,
            created=booking.completed_at + timedelta(minutes=30),
        )

    def courses(self) -> None:
        today = self.local(self.now).date()
        coming = today + timedelta(days=(COURSE_WEEKDAY - today.weekday() - 1) % 7 + 1)
        self.course("course", coming - timedelta(weeks=2), COURSE_NOW)
        self.course("course_next", coming + timedelta(weeks=3), COURSE_NEXT)

    def course(self, key: str, first: date, households: tuple[str, ...]) -> None:
        """Four Tuesday evenings laid out ahead, each student enrolled in all of them at once."""
        item = self.items[CLASSROOM]
        starts = [
            datetime.combine(first + timedelta(weeks=n), COURSE_AT, self.ctx.zone).astimezone(UTC)
            for n in range(item.session_count or COURSE_EVENINGS)
        ]
        opened = min(starts[0] - timedelta(days=28), self.now - timedelta(days=6))
        program = Recurrence(
            id=f"sch_rb_{key}",
            business_id=self.spec.id,
            item_id=CLASSROOM,
            staff_id=BOSS,
            frequency="week",
            interval=1,
            byday=["TU"],
            count=len(starts),
            status="active",
            created_at=opened,
            updated_at=opened,
        )
        self.ctx.add(program)
        sessions: list[Slot] = []
        for n, start in enumerate(starts):
            slot = self.session(f"{key}_{n}", CLASSROOM, BOSS, start)
            slot.recurrence_id = program.id
            slot.created_at = slot.updated_at = opened
            sessions.append(slot)
        closes = min(self.now - timedelta(hours=2), starts[0] - timedelta(days=1))
        span = (closes - opened) / (len(households) + 1)
        for order, household in enumerate(households):
            subject = f"sj_rb_{household}"
            enrolled = opened + span * (order + 1)
            seats: list[Booking] = []
            for n, slot in enumerate(sessions):
                self.busy.append(("", subject, slot.starts_at, slot.ends_at, 0, 0))
                seat = self.book(
                    f"{key}_{household}_{n}",
                    household,
                    CLASSROOM,
                    BOSS,
                    slot.starts_at,
                    "completed" if slot.ends_at <= self.now else "confirmed",
                    enrolled,
                    subject=subject,
                    source="online" if order % 2 == 0 else "manual",
                    price=None if n == 0 else 0,
                    slot=slot,
                )
                if slot.starts_at <= self.now < slot.ends_at:
                    seat.checked_in_at = slot.starts_at - timedelta(minutes=5 + order)
                seats.append(seat)
            invoice = self.invoice(
                f"{key}_{household}", household, enrolled + timedelta(minutes=10), enrolled, ""
            )
            invoice.notes = (
                f"{item.name}, Tuesdays at 6 pm from {first:%B} {first.day}, due on the first "
                "evening."
            )
            invoice.due_at = seats[0].starts_at
            seats[0].invoice_id = invoice.id
            evenings = plural(
                SOURCE_LOCALE, "invoice_line.program", item.session_count or 0, program=item.name
            )
            self.line(invoice.id, CLASSROOM, enrolled, booking=seats[0], description=evenings)
            if household == COURSE_OWING:
                self.settle(invoice, household, "overdue")
            elif key == "course" or order == 0:
                self.settle(invoice, household, "etransfer" if order % 2 else "card")

    def routine(self) -> None:
        """Weekly lessons across the book: manual students with Jasmine, the rest in automatics."""
        busy = {
            "ramos",
            "patel",
            "sophie",
            "dmytro",
            "amir",
            "thiessen",
            "donald",
            "bergen",
            "tanaka",
            "dueck",
            "emma",
        }
        manual: list[str] = []
        automatic: list[str] = []
        for household in (*NAMED, *_generated()):
            if household.key in busy:
                continue
            for index, student in enumerate(household.learners()):
                if index == 0:
                    (manual if student.manual else automatic).append(household.key)
        manual.append("emma")
        self.fill(
            automatic,
            by_staff={JASMINE: manual, MARCUS: automatic, ARJUN: automatic, BOSS: automatic},
        )

    def paperwork(self) -> None:
        """Each household signs the agreement at its first booking and registers each student."""
        ctx = self.ctx
        first: dict[str, Booking] = {}
        for booking in sorted(ctx.all(Booking), key=lambda b: b.created_at):
            if booking.subject_id is not None:
                first.setdefault(booking.subject_id, booking)
        signed = {s.client_id for s in ctx.all(Signature) if s.contract_id == AGREEMENT}
        registered = {r.parent_id for r in ctx.all(FormResponse) if r.form_id == REGISTRATION_FORM}
        for subject_id, booking in sorted(first.items()):
            key = booking.client_id.removeprefix("cl_rb_")
            if booking.client_id not in signed:
                at = min(booking.created_at + timedelta(minutes=30), self.now - timedelta(hours=2))
                self.sign(key, key, AGREEMENT, at, None)
                signed.add(booking.client_id)
            if booking.id not in registered:
                self.registration(subject_id, booking)

    def registration(self, subject_id: str, booking: Booking) -> None:
        student = self.ctx.get(Subject, subject_id)
        client = self.ctx.get(Client, booking.client_id)
        adult = student.name == client.name
        manual = self.ctx.get(Slot, booking.slot_id).staff_id == JASMINE
        submitted = min(booking.created_at + timedelta(hours=3), self.now - timedelta(hours=1))
        answers: dict[str, object] = {
            "student_name": student.name,
            "birthday": str(student.attributes["birthday"]),
            "licence": "Learner (Class 5L)",
            "transmission": "Manual" if manual else "Automatic",
            "experience": "Comfortable on quiet streets" if len(subject_id) % 2 else "None",
            "pickup": self.pickup(booking),
            "goals": ["Pass the road test"]
            if len(subject_id) % 3
            else ["Pass the road test", "Winter driving"],
        }
        if not adult:
            answers["guardian"] = f"{client.name}, {client.phone or ''}".rstrip(", ")
        self.response(
            "registration",
            subject_id.removeprefix("sj_rb_"),
            REGISTRATION_FORM,
            booking,
            answers,
            submitted,
        )

    def engagement(self) -> None:
        self.consents()
        self.withdraw("adult_03", self.now - timedelta(days=28))
        self.broadcast(
            "summer",
            "Summer lesson times",
            "School's out soon, and summer is the busiest time for lessons and road tests. If your "
            "student wants to test before September, book their lessons now; weekday daytime "
            "times are easiest to find.",
            self.at(-140, 10),
        )
        self.broadcast(
            "winter",
            "Winter driving lessons",
            "The first snow is on its way. A winter lesson covers braking on ice, clearing the "
            "car properly and keeping your distance on Portage and the Perimeter. Book one online "
            "or reply to this message.",
            self.at(-9, 10),
        )
        self.reviews()
        self.conversations()

    def reviews(self) -> None:
        ctx = self.ctx
        happy = (
            (
                "bergen",
                5,
                ["Patient instructor", "Clear explanations"],
                "Noah looks forward to Saturdays.",
            ),
            (
                "tanaka",
                5,
                ["Patient instructor", "Felt safe"],
                "Jasmine is so calm with Aiko on the hills.",
            ),
            ("lin", 5, ["Clear explanations", "On time"], None),
            ("okonkwo", 5, ["Felt safe", "Clear explanations"], None),
            (
                "lena",
                4,
                ["Patient instructor"],
                "Great lessons. A few more evening times would help.",
            ),
            ("adult_01", 5, ["On time", "Clear explanations"], None),
        )
        for key, rating, highlights, comment in happy:
            done = sorted(
                (
                    b
                    for b in ctx.all(Booking)
                    if b.client_id == self.client_id(key)
                    and b.status == "completed"
                    and b.completed_at is not None
                    and b.completed_at < self.now - timedelta(days=3)
                    and ctx.get(Slot, b.slot_id).capacity == 1
                    and not any(
                        r.parent_id == b.id
                        for r in ctx.all(FormResponse)
                        if r.form_id == FEEDBACK_FORM
                    )
                ),
                key=lambda b: b.completed_at or self.now,
            )
            if not done:
                continue
            booking = done[-1]
            self.feedback(booking.id.removeprefix("bk_rb_"), booking, rating, highlights, comment)
            if rating == 5:
                self.review(booking.id.removeprefix("bk_rb_"))
        self.review("dmytro_assessment")

    def conversations(self) -> None:
        ctx = self.ctx
        ramos = ctx.get(Booking, "bk_rb_ramos")
        when = ramos.created_at + timedelta(hours=1)
        thread = self.thread("ramos", when)
        self.say(
            thread,
            "Hi, I booked Bianca's first lesson online. Can you pick her up at Garden City after "
            "school, or does it have to be at home?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Angela, school is fine. Marcus will meet Bianca at the main doors on Jefferson. "
            "Please make sure she brings her learner's licence. We'll confirm the booking today.",
            min(when + timedelta(minutes=45), self.now - timedelta(minutes=30)),
        )
        navjot = ctx.get(Booking, "bk_rb_navjot")
        if navjot.departed_at is not None:
            thread = self.thread("navjot", navjot.departed_at)
            self.say(
                thread,
                "Hi Navjot, it's Linda from Riverbend. I'm on my way and will be there in about 20 "
                "minutes.",
                navjot.departed_at,
                sender=RIVERBEND_OWNER,
            )
            self.say(
                thread,
                "Great, I'll be out front.",
                navjot.departed_at + timedelta(minutes=2),
                sender=None,
            )
        test = ctx.get(Booking, "bk_rb_rohan_roadtest")
        when = test.created_at + timedelta(minutes=30)
        thread = self.thread("patel", when)
        local = self.local(test.starts_at)
        self.say(
            thread,
            f"Hi Meera, Rohan's road test package is booked for {local:%A, %B} {local.day}. Linda "
            f"will pick him up at St. Paul's at {_clock(local)} for a warm-up drive, and the $50 "
            "deposit is paid. Please bring his learner's licence and the test fee receipt.",
            when,
        )
        caleb = ctx.get(FormResponse, "fr_rb_feedback_caleb")
        if caleb.submitted_at is not None:
            when = caleb.submitted_at + timedelta(hours=2)
            thread = self.thread("dueck", when)
            self.say(
                thread,
                "Hi Tanya, thank you for the feedback, and sorry Caleb was left waiting. The "
                "lesson before ran over on Pembina. We've moved his lessons 15 minutes later so "
                "Marcus has time to get to Shaftesbury.",
                when,
                sender=RIVERBEND_OWNER,
            )
        overdue = ctx.get(Invoice, "inv_rb_brayden_missed")
        if overdue.overdue_notified_at is not None:
            when = overdue.overdue_notified_at + timedelta(hours=3)
            thread = self.thread("thiessen", when)
            self.say(
                thread,
                f"Hi Shawn, invoice {overdue.number} for Brayden's missed lesson is past due. You "
                "can pay by card from the invoice link or by e-Transfer to "
                "hello@riverbend.example.",
                when,
            )
        course = ctx.get(Invoice, f"inv_rb_course_{COURSE_OWING}")
        if course.overdue_notified_at is not None:
            when = course.overdue_notified_at + timedelta(hours=2)
            thread = self.thread(COURSE_OWING, when)
            self.say(
                thread,
                f"Hi Ricardo, a reminder that invoice {course.number} for Mateo's classroom course "
                "was due on the first evening. You can pay it by card from the invoice link.",
                when,
            )
            self.say(
                thread,
                "Sorry, it went to my spam folder. I'll pay it this weekend.",
                when + timedelta(hours=7),
                sender=None,
            )


EDITION = Riverbend
