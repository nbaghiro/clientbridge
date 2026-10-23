"""Lakeside Learning Studio: a tutoring and music lessons studio in Ottawa, on the demo engine."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.core.locale import SOURCE_LOCALE, plural
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Subject
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, BookingStatus, Hours, Recurrence, Slot
from clientbridge.schemas.subjects import Pickup, StudentAttributes
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

LAKESIDE = "bz_lakeside"
LAKESIDE_OWNER = "us_ls_owner"

NADIA, JULIEN, SAMUEL, SOFIA = "st_ls_owner", "st_ls_julien", "st_ls_samuel", "st_ls_sofia"
ASSESSMENT, MATH, ENGLISH, FRENCH, SCIENCE = (
    "it_ls_assessment",
    "it_ls_math",
    "it_ls_english",
    "it_ls_french",
    "it_ls_science",
)
PIANO, PIANO_LONG, GUITAR = "it_ls_piano", "it_ls_piano_long", "it_ls_guitar"
SAT, REVIEW = "it_ls_sat", "it_ls_review"
CAMP = "it_ls_coding_camp"
TERM10, TERM10_FR, TERM12, SAT_COURSE, PLAN, GIFT = (
    "it_ls_term10",
    "it_ls_term10_french",
    "it_ls_term12",
    "it_ls_sat_course",
    "it_ls_plan",
    "it_ls_gift",
)
MATH_BOOK, FRENCH_BOOK, PIANO_BOOK, STRINGS, TUNER = (
    "it_ls_workbook_math",
    "it_ls_workbook_french",
    "it_ls_piano_book",
    "it_ls_guitar_strings",
    "it_ls_tuner",
)
REGISTRATION, FEEDBACK, REREGISTER = (
    "frm_ls_registration",
    "frm_ls_feedback",
    "frm_ls_reregister",
)
POLICIES, PLAN_AGREEMENT = "con_ls_policies", "con_ls_plan"

WEEKDAYS_OPEN = (time(15, 0), time(20, 30))
SATURDAY = (time(9, 0), time(15, 0))
TUTOR_HOURS = {**{d: WEEKDAYS_OPEN for d in range(5)}, 5: SATURDAY}
OWNER_HOURS = {**{d: (time(10, 0), time(20, 0)) for d in range(5)}, 5: (time(9, 0), time(14, 0))}
# this term's weekly lessons: ten weeks, six of them already taught
TERM_VISITS, TERM_DONE = 10, 6
SIBLING_DISCOUNT = 10
POLICIES_REVISED = 45


def _service(
    item_id: str,
    name: str,
    price: int,
    minutes: int,
    category: str,
    description: str,
    color: str,
    *,
    kind: str = "service",
    capacity: int | None = None,
    tax: str = "exempt",
    online: bool = True,
    buffer: int = 0,
) -> Offering:
    return Offering(
        id=item_id,
        kind="class" if kind == "class" else "service",
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="standard" if tax == "standard" else "exempt",
        minutes=minutes,
        color=color,
        online_bookable=online,
        capacity=capacity,
        buffer_after_min=buffer,
    )


def _product(
    item_id: str,
    name: str,
    price: int,
    description: str,
    sku: str,
    cost: int,
    stock: Stock,
    addon_for: tuple[str, ...],
) -> Offering:
    return Offering(
        id=item_id,
        kind="product",
        name=name,
        price_cents=price,
        category="Books and supplies",
        description=description,
        tax_class="standard",
        sku=sku,
        cost_cents=cost,
        stock=stock,
        addon_for=addon_for,
        sell_online=True,
    )


ITEMS: tuple[Offering, ...] = (
    _service(
        ASSESSMENT,
        "New student assessment",
        6000,
        45,
        "Getting started",
        "A 45-minute session with Nadia for a new student. We look at recent schoolwork, try "
        "a few grade-level questions together and talk with you about goals. You get a short "
        "written summary and a suggested lesson plan by the next day.",
        "#3F7C8C",
        buffer=15,
    ),
    _service(
        MATH,
        "Math tutoring, 60 min",
        7000,
        60,
        "Tutoring",
        "One-on-one math from Grade 1 to Grade 12, following the Ontario curriculum. We work "
        "from your child's current unit and homework, and practise for tests a week ahead.",
        "#24506B",
    ),
    _service(
        ENGLISH,
        "English tutoring, 60 min",
        7000,
        60,
        "Tutoring",
        "Reading, writing and grammar, from early readers to Grade 12 essays. Students bring "
        "their current assignments, and we build skills around them.",
        "#6A4C93",
    ),
    _service(
        FRENCH,
        "French tutoring, 60 min",
        7000,
        60,
        "Tutoring",
        "Support for French immersion and core French students: reading, oral practice, "
        "verb tenses and written work, in French from the first minute.",
        "#3D6FB6",
    ),
    _service(
        SCIENCE,
        "Science tutoring, 60 min",
        7500,
        60,
        "Tutoring",
        "Grade 7 to 10 science, and Grade 11 and 12 biology, chemistry and physics. Lessons "
        "focus on problem solving, lab reports and exam preparation.",
        "#2E7D5B",
    ),
    _service(
        PIANO,
        "Piano lesson, 30 min",
        4000,
        30,
        "Music",
        "A weekly 30-minute lesson for beginners and younger students, with a practice plan "
        "for the week written in their notebook. RCM exam preparation is available.",
        "#B5653A",
    ),
    _service(
        PIANO_LONG,
        "Piano lesson, 45 min",
        5600,
        45,
        "Music",
        "A 45-minute lesson for intermediate students and RCM exam candidates, with time for "
        "technique, repertoire and theory.",
        "#9B4F2E",
    ),
    _service(
        GUITAR,
        "Guitar lesson, 30 min",
        4000,
        30,
        "Music",
        "Acoustic or classical guitar for ages 8 and up: chords, picking patterns and reading "
        "tab and notation. Bring your own guitar; we have loaners for the first month.",
        "#C08A2B",
    ),
    _service(
        SAT,
        "SAT prep, small group",
        9000,
        120,
        "Exam prep",
        "A two-hour Saturday session for up to eight students: one math and one reading and "
        "writing section, a timed practice set, and a review of the answers together.",
        "#7A3B5E",
        kind="class",
        capacity=8,
        tax="standard",
        online=False,
    ),
    _service(
        REVIEW,
        "Exam review class",
        4500,
        90,
        "Exam prep",
        "A 90-minute review for up to six students before a midterm or final, built around "
        "the unit's practice questions. Sessions are listed a few weeks ahead of exam dates.",
        "#5B6B3A",
        kind="class",
        capacity=6,
        online=False,
    ),
    Offering(
        id=CAMP,
        kind="class",
        name="Fall Coding Camp",
        price_cents=39500,
        category="Camps",
        description="A week of day camp for Grades 4 to 8, Monday to Friday from 9 to 3. "
        "Students build games in Scratch and then Python, and show them to families on "
        "Friday afternoon. Bring a lunch and a water bottle. Up to 10 students.",
        tax_class="exempt",
        minutes=360,
        color="#3B6EA5",
        online_bookable=True,
        capacity=10,
        staff=(SAMUEL,),
        sessions=5,
    ),
    Offering(
        id=TERM10,
        kind="package",
        name="Term package, 10 math lessons",
        price_cents=65000,
        category="Packages and plans",
        description="Ten 60-minute math lessons at the same time each week for the term, "
        "paid up front at a lower rate than single lessons. Valid for 120 days.",
        tax_class="exempt",
        sessions=10,
        covers=MATH,
        validity_days=120,
        ref="term10",
    ),
    Offering(
        id=TERM10_FR,
        kind="package",
        name="Term package, 10 French lessons",
        price_cents=65000,
        category="Packages and plans",
        description="Ten 60-minute French lessons at the same time each week for the term, "
        "paid up front at a lower rate than single lessons. Valid for 120 days.",
        tax_class="exempt",
        sessions=10,
        covers=FRENCH,
        validity_days=120,
        ref="term10fr",
    ),
    Offering(
        id=TERM12,
        kind="package",
        name="Term package, 12 piano lessons",
        price_cents=44000,
        category="Packages and plans",
        description="Twelve 30-minute piano lessons for the term, paid up front. Valid for "
        "120 days, with one make-up lesson if you give 24 hours' notice.",
        tax_class="exempt",
        sessions=12,
        covers=PIANO,
        validity_days=120,
        ref="term12",
    ),
    Offering(
        id=SAT_COURSE,
        kind="package",
        name="SAT prep course, 6 sessions",
        price_cents=49500,
        category="Exam prep",
        description="All six Saturday sessions of the SAT prep course, with a practice "
        "workbook to keep. Seats are limited to eight students.",
        tax_class="standard",
        sessions=6,
        covers=SAT,
        validity_days=90,
        ref="sat",
    ),
    Offering(
        id=PLAN,
        kind="subscription",
        name="Monthly tutoring plan",
        price_cents=26000,
        category="Packages and plans",
        description="Four 60-minute lessons a month at a set weekly time, charged on the same "
        "date each month by card or pre-authorized debit. Cancel with 30 days' notice.",
        tax_class="exempt",
        frequency="month",
        ref="plan",
        contract=PLAN_AGREEMENT,
    ),
    Offering(
        id=GIFT,
        kind="gift",
        name="Gift card",
        price_cents=0,
        category="Gift cards",
        description="A gift card for any lesson, package or book at the studio. It doesn't "
        "expire, and the balance carries over between visits.",
        tax_class="exempt",
    ),
    _product(
        MATH_BOOK,
        "Math practice workbook",
        2495,
        "Our own practice workbook for Grades 5 to 8, with a unit for each strand of the "
        "Ontario curriculum and answers at the back.",
        "LS-BK-MATH",
        1320,
        Stock(14, 5),
        (MATH,),
    ),
    _product(
        FRENCH_BOOK,
        "French grammar workbook",
        2295,
        "Verb tenses, agreement and sentence structure for Grades 7 to 9 immersion students, "
        "with short exercises for each lesson.",
        "LS-BK-FR79",
        1210,
        Stock(9, 4),
        (FRENCH,),
    ),
    _product(
        PIANO_BOOK,
        "Piano method book, level 1",
        1595,
        "The method book our beginners use for their first year, with pieces, technique and "
        "short theory pages.",
        "LS-BK-PNO1",
        840,
        Stock(3, 4),
        (PIANO, PIANO_LONG),
    ),
    _product(
        STRINGS,
        "Guitar strings, nylon set",
        1450,
        "A full set of nylon strings for classical guitars. We're happy to restring the "
        "guitar at the start of a lesson.",
        "LS-GTR-NYL",
        675,
        Stock(11, 4),
        (GUITAR,),
    ),
    _product(
        TUNER,
        "Clip-on tuner",
        1900,
        "A clip-on tuner for guitar, ukulele and violin that reads the pitch from the "
        "instrument's body.",
        "LS-TUNER",
        890,
        Stock(6, 3),
        (GUITAR,),
    ),
)

GRADES = ("JK", "SK", *(f"Grade {n}" for n in range(1, 13)))
SUBJECTS = ("Math", "English", "French", "Science", "Piano", "Guitar", "SAT prep")
REGISTRATION_FIELDS: tuple[DocField, ...] = (
    ("student_name", "text", "Student's full name", None, True, ()),
    ("student_birthday", "date", "Student's date of birth", None, True, ()),
    ("grade", "select", "Grade this school year", None, True, GRADES),
    ("school", "text", "School", None, True, ()),
    ("parent_name", "text", "Parent or guardian", None, True, ()),
    ("parent_phone", "phone", "Best phone number", None, True, ()),
    ("parent_email", "email", "Email for invoices and lesson notes", None, True, ()),
    ("home_address", "address", "Home address", None, False, ()),
    ("subjects", "multiselect", "What would you like help with?", None, True, SUBJECTS),
    (
        "learning_needs",
        "longtext",
        "Learning needs and goals",
        "Anything that helps us teach your child well: strengths, worries, how they learn "
        "best, and what their teacher has said.",
        False,
        (),
    ),
    (
        "iep",
        "select",
        "Does your child have an IEP or accommodations at school?",
        "If so, we'll ask to see the accommodations so lessons can match them.",
        True,
        ("No", "Yes, an IEP is in place", "Being assessed"),
    ),
    ("allergies", "text", "Allergies or medical notes", None, False, ()),
    (
        "pickup",
        "longtext",
        "Who may pick your child up?",
        "Names and relationship. We release students under 12 only to the adults listed here.",
        True,
        (),
    ),
    (
        "walk_home",
        "checkbox",
        "My child may leave on their own at the end of a lesson",
        "For students 12 and over.",
        False,
        (),
    ),
    ("emergency_name", "text", "Emergency contact", None, True, ()),
    ("emergency_phone", "phone", "Emergency contact's phone", None, True, ()),
    (
        "photo_consent",
        "checkbox",
        "Lakeside may share photos of my child from recitals and group classes",
        "We never share a photo without this, and never with a full name.",
        False,
        (),
    ),
    ("policies", "checkbox", "I've read the studio policies", None, True, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How are lessons going?", None, True, ()),
    (
        "went_well",
        "multiselect",
        "What's working well?",
        None,
        False,
        (
            "Clear explanations",
            "Patience",
            "Progress at school",
            "Lesson notes for parents",
            "Scheduling",
        ),
    ),
    ("comments", "longtext", "Anything you'd like us to know?", None, False, ()),
    ("follow_up", "checkbox", "I'm happy for Nadia to contact me about this", None, False, ()),
)
REREGISTER_FIELDS: tuple[DocField, ...] = (
    (
        "continue",
        "select",
        "Will your child continue next term?",
        None,
        True,
        ("Yes, same day and time", "Yes, at a different time", "Not next term"),
    ),
    (
        "days",
        "multiselect",
        "Days that work",
        None,
        False,
        ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"),
    ),
    (
        "time",
        "select",
        "Preferred time",
        None,
        False,
        ("After school, 3:30 to 5:00", "Early evening, 5:00 to 7:00", "Saturday morning"),
    ),
    ("subjects", "multiselect", "Subjects next term", None, False, SUBJECTS),
    ("notes", "longtext", "Anything we should plan for?", None, False, ()),
)

POLICIES_V1 = (
    "Lessons are held at the same time each week. Please give us 24 hours' notice to cancel; "
    "lessons cancelled later than that, or missed, are charged. We offer one make-up lesson "
    "each term. Invoices are due within 14 days by card, e-Transfer or cash. Students under "
    "12 are released only to the adults named on the registration form."
)
POLICIES_BODY = "\n\n".join(
    (
        "These policies cover lessons, classes and packages at Lakeside Learning Studio. "
        "They are demo text for a fictional business, not legal advice.",
        "Lessons and scheduling\nWeekly lessons keep the same day, time and tutor for the "
        "term. Terms run about ten weeks, and we'll ask before each term whether you'd like "
        "to keep your time. Classes and exam reviews are booked per session.",
        "Cancellations and make-ups\nPlease give us 24 hours' notice to cancel or move a "
        "lesson. We'll offer a make-up time that week or the next, once per term. Lessons "
        "cancelled with less notice, or missed without notice, are charged in full. If we "
        "cancel, the lesson is moved or refunded.",
        "Illness\nIf your child is unwell, please keep them home and let us know as early as "
        "you can. A sick day with notice on the morning of the lesson counts as notice.",
        "Payment\nSingle lessons are invoiced after each lesson and due within 14 days, by "
        "card, e-Transfer or cash. Term packages are paid up front and valid for 120 days. "
        "Monthly plans are charged on the same date each month. A sibling discount of 10% "
        "applies to the second child's lessons.",
        "Pickup and supervision\nStudents under 12 are released only to an adult named on "
        "the registration form. If nobody has arrived 15 minutes after the lesson ends, we "
        "call the parent and then the emergency contact. Students 12 and over may leave on "
        "their own if you've told us so on the form.",
        "Photos\nWe take photos at recitals and group classes only to share with families "
        "who have agreed on the registration form, and we never post a student's full name.",
        "Privacy\nWe keep registration details, lesson notes and progress summaries to plan "
        "lessons, and share them only with you. Ask us any time to see or correct them.",
    )
)
PLAN_BODY = "\n\n".join(
    (
        "This agreement covers the Monthly tutoring plan at Lakeside Learning Studio. It is "
        "demo text for a fictional business, not legal advice.",
        "What's included\nFour 60-minute lessons a month at a set weekly time with the same "
        "tutor. In a month with five lesson days, the fifth lesson is included too. School "
        "holidays and the studio's breaks are listed at the start of each term.",
        "Charges\nThe plan is charged on the same date each month to the card or bank "
        "account on file. The first charge is on the day the plan starts.",
        "Pre-authorized debit\nIf you pay from a bank account, you authorize Lakeside "
        "Learning Studio to debit that account each month for the plan amount. This is a "
        "personal pre-authorized debit under the Payments Canada rules. We'll tell you at "
        "least 10 days before a change to the amount or the date. You can ask your bank "
        "about your recourse rights if a debit doesn't follow this agreement.",
        "Missed lessons\nA lesson missed with 24 hours' notice is made up within the month. "
        "Lessons aren't carried over to the next month.",
        "Cancelling\nYou can cancel with 30 days' notice by email or in person. The last "
        "charge covers the final month of lessons.",
    )
)


@dataclass(frozen=True)
class Kid:
    name: str
    grade: int
    school: str
    allergies: str | None = None
    note: str | None = None
    pickups: tuple[Pickup, ...] = ()
    no_pickup: str | None = None


@dataclass(frozen=True)
class Family:
    key: str
    parent: str
    kids: tuple[Kid, ...]
    # days since the family first came; None for families whose assessment is in the history
    since: int | None = None
    channel: str = "email"
    tags: tuple[str, ...] = ()


HOPEWELL, MUTCHMOR, ELMDALE, BROADVIEW = (
    "Hopewell Avenue Public School",
    "Mutchmor Public School",
    "Elmdale Public School",
    "Broadview Public School",
)
FISHER, CAMBRIDGE, CORPUS = (
    "Fisher Park Public School",
    "Cambridge Street Community Public School",
    "Corpus Christi School",
)
GLEBE, LISGAR, NEPEAN, IMMACULATA, DELASALLE = (
    "Glebe Collegiate Institute",
    "Lisgar Collegiate Institute",
    "Nepean High School",
    "Immaculata High School",
    "École secondaire publique De La Salle",
)
FAMILIES: tuple[Family, ...] = (
    Family(
        "nwosu",
        "Amara Nwosu",
        (
            Kid(
                "Chidi Nwosu",
                5,
                HOPEWELL,
                note="His teacher says reading comprehension is behind grade level; math is a "
                "strength. Likes graphic novels.",
                pickups=(
                    Pickup(
                        name="Ngozi Nwosu",
                        relation="Grandmother",
                        phone="+16135550181",
                        note="Picks him up on Tuesdays and Thursdays.",
                    ),
                    Pickup(name="Tobi Adeyemi", relation="Family friend", phone="+16135550182"),
                ),
            ),
        ),
        since=-3,
    ),
    Family(
        "tran",
        "Thu Tran",
        (
            Kid(
                "Minh Tran",
                8,
                FISHER,
                note="Wants to move up to the enriched math stream.",
                pickups=(Pickup(name="Bao Tran", relation="Father", phone="+16135550185"),),
            ),
            Kid(
                "An Tran",
                4,
                ELMDALE,
                note="Second year of piano; practises about 15 minutes a day.",
                pickups=(Pickup(name="Bao Tran", relation="Father", phone="+16135550185"),),
            ),
        ),
        since=-420,
        tags=("sibling discount",),
    ),
    Family(
        "fontaine",
        "Isabelle Fontaine",
        (
            Kid(
                "Léa Fontaine",
                10,
                GLEBE,
                note="Grade 10 academic math. Quadratics were the hard unit last year.",
            ),
        ),
        tags=("term package",),
    ),
    Family(
        "ahmed",
        "Yusuf Ahmed",
        (
            Kid(
                "Zara Ahmed",
                7,
                BROADVIEW,
                allergies="Peanuts",
                pickups=(Pickup(name="Samira Ahmed", relation="Aunt", phone="+16135550183"),),
            ),
        ),
        since=-300,
        channel="sms",
    ),
    Family(
        "kowalski",
        "Marta Kowalski",
        (Kid("Adam Kowalski", 11, LISGAR, note="Writing the SAT in December."),),
        since=-380,
        tags=("sat prep",),
    ),
    Family(
        "mensah",
        "Yaw Mensah",
        (Kid("Ama Mensah", 9, NEPEAN, note="Strong in biology, wants support with chemistry."),),
        tags=("monthly plan",),
    ),
    Family(
        "bianchi",
        "Laura Bianchi",
        (Kid("Luca Bianchi", 3, MUTCHMOR), Kid("Giulia Bianchi", 6, MUTCHMOR)),
        since=-610,
        tags=("sibling discount",),
    ),
    Family(
        "desrosiers",
        "Nadège Desrosiers",
        (
            Kid(
                "Maëlle Desrosiers",
                9,
                DELASALLE,
                note="Attends a French-language school; English essays are the focus.",
            ),
        ),
        since=-330,
    ),
    Family("park", "Daniel Park", (Kid("Jason Park", 12, GLEBE),), since=-200, channel="sms"),
    Family("sullivan", "Brendan Sullivan", (Kid("Fiona Sullivan", 5, HOPEWELL),)),
    Family("gill", "Navdeep Gill", (Kid("Arjun Gill", 10, NEPEAN),), since=-250),
    Family("leblanc", "Marc Leblanc", (Kid("Chloé Leblanc", 11, IMMACULATA),)),
    Family(
        "abdi",
        "Hodan Abdi",
        (
            Kid(
                "Ayaan Abdi",
                6,
                CAMBRIDGE,
                pickups=(Pickup(name="Faisal Abdi", relation="Uncle", phone="+16135550187"),),
            ),
        ),
    ),
    Family("nguyen", "Lan Nguyen", (Kid("Bao Nguyen", 9, GLEBE),), since=-500),
    Family(
        "chen",
        "Hui Chen",
        (
            Kid("Olivia Chen", 7, FISHER, note="French immersion since SK."),
            Kid("Ethan Chen", 4, HOPEWELL),
        ),
        since=-540,
        tags=("french immersion", "term package"),
    ),
    Family("dhillon", "Manpreet Dhillon", (Kid("Simran Dhillon", 11, LISGAR),), since=-460),
    Family(
        "moreau",
        "Sophie Moreau",
        (Kid("Théo Moreau", 8, ELMDALE), Kid("Camille Moreau", 5, ELMDALE)),
        since=-390,
        tags=("french immersion",),
    ),
    Family("rahimi", "Leila Rahimi", (Kid("Dariush Rahimi", 12, LISGAR),), since=-280),
    Family(
        "obrien",
        "Siobhan O'Brien",
        (
            Kid(
                "Liam O'Brien",
                2,
                MUTCHMOR,
                pickups=(
                    Pickup(name="Eileen O'Brien", relation="Grandmother", phone="+16135550184"),
                ),
                no_pickup="Not to be released to Kevin Byrne. Call Siobhan right away if he "
                "comes to collect Liam.",
            ),
        ),
        channel="sms",
    ),
    Family(
        "khoury",
        "Rania Khoury",
        (Kid("Maya Khoury", 10, IMMACULATA), Kid("Elias Khoury", 7, CORPUS, allergies="Tree nuts")),
        since=-470,
    ),
    Family("dubois", "Patrick Dubois", (Kid("Émile Dubois", 6, CORPUS),), since=-350),
    Family("santos", "Maria Santos", (Kid("Gabriel Santos", 9, NEPEAN),)),
    Family("okafor", "Chinedu Okafor", (Kid("Adaeze Okafor", 12, GLEBE),), since=-560),
    Family(
        "kim",
        "Ji-woo Kim",
        (
            Kid(
                "Hannah Kim",
                8,
                FISHER,
                pickups=(Pickup(name="Grace Kim", relation="Aunt", phone="+16135550186"),),
            ),
            Kid(
                "Joon Kim",
                5,
                ELMDALE,
                pickups=(Pickup(name="Grace Kim", relation="Aunt", phone="+16135550186"),),
            ),
        ),
        since=-310,
    ),
    Family(
        "patel",
        "Nisha Patel",
        (
            Kid("Aarav Patel", 10, GLEBE),
            Kid("Diya Patel", 7, HOPEWELL, note="Preparing for her RCM Level 4 exam in June."),
            Kid("Kavya Patel", 3, HOPEWELL),
        ),
        since=-650,
    ),
    Family("wilson", "Jennifer Wilson", (Kid("Owen Wilson", 4, HOPEWELL, allergies="Dairy"),)),
    Family(
        "lefebvre",
        "Mathieu Lefebvre",
        (Kid("Juliette Lefebvre", 11, DELASALLE),),
        since=-240,
    ),
    Family("yusuf", "Fadumo Yusuf", (Kid("Mohamed Yusuf", 8, BROADVIEW),), channel="sms"),
    Family("reyes", "Carmen Reyes", (Kid("Isabella Reyes", 6, CORPUS),), since=-270),
    Family("bergeron", "Annie Bergeron", (Kid("Félix Bergeron", 3, MUTCHMOR),)),
    Family(
        "zhang",
        "Li Zhang",
        (Kid("Kevin Zhang", 11, LISGAR), Kid("Amy Zhang", 8, FISHER)),
        since=-590,
        tags=("sat prep",),
    ),
    Family("ali", "Sana Ali", (Kid("Omar Ali", 9, IMMACULATA),), since=-230),
    Family(
        "murphy",
        "Kathleen Murphy",
        (
            Kid(
                "Nora Murphy",
                5,
                ELMDALE,
                pickups=(
                    Pickup(
                        name="Siobhan Murphy",
                        relation="Sister",
                        phone="+16135550189",
                        note="Picks her up most days; she is 19.",
                    ),
                ),
            ),
        ),
        since=-400,
    ),
    Family("petrenko", "Oksana Petrenko", (Kid("Mark Petrenko", 10, NEPEAN),)),
    Family("tesfaye", "Meron Tesfaye", (Kid("Yonas Tesfaye", 7, CAMBRIDGE),)),
    Family("roy", "Geneviève Roy", (Kid("Olivier Roy", 12, DELASALLE),), since=-620),
    Family(
        "macdonald",
        "Heather MacDonald",
        (Kid("Ella MacDonald", 2, HOPEWELL), Kid("Jack MacDonald", 6, HOPEWELL)),
        since=-360,
    ),
    Family("sharma", "Vikram Sharma", (Kid("Ananya Sharma", 11, GLEBE),), since=-480),
    Family("lopez", "Diego Lopez", (Kid("Mateo Lopez", 4, CORPUS),)),
    Family("cohen", "Rachel Cohen", (Kid("Noah Cohen", 8, FISHER),), since=-260),
    Family("ibrahim", "Amina Ibrahim", (Kid("Yasmin Ibrahim", 10, LISGAR),), since=-440),
    Family("girard", "Julie Girard", (Kid("Antoine Girard", 9, GLEBE),)),
    Family(
        "wong",
        "Karen Wong",
        (
            Kid(
                "Lucas Wong",
                6,
                ELMDALE,
                pickups=(Pickup(name="David Wong", relation="Grandfather", phone="+16135550188"),),
            ),
        ),
        since=-520,
    ),
    Family("bouchard", "Stéphane Bouchard", (Kid("Zoé Bouchard", 7, BROADVIEW),)),
    Family("adeyemi", "Funmi Adeyemi", (Kid("Tobi Adeyemi", 11, NEPEAN),), since=-290),
    Family("hassan", "Omar Hassan", (Kid("Layla Hassan", 5, CAMBRIDGE),)),
    Family("morrison", "Andrew Morrison", (Kid("Grace Morrison", 12, GLEBE),), since=-330),
    Family("vo", "Hoa Vo", (Kid("Kim Vo", 3, MUTCHMOR),)),
    Family("campbell", "Erin Campbell", (Kid("Ben Campbell", 8, HOPEWELL),), since=-210),
    Family("novak", "Petra Novak", (Kid("Ivan Novak", 10, IMMACULATA),)),
    Family("jean", "Roseline Jean", (Kid("Wesley Jean", 6, CORPUS),), channel="sms"),
    Family("thompson", "Mark Thompson", (Kid("Ava Thompson", 9, NEPEAN),), since=-300),
    Family("fraser", "Alison Fraser", (Kid("Hazel Fraser", 4, ELMDALE),)),
    Family("akhtar", "Saima Akhtar", (Kid("Zain Akhtar", 12, LISGAR),), since=-400),
    Family("li", "Jun Li", (Kid("Emma Li", 1, MUTCHMOR),)),
    Family("gagne", "Chantal Gagné", (Kid("Rosalie Gagné", 10, DELASALLE),), since=-450),
    Family("andersen", "Kirsten Andersen", (Kid("Erik Andersen", 7, FISHER),)),
    Family("mukherjee", "Priya Mukherjee", (Kid("Rohan Mukherjee", 11, GLEBE),), since=-310),
)
PHOTO_CLIENTS = (
    "nwosu",
    "tran",
    "fontaine",
    "ahmed",
    "kowalski",
    "mensah",
    "bianchi",
    "desrosiers",
    "abdi",
    "chen",
    "moreau",
    "khoury",
    "okafor",
    "patel",
    "zhang",
    "roy",
    "sharma",
    "ibrahim",
    "wong",
)


@dataclass(frozen=True)
class Weekly:
    """One weekly lesson this term; `offset` counts working days from today (0 is today)."""

    key: str
    family: str
    kid: int
    item: str
    staff: str
    offset: int
    at: time
    package: str | None = None
    plan: bool = False


TODAY: tuple[Weekly, ...] = (
    Weekly("dhillon", "dhillon", 0, MATH, NADIA, 0, time(16, 0)),
    Weekly("petrenko", "petrenko", 0, MATH, NADIA, 0, time(17, 30)),
    Weekly("gagne", "gagne", 0, ENGLISH, JULIEN, 0, time(15, 30)),
    Weekly("dubois", "dubois", 0, FRENCH, JULIEN, 0, time(16, 30)),
    Weekly("rahimi", "rahimi", 0, SCIENCE, SAMUEL, 0, time(16, 0)),
    Weekly("ali", "ali", 0, SCIENCE, SAMUEL, 0, time(17, 0)),
    Weekly("li", "li", 0, PIANO, SOFIA, 0, time(15, 30)),
    Weekly("thompson", "thompson", 0, GUITAR, SOFIA, 0, time(16, 0)),
    Weekly("vo", "vo", 0, PIANO, SOFIA, 0, time(16, 30)),
)
TERM: tuple[Weekly, ...] = (
    Weekly("tran_minh", "tran", 0, MATH, NADIA, 2, time(17, 30)),
    Weekly("tran_an", "tran", 1, PIANO, SOFIA, 3, time(16, 0)),
    Weekly("fontaine", "fontaine", 0, MATH, NADIA, 1, time(16, 0), package=TERM10),
    Weekly("ahmed", "ahmed", 0, ENGLISH, JULIEN, 4, time(16, 30)),
    Weekly("mensah", "mensah", 0, SCIENCE, SAMUEL, 1, time(17, 0), plan=True),
    Weekly("bianchi_luca", "bianchi", 0, PIANO, SOFIA, 1, time(15, 30)),
    Weekly("bianchi_giulia", "bianchi", 1, GUITAR, SOFIA, 4, time(17, 0)),
    Weekly("desrosiers", "desrosiers", 0, ENGLISH, JULIEN, 2, time(18, 0)),
    Weekly("kowalski", "kowalski", 0, SCIENCE, SAMUEL, 3, time(18, 0)),
    Weekly("park", "park", 0, MATH, NADIA, 4, time(18, 30)),
    Weekly("abdi", "abdi", 0, MATH, NADIA, 3, time(16, 0)),
    Weekly("chen_olivia", "chen", 0, FRENCH, JULIEN, 1, time(16, 0), package=TERM10_FR),
    Weekly("chen_ethan", "chen", 1, PIANO, SOFIA, 2, time(15, 30), package=TERM12),
    Weekly("moreau", "moreau", 0, FRENCH, JULIEN, 3, time(17, 0)),
    Weekly("khoury", "khoury", 0, SCIENCE, SAMUEL, 2, time(16, 0)),
    Weekly("okafor", "okafor", 0, SCIENCE, SAMUEL, 4, time(16, 0)),
    Weekly("patel_aarav", "patel", 0, MATH, NADIA, 5, time(17, 0)),
    Weekly("patel_diya", "patel", 1, PIANO_LONG, SOFIA, 5, time(16, 0)),
    Weekly("zhang", "zhang", 0, SCIENCE, SAMUEL, 5, time(18, 0)),
    Weekly("roy", "roy", 0, ENGLISH, JULIEN, 5, time(15, 30)),
    Weekly("sharma", "sharma", 0, MATH, NADIA, 1, time(18, 0)),
    Weekly("ibrahim", "ibrahim", 0, SCIENCE, SAMUEL, 3, time(16, 30)),
    Weekly("wong", "wong", 0, MATH, NADIA, 2, time(16, 0), plan=True),
    Weekly("campbell", "campbell", 0, ENGLISH, JULIEN, 1, time(17, 30), plan=True),
    Weekly("murphy", "murphy", 0, PIANO_LONG, SOFIA, 3, time(17, 0)),
    Weekly("macdonald", "macdonald", 1, GUITAR, SOFIA, 2, time(17, 0)),
    Weekly("kim", "kim", 0, PIANO_LONG, SOFIA, 4, time(15, 30)),
)
# (family, child) enrolled in the camp week; two are away for days they told us about
CAMPERS = (
    ("nwosu", 0),
    ("ahmed", 0),
    ("tran", 0),
    ("tran", 1),
    ("kim", 0),
    ("kim", 1),
    ("abdi", 0),
    ("wong", 0),
    ("murphy", 0),
)
CAMP_AWAY = {("wong", 0): (1, 2), ("murphy", 0): (3, 4)}
CAMP_DAYS = ("MO", "TU", "WE", "TH", "FR")
SAT_STUDENTS = ("kowalski", "sharma", "zhang", "dhillon", "okafor", "mukherjee", "akhtar")
REVIEW_PAST = ("morrison", "akhtar", "rahimi", "okafor", "adeyemi")
REVIEW_NEXT = ("sharma", "dhillon", "lefebvre", "adeyemi", "mukherjee", "zhang")
# tutor, the lessons they teach outside the weekly series, and the families who book them
FILL: tuple[tuple[str, tuple[str, ...], tuple[str, ...], int], ...] = (
    (NADIA, (MATH,), ("gill", "novak", "morrison", "cohen", "santos", "akhtar", "girard"), 7),
    (
        JULIEN,
        (ENGLISH, FRENCH),
        ("sullivan", "yusuf", "bergeron", "lefebvre", "jean", "bouchard", "fraser", "andersen"),
        8,
    ),
    (SAMUEL, (SCIENCE,), ("adeyemi", "tesfaye", "nguyen", "hassan", "mukherjee", "leblanc"), 7),
    (SOFIA, (PIANO,), ("lopez", "reyes", "obrien", "wilson", "andersen", "macdonald"), 10),
)
SEASON = {
    1: 1.25,
    2: 1.25,
    3: 1.3,
    4: 1.35,
    5: 1.45,
    6: 1.4,
    7: 0.55,
    8: 0.45,
    9: 0.4,
    10: 0.35,
    11: 0.35,
    12: 0.3,
}
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cash", "etransfer")


SPEC = BusinessSpec(
    listing=demo_business(LAKESIDE),
    code="ls",
    slug="lakeside",
    login_domain="lakeside.example",
    owner=LAKESIDE_OWNER,
    people=(
        Person(
            LAKESIDE_OWNER,
            NADIA,
            "owner",
            "Nadia Haddad",
            "+16135550190",
            "owner",
            "Owner, math tutor and assessments",
            "#24506B",
            OWNER_HOURS,
        ),
        Person(
            "us_ls_julien",
            JULIEN,
            "julien",
            "Julien Lavoie",
            "+16135550191",
            "staff",
            "English and French tutor",
            "#6A4C93",
            TUTOR_HOURS,
            payee=True,
            rate_type="percent",
            rate_bps=5500,
        ),
        Person(
            "us_ls_samuel",
            SAMUEL,
            "samuel",
            "Samuel Osei",
            "+16135550192",
            "staff",
            "Science tutor and SAT prep",
            "#2E7D5B",
            TUTOR_HOURS,
            payee=True,
            rate_type="hourly",
            rate_cents=3600,
        ),
        Person(
            "us_ls_sofia",
            SOFIA,
            "sofia",
            "Sofia Martins",
            "+16135550193",
            "staff",
            "Piano and guitar teacher",
            "#B5653A",
            TUTOR_HOURS,
            payee=True,
            rate_type="percent",
            rate_bps=6000,
        ),
    ),
    items=ITEMS,
    brand={
        "tagline": "Tutoring and music lessons for students from JK to Grade 12, near Dow's Lake.",
        "about": (
            "Lakeside Learning Studio is a small studio on Preston Street with four teachers. "
            "We tutor math, English, French and science from JK to Grade 12, teach piano and "
            "guitar, and run small-group SAT prep and exam review classes. Every new student "
            "starts with an assessment, and most come at the same time each week through the "
            "school term. Parents get a short note after each lesson about what we covered "
            "and what to practise."
        ),
        "address": "512 Preston Street, Ottawa, ON K1R 7P8",
        "phone": "+1 613-555-0198",
        "email": "hello@lakeside.example",
        "website": "https://lakeside.example",
        "neighbourhood": "Dow's Lake",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
    },
    subject="student",
    sms_number="+16135550199",
    gst_hst_number="742913586RT0001",
    forms=(
        FormSpec(
            REGISTRATION,
            "Student registration",
            "ff_ls_registration_",
            REGISTRATION_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK, "Lesson feedback", "ff_ls_feedback_", FEEDBACK_FIELDS),
        FormSpec(REREGISTER, "Next term registration", "ff_ls_reregister_", REREGISTER_FIELDS),
    ),
    contracts=(
        ContractSpec(
            POLICIES,
            "Studio policies",
            POLICIES_BODY,
            version=2,
            earlier_body=POLICIES_V1,
            revised_day=-POLICIES_REVISED,
        ),
        ContractSpec(PLAN_AGREEMENT, "Monthly plan agreement", PLAN_BODY, created_day=-200),
    ),
    storyline=(
        Stage(
            "New family booked an assessment, registration submitted",
            "nwosu",
            ("bk_ls_nwosu_assessment", "fr_ls_registration_nwosu", "sig_ls_nwosu_policies"),
        ),
        Stage(
            "Two children on different weekly series, with a sibling discount",
            "tran",
            ("sch_ls_tran_minh", "sch_ls_tran_an"),
        ),
        Stage(
            "Each child with a term package of their own, plus one shared",
            "chen",
            (
                "pkg_ls_term10fr_chen_olivia",
                "pkg_ls_term12_chen_ethan",
                "pkg_ls_term12_chen_shared",
            ),
        ),
        Stage(
            "Partway through a 10-lesson term package",
            "fontaine",
            ("pkg_ls_term10_fontaine", "sch_ls_fontaine"),
        ),
        Stage("Missed lesson, rescheduled as a make-up", "ahmed", ("bk_ls_ahmed_makeup",)),
        Stage("SAT prep class nearly full", "kowalski", ("ses_ls_sat_3", "pkg_ls_sat_kowalski")),
        Stage("Exam review class full, with a waitlist", "leblanc", ("bk_ls_review_next_leblanc",)),
        Stage(
            "Coding camp week, one seat left on Monday, with siblings and pickups",
            "tran",
            ("sch_ls_coding_camp", "bk_ls_camp_tran_0_0", "bk_ls_camp_tran_1_0"),
        ),
        Stage(
            "Today's lessons for each tutor",
            "dhillon",
            ("sch_ls_dhillon", "sch_ls_gagne", "sch_ls_rahimi", "sch_ls_li"),
        ),
        Stage(
            "Monthly plan paid by pre-authorized debit",
            "mensah",
            ("sub_ls_plan_mensah", "pm_ls_mensah", "sig_ls_mensah_plan"),
        ),
        Stage("Five-star feedback from a parent", "bianchi", ("fr_ls_feedback_bianchi",)),
        Stage(
            "Term-end thread and next term registration",
            "desrosiers",
            ("th_ls_desrosiers_email", "fr_ls_reregister_desrosiers"),
        ),
        Stage("Overdue invoice", "sullivan", ("inv_ls_sullivan_overdue",)),
        Stage("No-show", "park", ("bk_ls_park_extra",)),
        Stage("Three-star feedback with a reply", "gill", ("fr_ls_feedback_gill",)),
        Stage("Paid by Tap to Pay with a book", "li", ("ord_ls_li_book",)),
    ),
    pacing=Pacing({NADIA: 6}, (MATH,), weeks=34, ahead_weeks=4, seasonality=SEASON),
    photo_clients=PHOTO_CLIENTS,
    founded_day=-700,
    catalog_day=-280,
    documents_day=-275,
    payouts_from_day=-250,
    invoice_start=1400,
    estimate_start=100,
    cheque_start=500,
    seed=41,
)


def _birthday(grade: int, index: int) -> date:
    # a Grade 1 student this school year was born in 2020
    return date(2021 - grade, 1 + index * 5 % 12, 1 + index * 7 % 28)


def _grade(grade: int) -> str:
    return f"Grade {grade}"


class Lakeside(Demo):
    spec = SPEC

    def story(self) -> None:
        self.families()
        self.classes()
        self.camp()
        for lesson in (*TODAY, *TERM):
            self.weekly(lesson)
        self.storyline()
        self.history()
        self.plans()
        self.paperwork()
        self.engagement()
        self.photos()

    def visit_note(self, item: Item, booking: Booking) -> str:
        student = self.ctx.get(Subject, booking.subject_id or "").name
        return f"{item.name} for {student}."

    def kid(self, family: str, index: int) -> str:
        return f"sj_ls_{family}" if index == 0 else f"sj_ls_{family}_{index}"

    def families(self) -> None:
        for number, family in enumerate(FAMILIES):
            first, last = family.parent.split(" ", 1)
            handle = f"{first}.{last}".lower().replace(" ", "").replace("'", "")
            handle = handle.translate(str.maketrans("éèëç", "eeec"))
            self.client(
                family.key,
                family.parent,
                f"{handle}@example.test",
                f"+1613555{100 + number:04}",
                tags=list(family.tags),
                channel="sms" if family.channel == "sms" else "email",
                fields={"source": ("school newsletter", "referral", "google")[number % 3]},
                since=None if family.since is None else self.at(family.since, 10),
            )
            for index, kid in enumerate(family.kids):
                attributes = StudentAttributes(
                    birthday=_birthday(kid.grade, number + index),
                    grade=_grade(kid.grade),
                    school=kid.school,
                    allergies=kid.allergies,
                    pickups=list(kid.pickups) or None,
                    no_pickup=kid.no_pickup,
                ).model_dump(mode="json", exclude_none=True)
                key = family.key if index == 0 else f"{family.key}_{index}"
                self.subject(key, family.key, kid.name, attributes)
                if family.since is not None:
                    since = self.at(family.since, 10)
                    subject = self.ctx.get(Subject, self.kid(family.key, index))
                    subject.created_at = subject.updated_at = since
                if kid.note:
                    self.note(
                        self.kid(family.key, index),
                        "subject",
                        kid.note,
                        self.at(family.since or -60, 11),
                    )

    def working_day(self, offset: int) -> date:
        day = self.local(self.now).date()
        found: list[date] = []
        while len(found) <= offset:
            if day.weekday() != 6:
                found.append(day)
            day += timedelta(days=1)
        return found[offset]

    def starts(self, days: list[date], at: time) -> list[datetime]:
        return [datetime.combine(day, at, self.ctx.zone).astimezone(UTC) for day in days]

    def lesson_time(self, staff: str, subject: str, item: Item, days: list[date], at: time) -> time:
        """The weekly time nearest `at` that is free for the tutor and the student every week."""
        window = self.hours_on(staff, days[0])
        assert window is not None
        minutes = item.duration_min or 60
        wanted = at.hour * 60 + at.minute
        if days[0].weekday() == 5:
            wanted -= 6 * 60
        first, last = window[0].hour * 60 + window[0].minute, window[1].hour * 60
        options = sorted(range(first, last - minutes + 1, 30), key=lambda m: abs(m - wanted))
        for start_minute in options:
            candidate = time(start_minute // 60, start_minute % 60)
            if all(
                self.within_hours(staff, start, start + timedelta(minutes=minutes))
                and self.free(staff, subject, start, start + timedelta(minutes=minutes))
                for start in self.starts(days, candidate)
            ):
                return candidate
        raise ValueError(f"no weekly time for {subject} with {staff}")

    def weekly(self, lesson: Weekly) -> None:
        item = self.items[lesson.item]
        weekday = self.working_day(lesson.offset).weekday()
        today = self.local(self.now).date()
        first = today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)
        days = [first + timedelta(weeks=n - TERM_DONE) for n in range(TERM_VISITS)]
        subject = self.kid(lesson.family, lesson.kid)
        at = self.lesson_time(lesson.staff, subject, item, days, lesson.at)
        package_id = None
        if lesson.package is not None:
            bought = self.starts(days, time(19, 30))[0] - timedelta(days=4)
            package_id = self.package(
                lesson.family, lesson.package, bought, key=lesson.key, subject=subject
            ).id
        self.series(
            lesson.key,
            lesson.family,
            lesson.item,
            lesson.staff,
            weekday=weekday,
            at=at,
            every=1,
            visits=TERM_VISITS,
            before=TERM_DONE,
            subject=subject,
            price=0 if lesson.plan else None,
            package_id=package_id,
            canceled=(TERM_DONE - 1,) if lesson.key == "ahmed" else (),
        )
        if lesson.key == "tran_an":
            for index in range(TERM_VISITS):
                booking = self.ctx.get(Booking, f"bk_ls_tran_an_{index}")
                if booking.invoice_id is not None:
                    invoice = self.ctx.get(Invoice, booking.invoice_id)
                    invoice.discount_kind, invoice.discount_value = "percent", SIBLING_DISCOUNT
                    invoice.discount_reason = "Sibling discount"

    def seat(
        self,
        key: str,
        family: str,
        item: str,
        slot: Slot,
        created: datetime,
        *,
        status: BookingStatus | None = None,
        package_id: str | None = None,
    ) -> Booking:
        done = slot.ends_at <= self.now
        if status != "waitlisted":
            # the student is in class then, so their own lessons go elsewhere
            self.busy.append(("", self.kid(family, 0), slot.starts_at, slot.ends_at, 0, 0))
        return self.book(
            key,
            family,
            item,
            slot.staff_id,
            slot.starts_at,
            status or ("completed" if done else "confirmed"),
            created,
            subject=self.kid(family, 0),
            package_id=package_id,
            slot=slot,
        )

    def classes(self) -> None:
        today = self.local(self.now).date()
        saturday = today + timedelta(days=(5 - today.weekday() - 1) % 7 + 1)
        sessions = [
            self.session(
                f"sat_{index}",
                SAT,
                SAMUEL,
                self.starts([saturday + timedelta(weeks=index - 3)], time(10, 0))[0],
            )
            for index in range(6)
        ]
        for family in SAT_STUDENTS:
            bought = sessions[0].starts_at - timedelta(days=9, hours=-8)
            package = self.package(family, SAT_COURSE, bought)
            for index, slot in enumerate(sessions):
                self.seat(
                    f"sat_{index}_{family}",
                    family,
                    SAT,
                    slot,
                    bought + timedelta(minutes=10),
                    package_id=package.id,
                )
        june = today - timedelta(days=118)
        while june.weekday() != 2:
            june -= timedelta(days=1)
        past = self.session("review_june", REVIEW, NADIA, self.starts([june], time(16, 30))[0])
        for family in REVIEW_PAST:
            booking = self.seat(
                f"review_june_{family}", family, REVIEW, past, past.starts_at - timedelta(days=12)
            )
            self.bill(booking, "etransfer")
        upcoming = self.working_day(8)
        if upcoming.weekday() == 5:
            upcoming += timedelta(days=2)
        coming = self.session(
            "review_next", REVIEW, NADIA, self.starts([upcoming], time(16, 30))[0]
        )
        opened = min(coming.starts_at - timedelta(days=12), self.now - timedelta(days=3))
        for seat, family in enumerate(REVIEW_NEXT):
            self.seat(
                f"review_next_{family}", family, REVIEW, coming, opened + timedelta(hours=seat * 7)
            )
        self.seat(
            "review_next_leblanc",
            "leblanc",
            REVIEW,
            coming,
            self.now - timedelta(hours=20),
            status="waitlisted",
        )

    def camp(self) -> None:
        """Next week's coding camp, laid out ahead and enrolled day by day for its whole week."""
        today = self.local(self.now).date()
        monday = today + timedelta(days=7 - today.weekday())
        item = self.items[CAMP]
        opened = self.now - timedelta(days=24)
        program = Recurrence(
            id="sch_ls_coding_camp",
            business_id=self.spec.id,
            item_id=CAMP,
            staff_id=SAMUEL,
            frequency="week",
            interval=1,
            byday=list(CAMP_DAYS),
            count=len(CAMP_DAYS),
            status="active",
            created_at=opened,
            updated_at=opened,
        )
        self.ctx.add(program)
        sessions: list[Slot] = []
        for n in range(len(CAMP_DAYS)):
            day = monday + timedelta(days=n)
            # the camp week runs from the morning, before Samuel's usual after-school lessons
            self.ctx.add(
                Hours(
                    id=f"av_ls_camp_{n}",
                    business_id=self.spec.id,
                    staff_id=SAMUEL,
                    basis="date",
                    date=day,
                    start_time=time(9, 0),
                    end_time=WEEKDAYS_OPEN[1],
                    available=True,
                    note="Fall Coding Camp week",
                    created_at=opened,
                    updated_at=opened,
                )
            )
            start = self.starts([day], time(9, 0))[0]
            end = start + timedelta(minutes=item.duration_min or 360)
            slot = Slot(
                id=f"ses_ls_camp_{n}",
                business_id=self.spec.id,
                item_id=CAMP,
                staff_id=SAMUEL,
                recurrence_id=program.id,
                starts_at=start,
                ends_at=end,
                capacity=item.capacity or 1,
                status="scheduled",
                created_at=opened,
                updated_at=opened,
            )
            self.ctx.add(slot)
            self.busy.append((SAMUEL, None, start, end, 0, 0))
            sessions.append(slot)
        for order, (family, child) in enumerate(CAMPERS):
            subject = self.kid(family, child)
            enrolled = opened + timedelta(days=1 + order * 2, hours=3)
            away = CAMP_AWAY.get((family, child), ())
            for n, slot in enumerate(sessions):
                if n not in away:
                    self.busy.append(("", subject, slot.starts_at, slot.ends_at, 0, 0))
                booking = self.book(
                    f"camp_{family}_{child}_{n}",
                    family,
                    CAMP,
                    SAMUEL,
                    slot.starts_at,
                    "canceled" if n in away else "confirmed",
                    enrolled,
                    subject=subject,
                    price=item.price_cents if n == 0 else 0,
                    slot=slot,
                )
                if n == 0:
                    self.enrolment_invoice(booking, family, child, enrolled, paid=order % 2 == 0)

    def enrolment_invoice(
        self, first: Booking, family: str, child: int, enrolled: datetime, *, paid: bool
    ) -> None:
        """The camp's invoice, issued on enrolment and due on its first day; some are paid."""
        item = self.items[CAMP]
        invoice = self.invoice(f"camp_{family}_{child}", family, enrolled, enrolled, "")
        invoice.due_at = first.starts_at
        first.invoice_id = invoice.id
        days = plural(
            SOURCE_LOCALE, "invoice_line.program", item.session_count or 0, program=item.name
        )
        self.line(invoice.id, CAMP, enrolled, booking=first, description=days)
        if paid:
            self.settle(invoice, family, "etransfer")

    def storyline(self) -> None:
        ctx = self.ctx
        start = self.place(NADIA, ASSESSMENT, 2, self.kid("nwosu", 0), past=False)
        assert start is not None
        assessment = self.book(
            "nwosu_assessment",
            "nwosu",
            ASSESSMENT,
            NADIA,
            start,
            "pending",
            self.now - timedelta(hours=20),
            source="online",
        )
        self.registration("nwosu", assessment, self.now - timedelta(hours=7))
        self.sign(
            "nwosu_policies",
            "nwosu",
            POLICIES,
            self.now - timedelta(hours=6),
            None,
            status="pending",
        )
        missed = ctx.get(Booking, f"bk_ls_ahmed_{TERM_DONE - 1}")
        makeup = self.visit(
            "ahmed_makeup",
            "ahmed",
            ENGLISH,
            JULIEN,
            2,
            note="Make-up for the lesson Zara missed when she was sick. Finish the persuasive "
            "paragraph from last week.",
        )
        assert makeup is not None and missed.canceled_at is not None
        makeup.created_at = makeup.updated_at = min(
            missed.canceled_at + timedelta(hours=1), self.now - timedelta(hours=2)
        )
        self.note(
            missed.id,
            "booking",
            "Zara is sick; Yusuf texted the evening before. Make-up booked.",
            missed.canceled_at,
        )
        extra = self.visit(
            "park_extra",
            "park",
            MATH,
            NADIA,
            -9,
            status="no_show",
            settle=None,
            note="Extra lesson before Jason's calculus test.",
        )
        assert extra is not None
        self.visit(
            "sullivan_overdue",
            "sullivan",
            ENGLISH,
            JULIEN,
            -34,
            settle="overdue",
        )
        lesson = self.visit("li_book", "li", PIANO, SOFIA, -6, settle=None)
        assert lesson is not None and lesson.completed_at is not None
        self.sale(
            "li_book",
            "li",
            SOFIA,
            Quote(PIANO, ((PIANO_BOOK, 1),)),
            lesson,
            lesson.created_at,
            lesson.completed_at + timedelta(minutes=8),
        )

    def history(self) -> None:
        ctx = self.ctx
        self.time_off(
            "sofia_summer",
            SOFIA,
            self.at(-75, 0),
            self.at(-62, 23),
            "Summer holiday",
        )
        for staff, services, families, weekly in FILL:
            self.fill(
                list(families),
                Pacing(
                    {staff: weekly},
                    services,
                    weeks=34,
                    ahead_weeks=4,
                    seasonality=SEASON,
                    settlements=SETTLEMENTS,
                    cancel_every=29,
                ),
            )
        for family in FAMILIES:
            if family.since is not None or family.key == "nwosu":
                continue
            visits = sorted(
                (b for b in ctx.all(Booking) if b.client_id == self.client_id(family.key)),
                key=lambda b: b.starts_at,
            )
            if not visits:
                continue
            day = min((visits[0].starts_at - self.now).days - 6, -2)
            assessment = self.visit(
                f"{family.key}_assessment",
                family.key,
                ASSESSMENT,
                NADIA,
                day,
                note="Assessment. Summary and lesson plan sent to the parent the next day.",
            )
            if assessment is not None:
                self.registration(
                    family.key, assessment, assessment.starts_at - timedelta(hours=26)
                )
                self.sign(
                    f"{family.key}_policies",
                    family.key,
                    POLICIES,
                    assessment.starts_at - timedelta(hours=25),
                    None,
                )
        self.supplies()
        paid = sorted(
            (
                p
                for p in ctx.all(Payment)
                if p.method == "card"
                and p.invoice_id is not None
                and p.invoice_id.startswith("inv_ls_fill_julien")
                and p.paid_at is not None
                and p.paid_at < self.at(-40)
            ),
            key=lambda p: p.paid_at or self.now,
        )
        payment = paid[-1]
        assert payment.paid_at is not None
        self.refund(
            payment,
            3500,
            payment.paid_at + timedelta(days=1),
            "Lesson ended 30 minutes early when Julien was unwell; half refunded.",
        )
        card = self.gift_card(
            "bianchi", "bianchi", GIFT, 16000, self.at(-76, 12), recipient="Rosa Ferraro"
        )
        self.redeem(card, 8000, self.at(-41, 16))
        self.gift_card("roy", "roy", GIFT, 10000, self.at(-12, 18), recipient="Camille Roy")

    def supplies(self) -> None:
        """Books and strings sold with lessons, added to that lesson's invoice."""
        ctx = self.ctx
        sold = {MATH: MATH_BOOK, FRENCH: FRENCH_BOOK, PIANO: PIANO_BOOK, GUITAR: STRINGS}
        turn = 0
        slots = {slot.id: slot.item_id for slot in ctx.all(Slot)}
        named = {"thompson_1": TUNER, "bianchi_giulia_0": STRINGS}
        for booking in sorted(ctx.all(Booking), key=lambda b: (b.starts_at, b.id)):
            if booking.invoice_id is None or booking.starts_at < self.at(-150):
                continue
            if booking.id.removeprefix("bk_ls_") in named:
                continue
            item = slots[booking.slot_id]
            if item not in sold:
                continue
            turn += 1
            if turn % 11:
                continue
            self.line(booking.invoice_id, sold[item], booking.created_at, 1)
        for key, product in named.items():
            booking = ctx.get(Booking, f"bk_ls_{key}")
            if booking.invoice_id is not None:
                self.line(booking.invoice_id, product, booking.created_at, 1)

    def plans(self) -> None:
        # one piano package the Chens keep unassigned, for whichever child takes the lesson
        self.package("chen", TERM12, self.at(-6, 18), key="chen_shared")
        for key, bank in (("mensah", ("RBC Royal Bank", "4417")), ("campbell", None)):
            first = self.ctx.get(Booking, f"bk_ls_{key}_0")
            self.subscribe(key, PLAN, first.starts_at - timedelta(days=4, hours=4), bank=bank)
        self.subscribe("wong", PLAN, self.at(-163, 11))
        for index, day in enumerate(range(-160, -48, 7)):
            self.visit(
                f"wong_plan_{index:02}",
                "wong",
                MATH,
                NADIA,
                day,
                price=0,
                note="Included in the monthly plan.",
            )

    def family(self, key: str) -> Family:
        return next(f for f in FAMILIES if f.key == key)

    def registration(self, key: str, booking: Booking, submitted: datetime) -> None:
        family = self.family(key)
        kid = family.kids[0]
        subject = self.ctx.get(Subject, self.kid(key, 0))
        client = self.ctx.get(Client, self.client_id(key))
        wanted = {
            MATH: "Math",
            ENGLISH: "English",
            FRENCH: "French",
            SCIENCE: "Science",
            PIANO: "Piano",
            GUITAR: "Guitar",
        }
        slots = {b.slot_id for b in self.ctx.all(Booking) if b.client_id == client.id}
        lessons = sorted(
            {wanted[s.item_id] for s in self.ctx.all(Slot) if s.id in slots and s.item_id in wanted}
        ) or ["Math"]
        partner = "Their other parent" if len(key) % 2 else "Their grandmother"
        answers: dict[str, object] = {
            "student_name": kid.name,
            "student_birthday": str(subject.attributes["birthday"]),
            "grade": _grade(kid.grade),
            "school": kid.school,
            "parent_name": family.parent,
            "parent_phone": client.phone or "",
            "parent_email": client.email or "",
            "subjects": lessons,
            "learning_needs": kid.note
            or "Doing fine at school, but would like more confidence before tests.",
            "iep": "Being assessed" if key == "nwosu" else "No",
            "pickup": f"{family.parent}, or {partner.lower()}.",
            "walk_home": kid.grade >= 7,
            "emergency_name": f"{partner} ({family.parent.split()[-1]})",
            "emergency_phone": f"+1613555{(len(key) * 37) % 100 + 100:04}",
            "photo_consent": len(key) % 3 != 0,
            "policies": True,
        }
        if kid.allergies:
            answers["allergies"] = kid.allergies
        self.response(
            "registration",
            key,
            REGISTRATION,
            booking,
            answers,
            submitted,
            created=submitted - timedelta(hours=2),
            signature={"name": family.parent, "strokes": None, "ip": "192.0.2.61"},
        )

    def last_lesson(self, key: str, before: datetime | None = None) -> Booking:
        cutoff = before or self.now - timedelta(days=2)
        done = [
            b
            for b in self.ctx.all(Booking)
            if b.client_id == self.client_id(key)
            and b.status == "completed"
            and b.completed_at is not None
            and b.completed_at < cutoff
        ]
        return max(done, key=lambda b: b.starts_at)

    def paperwork(self) -> None:
        for number, family in enumerate(FAMILIES):
            if family.since is None or family.key == "nwosu":
                continue
            when = self.at(max(family.since + 1, -268 + number % 11), 19, 10)
            self.sign(f"{family.key}_policies", family.key, POLICIES, when, None)
            if family.since < -POLICIES_REVISED and number % 3 != 2:
                again = self.at(-POLICIES_REVISED + 2 + number % 9, 20)
                status = "pending" if family.key in {"park", "gill"} else "signed"
                self.sign(
                    f"{family.key}_policies_v2",
                    family.key,
                    POLICIES,
                    again,
                    None,
                    status=status,
                )
        feedback: tuple[tuple[str, int, list[str], str, bool], ...] = (
            (
                "bianchi",
                5,
                ["Patience", "Lesson notes for parents"],
                "Luca practises without being asked now, which has never happened before. "
                "Thank you, Sofia.",
                False,
            ),
            (
                "fontaine",
                5,
                ["Clear explanations", "Progress at school"],
                "Léa got 84 on her quadratics test. She says it finally makes sense.",
                False,
            ),
            (
                "desrosiers",
                5,
                ["Clear explanations", "Lesson notes for parents"],
                "Maëlle's essays are much more organized. The notes after each lesson help us "
                "follow along at home.",
                False,
            ),
            ("chen", 5, ["Patience", "Scheduling"], "", False),
            ("patel", 5, ["Progress at school", "Lesson notes for parents"], "", False),
            (
                "novak",
                4,
                ["Clear explanations"],
                "Good lessons. We'd like a few more practice questions to do between them.",
                True,
            ),
            (
                "gill",
                3,
                ["Clear explanations"],
                "Arjun likes the lessons, but his time was moved twice this month and that "
                "was hard to plan around.",
                True,
            ),
        )
        for key, rating, highlights, comment, follow_up in feedback:
            booking = self.last_lesson(key)
            assert booking.completed_at is not None
            submitted = min(
                booking.completed_at + timedelta(hours=26), self.now - timedelta(hours=3)
            )
            answers: dict[str, object] = {
                "rating": rating,
                "went_well": highlights,
                "follow_up": follow_up,
            }
            if comment:
                answers["comments"] = comment
            self.response(
                "feedback",
                key,
                FEEDBACK,
                booking,
                answers,
                submitted,
                created=booking.completed_at + timedelta(hours=2),
            )
        reregistered: tuple[tuple[str, dict[str, object]], ...] = (
            (
                "desrosiers",
                {
                    "continue": "Yes, same day and time",
                    "days": ["Wednesday"],
                    "time": "Early evening, 5:00 to 7:00",
                    "subjects": ["English"],
                    "notes": "Her first Grade 9 English exam is in January. Could we spend a "
                    "few lessons on exam-style essays?",
                },
            ),
            (
                "bianchi",
                {
                    "continue": "Yes, same day and time",
                    "subjects": ["Piano", "Guitar"],
                },
            ),
            (
                "kowalski",
                {
                    "continue": "Yes, at a different time",
                    "days": ["Monday", "Tuesday"],
                    "time": "After school, 3:30 to 5:00",
                    "subjects": ["Science"],
                    "notes": "Adam has basketball on Thursdays starting in January.",
                },
            ),
        )
        for key, answers in reregistered:
            booking = self.last_lesson(key)
            sent = self.now - timedelta(days=2, hours=3)
            self.response(
                "reregister",
                key,
                REREGISTER,
                booking,
                answers,
                min(sent + timedelta(hours=9), self.now - timedelta(hours=4)),
                created=sent,
            )
        for key in ("tran", "fontaine"):
            self.response(
                "reregister",
                key,
                REREGISTER,
                self.last_lesson(key),
                {},
                None,
                created=self.now - timedelta(days=2, hours=3),
            )

    def engagement(self) -> None:
        self.consents()
        self.withdraw("obrien", "email", self.at(-20, 21))
        self.broadcast(
            "fall_term",
            "Fall term lessons start next week",
            "Fall lessons start next week. Weekly lessons keep the same day, time and tutor as "
            "last term unless we've told you otherwise, and the schedule is in your booking "
            "emails. SAT prep starts on a Saturday in late September and has eight seats. If "
            "your child's after-school schedule has changed, reply to this email and we'll find "
            "a new time.",
            self.at(-49, 10),
        )
        for key in (
            "bianchi_luca_4",
            "fontaine_4",
            "desrosiers_3",
            "chen_olivia_4",
            "patel_diya_3",
            "mensah_2",
            "khoury_4",
            "roy_3",
            "sharma_4",
            "okafor_2",
        ):
            self.review(key)
        self.conversations()

    def conversations(self) -> None:
        ctx = self.ctx
        assessment = ctx.get(Booking, "bk_ls_nwosu_assessment")
        local = self.local(assessment.starts_at)
        when = assessment.created_at + timedelta(minutes=40)
        thread = self.thread("nwosu", "email", when)
        self.say(
            thread,
            "Hello, I booked an assessment for my son Chidi online. Should he bring anything? "
            "His report card says he's below grade level in reading.",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"Thanks, Amara. Please bring his last report card and a recent piece of writing "
            f"if you have one. The assessment is with me on {local:%A}, takes 45 minutes, and "
            "you're welcome to stay. I'll confirm the booking today and send a short summary "
            "the day after.",
            when + timedelta(hours=2),
        )
        missed = ctx.get(Booking, f"bk_ls_ahmed_{TERM_DONE - 1}")
        makeup = ctx.get(Booking, "bk_ls_ahmed_makeup")
        assert missed.canceled_at is not None
        when = missed.canceled_at
        thread = self.thread("ahmed", "sms", when)
        self.say(
            thread,
            "Hi, Zara has a fever and won't make her lesson tomorrow. Sorry for the short notice.",
            when - timedelta(minutes=30),
            sender=None,
        )
        slot = self.local(makeup.starts_at)
        self.say(
            thread,
            f"Thanks for letting us know, Yusuf. Feel better, Zara. Julien can do a make-up on "
            f"{slot:%A} at {slot:%I:%M %p}. Does that work?".replace(" 0", " "),
            when,
        )
        self.say(thread, "Yes, that works. Thank you.", when + timedelta(minutes=50), sender=None)
        self.say(
            thread,
            "Booked. There's no charge for the missed lesson.",
            when + timedelta(hours=1),
        )
        feedback = ctx.get(Booking, self.last_lesson("bianchi").id)
        assert feedback.completed_at is not None
        when = min(feedback.completed_at + timedelta(hours=27), self.now - timedelta(hours=2))
        thread = self.thread("bianchi", "email", when)
        self.say(
            thread,
            "Thank you for the lesson notes, Sofia. Luca has been practising every day this "
            "week. We've signed up both kids for next term.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thank you, Laura. Sofia was really pleased with how Luca played. We'll keep the "
            "same times for Luca and Giulia next term.",
            when + timedelta(hours=3),
        )
        when = self.now - timedelta(days=2, hours=3)
        thread = self.thread("desrosiers", "email", when)
        self.say(
            thread,
            "Hi Nadège, the fall term ends in four weeks. Maëlle has made good progress: her "
            "essays now have a clear thesis and paragraphs that support it, and Julien says "
            "she's working faster on timed writing. We'd suggest keeping her Wednesday time "
            "next term. The registration form for next term is in this email; please let us "
            "know by the end of the month.",
            when,
            sender=LAKESIDE_OWNER,
        )
        self.say(
            thread,
            "Thank you, Nadia. We'd like to keep the same time. I filled in the form and added "
            "a note about her January exam.",
            min(when + timedelta(hours=9), self.now - timedelta(hours=4)),
            sender=None,
        )
        self.say(
            thread,
            "Got it, thank you. Julien will plan three lessons on exam-style essays in December.",
            min(when + timedelta(hours=11), self.now - timedelta(hours=3)),
        )
        overdue = ctx.get(Invoice, "inv_ls_sullivan_overdue")
        if overdue.overdue_notified_at is not None:
            when = overdue.overdue_notified_at + timedelta(hours=2)
            thread = self.thread("sullivan", "email", when)
            self.say(
                thread,
                f"Hi Brendan, invoice {overdue.number} for Fiona's English lesson is now past "
                "due. You can pay by card from the link in the invoice email, or by e-Transfer "
                "to hello@lakeside.example.",
                when,
            )
            self.say(
                thread,
                "Sorry about that, it got buried. I'll send it this weekend.",
                when + timedelta(hours=6),
                sender=None,
            )
        gill = ctx.get(Booking, self.last_lesson("gill").id)
        assert gill.completed_at is not None
        when = min(gill.completed_at + timedelta(hours=30), self.now - timedelta(hours=2))
        thread = self.thread("gill", "email", when)
        self.say(
            thread,
            "Hi Navdeep, thank you for the feedback. You're right that Arjun's time moved "
            "twice this month, and that's on us: we were covering a tutor's absence. From next "
            "week he has the same time every week, and if we ever need to move it we'll ask "
            "you first.",
            when,
            sender=LAKESIDE_OWNER,
        )
        self.say(
            thread,
            "Thanks, Nadia. That helps a lot.",
            min(when + timedelta(hours=5), self.now - timedelta(hours=1)),
            sender=None,
        )
        extra = ctx.get(Booking, "bk_ls_park_extra")
        when = extra.starts_at + timedelta(minutes=20)
        thread = self.thread("park", "sms", when)
        local = self.local(extra.starts_at)
        self.say(
            thread,
            f"Hi Daniel, Jason hasn't arrived for his {local:%I:%M %p} lesson with Nadia. Is he "
            "on his way?".replace(" 0", " "),
            when,
        )
        self.say(
            thread,
            "So sorry, he stayed late for a team practice and forgot to tell us. Is his weekly "
            "lesson still on?",
            when + timedelta(minutes=45),
            sender=None,
        )
        self.say(
            thread,
            "Yes, his weekly lesson is still on. A missed lesson is usually charged, but as "
            "it's the first one this term we've waived it.",
            when + timedelta(hours=1),
        )
        session = ctx.get(Slot, "ses_ls_sat_3")
        when = min(session.starts_at - timedelta(days=4), self.now - timedelta(hours=5))
        thread = self.thread("kowalski", "email", when)
        self.say(
            thread,
            "Hi, Adam's friend wants to join the SAT prep class. Is there still room?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Marta, there's one seat left in the course. If his parents call or reply here, "
            "we can hold it for two days.",
            when + timedelta(hours=2),
        )
        mensah = ctx.get(Booking, "bk_ls_mensah_0")
        when = mensah.starts_at - timedelta(days=5)
        thread = self.thread("mensah", "email", when)
        self.say(
            thread,
            "Hi Yaw, Ama's monthly plan is set up. Four science lessons a month with Samuel "
            "at the same time each week, $260 a month by pre-authorized debit from your RBC "
            "account ending in 4417. You'll get a receipt by email after each debit.",
            when,
            sender=LAKESIDE_OWNER,
        )
        self.say(
            thread,
            "Thanks, that's all correct.",
            when + timedelta(hours=4),
            sender=None,
        )
        day = self.working_day(0)
        today = next(
            b
            for b in ctx.all(Booking)
            if b.id.startswith("bk_ls_li_") and self.local(b.starts_at).date() == day
        )
        local = self.local(today.starts_at)
        when = min(today.starts_at - timedelta(hours=20), self.now - timedelta(hours=1))
        thread = self.thread("li", "email", when)
        self.say(
            thread,
            f"Hi Jun, a reminder that Emma's piano lesson with Sofia is on {local:%A} at "
            f"{local:%I:%M %p}. Please bring her method book.".replace(" 0", " "),
            when,
        )


EDITION = Lakeside
