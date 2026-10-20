"""Inkwell Tattoo Collective: a three-artist studio on Main Street, built on the demo engine."""

from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.documents import FormResponse
from clientbridge.models.payments import Payment
from clientbridge.models.platform import File
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
from scripts.demo_context import demo_business
from scripts.demo_engine import ASSETS, Demo, Quote
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

INKWELL = "bz_inkwell"
OWNER = "us_iw_owner"
INBOX = "us_iw_harleen"

SASHA, MEI, KIERAN, DESK = "st_iw_owner", "st_iw_mei", "st_iw_kieran", "st_iw_harleen"
ARTISTS = (SASHA, MEI, KIERAN)
CONSULT, FLASH, FLASH_DAY = "it_iw_consult", "it_iw_flash", "it_iw_flash_day"
CUSTOM_2, CUSTOM_4, CUSTOM_6 = "it_iw_custom_2h", "it_iw_custom_4h", "it_iw_custom_6h"
CUSTOMS = (CUSTOM_2, CUSTOM_4, CUSTOM_6)
TOUCHUP, PIERCING = "it_iw_touchup", "it_iw_piercing"
BALM, WASH, FILM, GIFT = "it_iw_balm", "it_iw_soap", "it_iw_film", "it_iw_gift"
TATTOOS = (*CUSTOMS, FLASH, FLASH_DAY)
CONSENT_FORM, AFTERCARE_FORM, BRIEF_FORM, FEEDBACK_FORM = (
    "frm_iw_consent",
    "frm_iw_aftercare",
    "frm_iw_brief",
    "frm_iw_feedback",
)
POLICIES, PROJECT = "con_iw_policies", "con_iw_project"
# the policies' version 2 made deposits non-refundable this many days ago
POLICIES_REVISED = 120
SESSION_BUFFER = 30
SHORT_BUFFER = 15


def _hours(days: dict[int, tuple[int, int]]) -> dict[int, tuple[time, time]]:
    return {day: (time(start), time(end)) for day, (start, end) in days.items()}


# weekday (Monday is 0) -> start and end hour; the studio is closed on Monday
HOURS = {
    SASHA: _hours({1: (11, 19), 2: (11, 19), 3: (11, 19), 4: (11, 19), 5: (11, 19)}),
    MEI: _hours({1: (11, 19), 2: (11, 19), 3: (12, 20), 4: (11, 19), 5: (11, 19)}),
    KIERAN: _hours({2: (11, 19), 3: (11, 19), 4: (11, 19), 5: (11, 19), 6: (12, 18)}),
}


def _service(
    item_id: str,
    name: str,
    price: int,
    minutes: int,
    category: str,
    color: str,
    description: str,
    *,
    deposit: int | None = None,
    online: bool = True,
    buffer: int = SHORT_BUFFER,
) -> Offering:
    # tattooing and piercing are personal services, which BC's PST doesn't cover: GST only
    return Offering(
        id=item_id,
        kind="service",
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="federal_only",
        minutes=minutes,
        color=color,
        online_bookable=online,
        buffer_after_min=buffer,
        deposit_type="fixed" if deposit else "none",
        deposit_value=deposit,
    )


def _product(
    item_id: str,
    name: str,
    price: int,
    cost: int,
    sku: str,
    stock: Stock,
    description: str,
    *,
    dressing: bool = False,
) -> Offering:
    # aftercare balm and wash carry GST and PST; healing film is a dressing, exempt from PST
    return Offering(
        id=item_id,
        kind="product",
        name=name,
        price_cents=price,
        category="Aftercare",
        description=description,
        tax_class="federal_only" if dressing else "standard",
        sell_online=True,
        addon_for=TATTOOS,
        sku=sku,
        cost_cents=cost,
        stock=stock,
    )


ITEMS = (
    _service(
        CONSULT,
        "Consultation",
        0,
        30,
        "Consultations",
        "#5F7F6E",
        "Thirty minutes with an artist to talk through your idea, placement and size, look at "
        "your references and get a quote. Free, and the best first step for any custom piece.",
        buffer=0,
    ),
    _service(
        FLASH,
        "Flash piece",
        18000,
        60,
        "Flash",
        "#B5673F",
        "A small tattoo chosen from our artists' flash sheets, up to about 8 cm, in one sitting. "
        "Each design is tattooed a limited number of times.",
    ),
    _service(
        FLASH_DAY,
        "Flash day piece",
        12000,
        30,
        "Flash",
        "#C98A4B",
        "A palm-sized design from the flash day sheet, tattooed in about 30 minutes. Flash days "
        "run first come, first served at the front desk.",
        online=False,
    ),
    _service(
        CUSTOM_2,
        "Custom session, 2 hours",
        40000,
        120,
        "Custom",
        "#8C2F2F",
        "Two hours for an original design drawn for you, such as a fine-line floral or a "
        "forearm piece. A $100 non-refundable deposit is taken at booking and comes off your "
        "final session.",
        deposit=10000,
        online=False,
        buffer=SESSION_BUFFER,
    ),
    _service(
        CUSTOM_4,
        "Custom session, 4 hours",
        76000,
        240,
        "Custom",
        "#6E2430",
        "Half a day for a larger original piece, or one session of a multi-session project. "
        "A $150 non-refundable deposit is taken at booking and comes off your final session.",
        deposit=15000,
        online=False,
        buffer=SESSION_BUFFER,
    ),
    _service(
        CUSTOM_6,
        "Custom session, full day",
        108000,
        360,
        "Custom",
        "#4E1F2A",
        "Six hours with breaks, for sleeves, back pieces and other large work. A $200 "
        "non-refundable deposit is taken at booking and comes off your final session.",
        deposit=20000,
        online=False,
        buffer=SESSION_BUFFER,
    ),
    _service(
        TOUCHUP,
        "Touch-up",
        8000,
        30,
        "Touch-ups",
        "#7A6A5A",
        "A short visit to fill in spots that faded while healing. Free within three months of "
        "your session when you've followed the aftercare instructions, and $80 after that.",
    ),
    _service(
        PIERCING,
        "Ear or nose piercing",
        7000,
        30,
        "Piercing",
        "#5E6B8A",
        "A lobe, helix or nostril piercing with an implant-grade titanium stud, which is "
        "included. Downsizing the post after healing is free.",
    ),
    _product(
        BALM,
        "Aftercare balm, 50 g",
        2200,
        850,
        "IW-AC-BALM-50",
        Stock(34, 10),
        "An unscented balm of shea butter and calendula for the first weeks of healing. Apply "
        "a thin layer two or three times a day once the film is off.",
    ),
    _product(
        WASH,
        "Fragrance-free wash, 250 ml",
        1600,
        600,
        "IW-AC-WASH-250",
        Stock(21, 8),
        "A mild liquid soap with no fragrance or dyes, for washing a new tattoo or piercing.",
    ),
    _product(
        FILM,
        "Healing film, 15 cm x 1 m",
        2600,
        1050,
        "IW-AC-FILM-15",
        Stock(4, 6),
        "A breathable adhesive film to cut to size and wear for three to five days over a new "
        "tattoo. The same film we apply after your session.",
        dressing=True,
    ),
    Offering(
        id=GIFT,
        kind="gift",
        name="Gift card",
        price_cents=0,
        category="Gift cards",
        description="A gift card for any amount, good toward a consultation follow-up, a "
        "session, flash or aftercare. It doesn't expire.",
        tax_class="exempt",
        ref="gift",
    ),
)

POLICIES_V1 = (
    "Custom sessions take a deposit when you book, which comes off the price of your session. "
    "Deposits are refunded if you cancel at least seven days before your appointment. You can "
    "move a session with 48 hours' notice. You must be 18 or older and show photo ID at every "
    "appointment. Touch-ups are free within three months of your session."
)
POLICIES_BODY = "\n\n".join(
    (
        "These policies apply to every appointment at Inkwell Tattoo Collective. It is demo text "
        "for a fictional business, not legal advice.",
        "Deposits\nCustom sessions take a deposit when you book: $100 for two hours, $150 for "
        "four and $200 for a full day. The deposit is non-refundable and comes off the price of "
        "your final session, so for a piece that takes more than one session, it's held until "
        "the last one.",
        "Moving an appointment\nYou can move a session once, with at least 72 hours' notice, "
        "and the deposit moves with it. A second move, or a move with less notice, needs a new "
        "deposit.",
        "Missed appointments\nIf you miss a session or cancel with less than 72 hours' notice, "
        "the deposit is kept to cover the time your artist set aside and the drawing they "
        "prepared.",
        "Age and ID\nYou must be 18 or older and show government photo ID at every appointment. "
        "We don't tattoo or pierce anyone under 18, even with a parent's consent.",
        "Your health\nPlease reschedule if you're unwell, pregnant or breastfeeding, or have "
        "sunburn or broken skin where you're being tattooed. Tell us about medications and "
        "allergies on the consent form, and don't drink alcohol in the 24 hours before your "
        "session.",
        "Designs\nYour artist draws your design and shows it to you at the start of your "
        "session. The drawing stays with the artist, who may post the healed tattoo unless you "
        "ask them not to.",
        "Touch-ups\nTouch-ups are free within three months of your session if you've followed "
        "the aftercare instructions. After that, a touch-up is $80.",
        "Payment\nWe take debit, credit, cash and e-Transfer. Tips are welcome and go to your "
        "artist.",
    )
)
PROJECT_BODY = "\n\n".join(
    (
        "This agreement covers a tattoo that takes more than one session, such as a sleeve or a "
        "back piece. It is demo text for a fictional business, not legal advice.",
        "The plan\nYour artist draws the full design before the first session and estimates how "
        "many sessions it will take. The estimate is a guide: skin, placement and healing can "
        "add or remove a session.",
        "Booking the sessions\nWe book the sessions together, usually four to six weeks apart so "
        "each part heals before the next. Each session is paid on the day at the session rate.",
        "Deposit\nOne deposit holds the whole project. It's non-refundable and comes off the "
        "price of the final session.",
        "Changes to the design\nSmall changes are part of the process. A change that means "
        "redrawing a finished section, or reworking skin that's already tattooed, may add a "
        "session.",
        "Pausing or stopping\nYou can pause the project at any time. If you stop before it's "
        "finished, the sessions you've had and the deposit aren't refunded, and your artist "
        "will finish the edges of what's done so it looks complete.",
        "Photos\nYour artist may photograph each session for their portfolio. We won't show your "
        "face, and we'll ask before posting the finished piece.",
    )
)
CONSENT_FIELDS: tuple[DocField, ...] = (
    ("legal_name", "text", "Full legal name", "As it appears on your photo ID.", True, ()),
    ("date_of_birth", "date", "Date of birth", None, True, ()),
    (
        "id_type",
        "select",
        "Photo ID shown at the front desk",
        "We check ID at every appointment. You must be 18 or older to be tattooed or pierced.",
        True,
        ("BC driver's licence", "BC Services Card with photo", "Passport", "Other government ID"),
    ),
    ("id_confirmed", "checkbox", "I'm 18 or older and showed valid photo ID", None, True, ()),
    ("emergency_contact", "text", "Emergency contact name and phone", None, False, ()),
    (
        "conditions",
        "multiselect",
        "Do any of these apply to you?",
        "This helps your artist plan the session. It stays private to the studio.",
        False,
        (
            "Diabetes",
            "Heart condition",
            "Bleeding or clotting disorder",
            "Epilepsy or seizures",
            "Immune condition",
            "Skin condition where you're being tattooed",
            "Keloid or raised scarring",
            "Fainting around needles",
        ),
    ),
    (
        "medications",
        "longtext",
        "Medications you take regularly",
        "Include blood thinners, acne medication such as isotretinoin, and steroids.",
        False,
        (),
    ),
    (
        "allergies",
        "multiselect",
        "Allergies",
        None,
        False,
        (
            "Latex",
            "Nickel or other metals",
            "Tattoo pigments",
            "Adhesive tape or bandages",
            "Antibiotic ointment",
            "Fragrance",
        ),
    ),
    ("allergy_notes", "text", "Other allergies or reactions", None, False, ()),
    (
        "pregnant",
        "select",
        "Are you pregnant or breastfeeding?",
        "We don't tattoo or pierce during pregnancy or while breastfeeding.",
        True,
        ("No", "Pregnant", "Breastfeeding"),
    ),
    (
        "sober",
        "checkbox",
        "I haven't had alcohol or recreational drugs in the last 24 hours",
        None,
        True,
        (),
    ),
    ("ate", "checkbox", "I've eaten in the last few hours", None, False, ()),
    (
        "permanent",
        "checkbox",
        "I understand a tattoo is permanent, and that lines and colour soften as it heals and ages",
        None,
        True,
        (),
    ),
    (
        "design_approved",
        "checkbox",
        "I've checked the stencil's size, placement and any lettering",
        None,
        True,
        (),
    ),
    (
        "release",
        "checkbox",
        "I release the studio and my artist from responsibility for problems that come from not "
        "following the aftercare instructions",
        None,
        True,
        (),
    ),
    (
        "photos",
        "select",
        "May we post photos of your tattoo?",
        "We never show your face without asking first.",
        True,
        ("Yes", "Yes, but don't tag me", "No"),
    ),
)
AFTERCARE_FIELDS: tuple[DocField, ...] = (
    (
        "film",
        "checkbox",
        "I'll leave the healing film on for three to five days, and take it off sooner if it "
        "fills with fluid or lifts at the edges",
        None,
        True,
        (),
    ),
    (
        "wash",
        "checkbox",
        "I'll wash the tattoo gently with fragrance-free soap and pat it dry",
        None,
        True,
        (),
    ),
    (
        "balm",
        "checkbox",
        "I'll apply a thin layer of balm two or three times a day once the film is off",
        None,
        True,
        (),
    ),
    (
        "avoid",
        "checkbox",
        "I'll keep it out of pools, hot tubs, the ocean and direct sun for two weeks",
        None,
        True,
        (),
    ),
    ("no_pick", "checkbox", "I won't pick or scratch at it while it peels", None, True, ()),
    (
        "infection",
        "checkbox",
        "I know the signs of infection, such as spreading redness, heat or fever, and will see a "
        "doctor if they appear",
        None,
        True,
        (),
    ),
    (
        "touchup",
        "checkbox",
        "I understand a touch-up is free within three months when I follow these instructions",
        None,
        True,
        (),
    ),
    ("questions", "longtext", "Questions for your artist", None, False, ()),
)
BRIEF_FIELDS: tuple[DocField, ...] = (
    (
        "idea",
        "longtext",
        "Tell us about your idea",
        "What it shows, the feeling you want, and anything it means to you that you'd like to "
        "share.",
        True,
        (),
    ),
    (
        "placement",
        "select",
        "Placement",
        None,
        True,
        (
            "Forearm",
            "Upper arm",
            "Shoulder",
            "Half sleeve",
            "Full sleeve",
            "Back",
            "Chest",
            "Ribs",
            "Hip",
            "Thigh",
            "Calf",
            "Ankle",
            "Wrist or hand",
            "Other",
        ),
    ),
    (
        "placement_notes",
        "text",
        "Where exactly?",
        "For example, inner left forearm, from the wrist to the elbow.",
        False,
        (),
    ),
    (
        "size",
        "select",
        "Roughly how big?",
        None,
        True,
        ("Under 5 cm", "5 to 10 cm", "10 to 20 cm", "Over 20 cm", "Not sure"),
    ),
    (
        "colour",
        "select",
        "Colour or black and grey?",
        None,
        True,
        ("Colour", "Black and grey", "Black linework only", "Not sure"),
    ),
    (
        "style",
        "select",
        "Style",
        None,
        False,
        (
            "Fine line",
            "Traditional",
            "Neo-traditional",
            "Blackwork",
            "Japanese-inspired",
            "Realism",
            "Not sure",
        ),
    ),
    (
        "artist",
        "select",
        "Artist",
        None,
        False,
        ("Sasha Moreno", "Mei Chen", "Kieran Walsh", "No preference"),
    ),
    (
        "reference_1",
        "image",
        "Reference image",
        "Photos, drawings or tattoos you like. Your artist draws an original design from them.",
        False,
        (),
    ),
    ("reference_2", "image", "Another reference image", None, False, ()),
    (
        "cover_up",
        "checkbox",
        "This will cover or rework a tattoo I already have",
        None,
        False,
        (),
    ),
    (
        "skin_notes",
        "longtext",
        "Scars, birthmarks or other tattoos near the spot",
        None,
        False,
        (),
    ),
    ("budget", "currency", "Budget", None, False, ()),
    ("availability", "text", "Days and times that suit you", None, False, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your session?", None, True, ()),
    (
        "wait",
        "select",
        "How long did you wait for your appointment?",
        None,
        False,
        ("Under 2 weeks", "2 to 6 weeks", "More than 6 weeks"),
    ),
    ("comments", "longtext", "Anything you'd like to tell us?", None, False, ()),
    ("book_again", "checkbox", "I'd get tattooed here again", None, False, ()),
)

# key, name, preferred channel, days since they first came in (None: dated by their bookings)
CLIENTS: tuple[tuple[str, str, str, int | None], ...] = (
    ("noor", "Noor El Amrani", "email", None),
    ("tomas", "Tomás Herrera", "sms", None),
    ("brady", "Brady Kowalski", "sms", None),
    ("anika", "Anika Sharma", "sms", -430),
    ("kenji", "Kenji Watanabe", "sms", -260),
    ("jordan", "Jordan Lee", "sms", None),
    ("lucia", "Lucía Ortega", "email", -310),
    ("hana", "Hana Park", "sms", None),
    ("olu", "Oluwaseun Adeyemi", "email", -390),
    ("graham", "Graham Fraser", "email", None),
    ("aiden", "Aiden Murphy", "sms", -520),
    ("mateo", "Mateo Silva", "sms", -350),
    ("jaspreet", "Jaspreet Gill", "sms", -470),
    ("harjot", "Harjot Dhaliwal", "sms", -290),
    ("linh", "Linh Tran", "sms", -400),
    ("minh", "Minh Nguyen", "sms", -330),
    ("rosa", "Rosa Delgado", "email", -560),
    ("camille", "Camille Tremblay", "email", -480),
    ("ethan", "Ethan Wong", "sms", -240),
    ("chloe", "Chloe Lam", "sms", -300),
    ("farid", "Farid Karimi", "email", -540),
    ("shirin", "Shirin Moradi", "sms", -270),
    ("marisol", "Marisol Reyes", "sms", -450),
    ("joel", "Joel Santos", "sms", -380),
    ("kai", "Kai Thompson", "sms", None),
    ("tala", "Tala Joseph", "sms", -320),
    ("dev", "Dev Malhotra", "sms", None),
    ("simran", "Simran Bains", "sms", -260),
    ("yuna", "Yuna Kim", "sms", -230),
    ("jihoon", "Ji-hoon Choi", "sms", -410),
    ("isabel", "Isabel Cruz", "email", -360),
    ("nathan", "Nathan Bergeron", "sms", -500),
    ("sofia", "Sofia Petrov", "sms", -280),
    ("emeka", "Emeka Obi", "sms", -440),
    ("zoe", "Zoe Campbell", "email", -510),
    ("liam", "Liam O'Connor", "sms", -340),
    ("maya", "Maya Goldstein", "email", -420),
    ("arjun", "Arjun Rao", "sms", -390),
    ("amelia", "Amelia Hughes", "email", -460),
    ("ronan", "Ronan Fitzgerald", "sms", None),
    ("bea", "Beatriz Lopes", "sms", None),
    ("wei", "Wei Zhang", "sms", -370),
    ("xin", "Xinyi Liu", "sms", -250),
    ("leon", "Leon Fischer", "email", -490),
    ("parisa", "Parisa Ahmadi", "sms", -300),
    ("dante", "Dante Morales", "sms", -530),
    ("ivy", "Ivy Chan", "email", -550),
    ("omar", "Omar Haddad", "sms", -310),
    ("jessie", "Jessie Tsang", "sms", -240),
    ("ruby", "Ruby Arora", "sms", -220),
    ("cole", "Cole Anderson", "sms", -280),
    ("naomi", "Naomi Ito", "email", -430),
    ("ana", "Ana Mendoza", "sms", None),
    ("theo", "Theo Russo", "sms", -500),
    ("kiana", "Kiana Wilson", "sms", None),
    ("raj", "Raj Patel", "sms", -360),
    ("eli", "Eli Cohen", "sms", None),
    ("mira", "Mira Novak", "sms", None),
    ("sam", "Sam Okoro", "sms", None),
    ("tess", "Tess MacDonald", "sms", None),
)
SOURCES = ("instagram", "a friend", "google", "walk-in", "instagram")
# each artist's regular custom clients
POOLS: dict[str, tuple[str, ...]] = {
    SASHA: (
        "aiden",
        "farid",
        "camille",
        "theo",
        "marisol",
        "arjun",
        "zoe",
        "dante",
        "liam",
        "maya",
        "leon",
        "sofia",
        "nathan",
        "amelia",
        "cole",
    ),
    MEI: (
        "linh",
        "yuna",
        "ivy",
        "naomi",
        "ruby",
        "chloe",
        "jessie",
        "xin",
        "shirin",
        "parisa",
        "isabel",
        "simran",
        "rosa",
        "tala",
    ),
    KIERAN: (
        "jaspreet",
        "harjot",
        "emeka",
        "minh",
        "mateo",
        "joel",
        "ethan",
        "jihoon",
        "wei",
        "omar",
        "raj",
        "olu",
        "kenji",
    ),
}
# custom session lengths each artist usually books, in rotation
MIX: dict[str, tuple[str, ...]] = {
    SASHA: (CUSTOM_4, CUSTOM_6, CUSTOM_2, CUSTOM_4, CUSTOM_6),
    MEI: (CUSTOM_2, CUSTOM_2, CUSTOM_4, CUSTOM_2, FLASH),
    KIERAN: (CUSTOM_4, CUSTOM_2, CUSTOM_4, CUSTOM_6, FLASH),
}
SESSIONS_PER_WEEK = {SASHA: 4, MEI: 5, KIERAN: 4}
# summer is quieter, since a new tattoo has to stay out of the sun and the water
SEASON = {
    1: 0.9,
    2: 0.95,
    3: 1.0,
    4: 1.0,
    5: 1.05,
    6: 0.9,
    7: 0.8,
    8: 0.8,
    9: 1.0,
    10: 1.05,
    11: 1.1,
    12: 1.0,
}
FILL_POOL = (
    "kai",
    "linh",
    "aiden",
    "jihoon",
    "chloe",
    "mateo",
    "tala",
    "zoe",
    "minh",
    "simran",
    "dante",
    "xin",
    "joel",
    "isabel",
    "liam",
    "parisa",
    "harjot",
    "camille",
    "wei",
    "jessie",
    "raj",
    "rosa",
)
# today's book for each artist in order from opening; Kieran's session with Kenji is under way
TODAY: dict[str, tuple[tuple[str, str], ...]] = {
    SASHA: (("theo", CUSTOM_2), ("kiana", CONSULT), ("leon", CUSTOM_2)),
    MEI: (("yuna", FLASH), ("ruby", PIERCING), ("ivy", CUSTOM_2), ("naomi", TOUCHUP)),
    KIERAN: (("jihoon", TOUCHUP),),
}
FLASH_DAY_CLIENTS: dict[str, tuple[str, ...]] = {
    SASHA: ("bea", "sam", "maya", "kai", "zoe", "eli", "amelia"),
    MEI: ("tess", "xin", "ana", "simran", "jessie", "mira", "chloe"),
    KIERAN: ("dev", "ethan", "omar", "sofia", "raj", "tala"),
}
PHOTO_CLIENTS = (
    "noor",
    "tomas",
    "anika",
    "kenji",
    "jordan",
    "lucia",
    "hana",
    "olu",
    "aiden",
    "jaspreet",
    "linh",
    "camille",
    "farid",
    "marisol",
    "yuna",
    "emeka",
    "zoe",
    "arjun",
    "ivy",
    "naomi",
    "ruby",
    "theo",
)
CONDITIONS: dict[str, tuple[list[str], str, list[str], str]] = {
    "anika": ([], "None.", [], ""),
    "kenji": (
        [],
        "Vitamin D in the winter.",
        ["Adhesive tape or bandages"],
        "Medical tape leaves a rash, so use the film instead.",
    ),
    "olu": (["Fainting around needles"], "None.", [], ""),
    "lucia": ([], "Birth control pill.", ["Fragrance"], ""),
    "graham": ([], "Low-dose aspirin, daily.", [], ""),
    "hana": ([], "None.", ["Nickel or other metals"], ""),
}


def _email(name: str) -> str:
    plain = name.translate(str.maketrans("áí", "ai")).replace("'", "").replace("-", "")
    return ".".join(plain.lower().split()) + "@example.test"


def _clock(when: datetime) -> str:
    return f"{when:%A, %B} {when.day} at {when:%I:%M %p}".replace(" 0", " ")


SPEC = BusinessSpec(
    listing=demo_business(INKWELL),
    code="iw",
    slug="inkwell",
    login_domain="inkwell.example",
    owner=OWNER,
    people=(
        Person(
            OWNER,
            SASHA,
            "owner",
            "Sasha Moreno",
            "+16725550190",
            "owner",
            "Owner and tattoo artist",
            "#8C2F2F",
            HOURS[SASHA],
        ),
        Person(
            "us_iw_mei",
            MEI,
            "mei",
            "Mei Chen",
            "+16725550191",
            "staff",
            "Resident artist, fine line",
            "#5E7B8A",
            HOURS[MEI],
            payee=True,
            rate_type="percent",
            rate_bps=5500,
        ),
        Person(
            "us_iw_kieran",
            KIERAN,
            "kieran",
            "Kieran Walsh",
            "+16725550192",
            "staff",
            "Resident artist, traditional colour",
            "#B5673F",
            HOURS[KIERAN],
            payee=True,
            rate_type="percent",
            rate_bps=6000,
        ),
        Person(
            INBOX,
            DESK,
            "harleen",
            "Harleen Sandhu",
            "+16725550193",
            "admin",
            "Front desk coordinator",
            "#6B7280",
            bookable_online=False,
        ),
    ),
    items=ITEMS,
    brand={
        "tagline": "Custom, fine-line and traditional tattoos on Main Street in Mount Pleasant.",
        "about": (
            "Inkwell is a private studio of three tattoo artists on Main Street. Sasha Moreno "
            "opened it after ten years at shops in Vancouver and Montréal, and does large "
            "custom work and sleeves. Mei Chen draws fine-line and botanical pieces and does "
            "our piercing, and Kieran Walsh works in traditional colour. Custom pieces start "
            "with a free consultation, and a non-refundable deposit holds your session. We're "
            "open Tuesday to Sunday by appointment, with walk-ins on flash days."
        ),
        "address": "2418 Main Street, Vancouver, BC V5T 3E2",
        "phone": "+1 672-555-0198",
        "email": "hello@inkwell.example",
        "website": "https://inkwell.example",
        "neighbourhood": "Mount Pleasant",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "horizon_days": 120,
        "step_min": 30,
        "cancel_cutoff_hours": 72,
        "reschedule_cutoff_hours": 72,
        "max_reschedules": 1,
    },
    subject=None,
    sms_number="+16725550199",
    gst_hst_number="742196385RT0001",
    pst_number="PST-1093-4471",
    forms=(
        FormSpec(
            CONSENT_FORM,
            "Consent and release",
            "ff_iw_consent_",
            CONSENT_FIELDS,
            require_signature=True,
            send_on="booking",
        ),
        FormSpec(
            AFTERCARE_FORM,
            "Aftercare acknowledgement",
            "ff_iw_aftercare_",
            AFTERCARE_FIELDS,
            require_signature=True,
        ),
        FormSpec(BRIEF_FORM, "Design brief", "ff_iw_brief_", BRIEF_FIELDS),
        FormSpec(FEEDBACK_FORM, "Session feedback", "ff_iw_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(
            POLICIES,
            "Booking and deposit policy",
            POLICIES_BODY,
            version=2,
            earlier_body=POLICIES_V1,
            revised_day=-POLICIES_REVISED,
        ),
        ContractSpec(PROJECT, "Multi-session project agreement", PROJECT_BODY),
    ),
    storyline=(
        Stage(
            "New client after a consultation, design brief and references in",
            "noor",
            ("bk_iw_noor_consult", "fr_iw_brief_noor"),
        ),
        Stage("Custom piece booked, deposit paid", "tomas", ("bk_iw_tomas",)),
        Stage("No-show who forfeited the deposit", "brady", ("bk_iw_brady",)),
        Stage("Sleeve partway through its sessions", "anika", ("sch_iw_anika",)),
        Stage("Today's sessions, one checked in", "kenji", ("bk_iw_kenji",)),
        Stage("Flash day with short walk-in slots", "jordan", ("bk_iw_flashday_jordan",)),
        Stage("Aftercare sold with the session", "lucia", ("bk_iw_lucia", "inv_iw_lucia")),
        Stage("Free touch-up booked", "hana", ("bk_iw_hana_touchup",)),
        Stage("Five-star feedback", "olu", ("fr_iw_feedback_olu",)),
        Stage("Four-star feedback about the wait", "graham", ("fr_iw_feedback_graham",)),
    ),
    pacing=Pacing(
        {SASHA: 2, MEI: 3, KIERAN: 2},
        (CONSULT, FLASH, CONSULT, TOUCHUP, FLASH),
        weeks=30,
        ahead_weeks=5,
        seasonality=SEASON,
        settlements=("card", "card", "cash", "card", "etransfer", "card", "cash"),
        cancel_every=19,
    ),
    photo_clients=PHOTO_CLIENTS,
    inbox_user=INBOX,
    founded_day=-660,
    catalog_day=-650,
    documents_day=-645,
    restock_days=(-230, -180, -130, -85, -45, -12),
    invoice_start=1300,
    cheque_start=2200,
    seed=47,
)


class Inkwell(Demo):
    spec = SPEC

    def story(self) -> None:
        self.clients()
        self.away()
        self.sleeve()
        self.today()
        self.flash_day()
        self.storyline()
        self.sessions()
        self.piercings()
        self.fill(list(FILL_POOL))
        self.paperwork()
        self.photos()
        self.engagement()

    def staff_name(self, staff: str) -> str:
        return next(p.name for p in self.spec.people if p.staff_id == staff).split()[0]

    def key_of(self, booking: Booking) -> str:
        return booking.client_id.removeprefix("cl_iw_")

    def visit_note(self, item: Item, booking: Booking) -> str:
        return f"{item.name} with {self.staff_name(booking.staff_id or SASHA)}."

    def tip(self, booking: Booking) -> tuple[str, int] | None:
        if booking.staff_id is None or not booking.price_cents or self.rng.random() < 0.15:
            return None
        share = self.rng.choice((0.15, 0.18, 0.2, 0.2, 0.25))
        return booking.staff_id, max(1000, round(booking.price_cents * share / 500) * 500)

    def bill(
        self, booking: Booking, settle: Settle, *, tip: tuple[str, int] | None = None
    ) -> Invoice | None:
        """Sessions are paid at the desk once the tattoo is wrapped, with a tip on most cards."""
        if booking.completed_at is None or not booking.price_cents or booking.package_id:
            return None
        if tip is None and settle == "card":
            tip = self.tip(booking)
        key = booking.id.removeprefix("bk_iw_")
        item = self.items[self.ctx.get(Slot, booking.slot_id).item_id]
        invoice = self.invoice(
            key,
            self.key_of(booking),
            booking.completed_at + timedelta(minutes=2),
            booking.created_at,
            "",
        )
        invoice.notes = self.visit_note(item, booking)
        booking.invoice_id = invoice.id
        self.line(invoice.id, item.id, booking.created_at, booking=booking)
        self.settle(invoice, self.key_of(booking), settle, tip=tip)
        return invoice

    def settle(
        self,
        invoice: Invoice,
        client_key: str,
        settle: Settle,
        *,
        tip: tuple[str, int] | None = None,
    ) -> Payment | None:
        issued = invoice.issued_at or self.now
        transfer = (issued + timedelta(hours=4)).replace(minute=20)
        if settle == "etransfer" and transfer < self.now:
            paid, method = transfer, "etransfer"
        elif settle == "cash":
            paid, method = issued + timedelta(minutes=2), "cash"
        else:
            paid, method = issued + timedelta(minutes=3), "card"
        if paid >= self.now:
            return None
        return self.payment(
            client_key,
            paid,
            "etransfer" if method == "etransfer" else "cash" if method == "cash" else "card",
            invoice_id=invoice.id,
            size="balance",
            tip=tip if method == "card" else None,
        )

    def clients(self) -> None:
        for index, (key, name, channel, since) in enumerate(CLIENTS):
            self.client(
                key,
                name,
                _email(name),
                f"+1672555{100 + index:04}",
                channel="email" if channel == "email" else "sms",
                fields={"source": SOURCES[index % len(SOURCES)]},
                since=None if since is None else self.at(since, 12),
            )

    def at_local(self, day: date, hour: int, minute: int = 0) -> datetime:
        return datetime.combine(day, time(hour, minute), self.ctx.zone).astimezone(UTC)

    def fixed(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        start: datetime,
        status: BookingStatus,
        created: datetime,
        *,
        price: int | None = None,
    ) -> Booking:
        """A booking at an exact time, which must fit the artist's hours and calendar."""
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        if not self.within_hours(staff, start, end):
            raise ValueError(f"{key}: outside {staff}'s hours")
        if not self.free(staff, None, start, end, 0, item.buffer_after_min):
            raise ValueError(f"{key}: overlaps another booking of {staff}'s")
        return self.book(key, client_key, item_id, staff, start, status, created, price=price)

    def sitting(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        day: int,
        *,
        lead_days: int = 21,
        settle: Settle = "card",
        status: BookingStatus | None = None,
    ) -> Booking | None:
        """A tattoo booked `lead_days` ahead with its deposit, billed once it's done."""
        past = day < 0
        start = self.place(staff, item_id, day, None, past=past, forward=not past)
        if start is None:
            return None
        created = min(start - timedelta(days=lead_days), self.now - timedelta(hours=5))
        booking = self.book(
            key,
            client_key,
            item_id,
            staff,
            start,
            status or ("completed" if past else "confirmed"),
            created,
        )
        if booking.deposit_amount_cents:
            self.deposit(booking, created + timedelta(minutes=10))
            self.policies(client_key, created + timedelta(minutes=8))
        if booking.status == "completed":
            self.bill(booking, settle)
        return booking

    def policies(self, client_key: str, when: datetime) -> None:
        signature = f"sig_iw_{client_key}_policies"
        if not any(getattr(row, "id", None) == signature for row in self.ctx.rows):
            self.sign(f"{client_key}_policies", client_key, POLICIES, when, None)

    def away(self) -> None:
        today = self.local(self.now).date()
        july = today - timedelta(days=100 + today.weekday())
        self.time_off(
            "mei_summer",
            MEI,
            self.at_local(july, 0),
            self.at_local(july + timedelta(days=6), 23),
            "Vacation",
        )
        thursday = today + timedelta(days=(3 - today.weekday()) % 7 + 21)
        self.time_off(
            "kieran_convention",
            KIERAN,
            self.at_local(thursday, 0),
            self.at_local(thursday + timedelta(days=3), 23),
            "Guest spot at a tattoo convention in Seattle",
        )

    def sleeve(self) -> None:
        """Anika's right-arm sleeve: six full days four weeks apart, the deposit on the last."""
        recurrence = self.series(
            "anika",
            "anika",
            CUSTOM_6,
            SASHA,
            weekday=3,
            at=time(12),
            every=4,
            visits=6,
            before=3,
        )
        bookings = sorted(
            (b for b in self.ctx.all(Booking) if b.id.startswith("bk_iw_anika_")),
            key=lambda b: b.starts_at,
        )
        final = bookings[-1]
        for booking in bookings[:-1]:
            booking.deposit_amount_cents = 0
            booking.deposit_status = "none"
        self.deposit(final, recurrence.created_at + timedelta(minutes=12))
        self.sign(
            "anika_project", "anika", PROJECT, recurrence.created_at + timedelta(minutes=5), None
        )
        self.policies("anika", recurrence.created_at + timedelta(minutes=6))
        self.note(
            "cl_iw_anika",
            "client",
            "Right arm, Japanese-inspired colour sleeve: koi swimming up from the wrist, waves "
            "and maple leaves, wind bars on the shoulder. Six full days planned. Deposit held "
            "for the last session.",
            recurrence.created_at,
        )
        done = [b for b in bookings if b.status == "completed"]
        for index, booking in enumerate(done):
            self.note(
                booking.id,
                "booking",
                (
                    "Linework for the whole sleeve, and the koi shaded.",
                    "Koi coloured. Started the waves on the inner forearm.",
                    "Waves and the first maple leaves. Next time: wind bars and the shoulder.",
                )[index % 3],
                booking.created_at,
            )
        last = done[-1]
        assert last.completed_at is not None
        when = last.completed_at - timedelta(minutes=8)
        self.ctx.add(
            File(
                id="fl_iw_anika_sleeve",
                business_id=INKWELL,
                parent_type="booking",
                parent_id=last.id,
                purpose="photo",
                s3_key=f"{INKWELL}/demo/iw_photo_sleeve.jpg",
                content_type="image/jpeg",
                size=(ASSETS / "iw_photo_sleeve.jpg").stat().st_size,
                created_at=when,
                updated_at=when,
            )
        )

    def book_day(self) -> tuple[date, str, datetime, bool]:
        """Kenji's session under way now with whichever artist is in, else tomorrow's book."""
        local = self.local(self.now)
        anchor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        anchor -= timedelta(minutes=75)
        length = timedelta(minutes=self.items[CUSTOM_4].duration_min or 240)
        for staff in (KIERAN, SASHA, MEI):
            if self.within_hours(staff, anchor, anchor + length) and self.free(
                staff, None, anchor, anchor + length, 0, SESSION_BUFFER
            ):
                return local.date(), staff, anchor.astimezone(UTC), True
        day = local.date()
        while True:
            day += timedelta(days=1)
            working = [staff for staff in (KIERAN, SASHA, MEI) if self.hours_on(staff, day)]
            if len(working) < 2:
                continue
            start = self.at_local(day, 12)
            if self.free(working[0], None, start, start + length, 0, SESSION_BUFFER):
                return day, working[0], start, False

    def today(self) -> None:
        day, artist, anchor, live = self.book_day()
        kenji = self.fixed(
            "kenji",
            "kenji",
            CUSTOM_4,
            artist,
            anchor,
            "confirmed",
            min(anchor - timedelta(days=38), self.now - timedelta(days=1)),
        )
        self.deposit(kenji, kenji.created_at + timedelta(minutes=10))
        self.policies("kenji", kenji.created_at + timedelta(minutes=8))
        if live:
            kenji.checked_in_at = kenji.starts_at - timedelta(minutes=6)
        self.note(
            kenji.id,
            "booking",
            "Tiger on the left upper arm, about 20 cm, bold lines and full colour. Stencil "
            "approved at the consultation. Kenji reacts to medical tape, so use the healing film.",
            kenji.created_at,
        )
        step = timedelta(minutes=15)
        for staff, plan in TODAY.items():
            window = self.hours_on(staff, day)
            if window is None:
                continue
            cursor = self.at_local(day, window[0].hour, window[0].minute)
            for index, (client_key, item_id) in enumerate(plan):
                item = self.items[item_id]
                length = timedelta(minutes=item.duration_min or 60)
                while self.within_hours(staff, cursor, cursor + length) and (
                    not self.free(staff, None, cursor, cursor + length, 0, item.buffer_after_min)
                    or cursor < self.now < cursor + length
                ):
                    cursor += step
                key = f"today_{staff.removeprefix('st_iw_')}_{index}"
                if not self.within_hours(staff, cursor, cursor + length):
                    # a full day moves the rest of the plan to the artist's next opening
                    ahead = (day - self.local(self.now).date()).days + 1
                    self.sitting(key, client_key, item_id, staff, ahead, lead_days=5)
                    continue
                self.chair(key, client_key, item_id, staff, cursor, index)
                cursor += length + timedelta(minutes=item.buffer_after_min)

    def chair(
        self, key: str, client_key: str, item_id: str, staff: str, start: datetime, index: int
    ) -> None:
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        lead = 30 if item_id in CUSTOMS else 3 + index * 2
        created = min(start - timedelta(days=lead), self.now - timedelta(hours=6))
        status: BookingStatus = "completed" if end <= self.now else "confirmed"
        price = 0 if item_id == TOUCHUP else None
        booking = self.fixed(key, client_key, item_id, staff, start, status, created, price=price)
        if booking.deposit_amount_cents:
            self.deposit(booking, created + timedelta(minutes=10))
            self.policies(client_key, created + timedelta(minutes=8))
        if start <= self.now:
            booking.checked_in_at = start - timedelta(minutes=4)
        if end <= self.now - timedelta(minutes=10):
            self.bill(booking, "cash" if index == 1 else "card")

    def flash_day(self) -> None:
        """Last month's flash day: every artist on the flash sheet, in 30-minute slots."""
        today = self.local(self.now).date()
        day = today - timedelta(days=(today.weekday() - 5) % 7 + 21)
        sold = 0
        for staff, keys in FLASH_DAY_CLIENTS.items():
            window = self.hours_on(staff, day)
            assert window is not None
            cursor = self.at_local(day, window[0].hour)
            plan = (("jordan",) if staff == KIERAN else ()) + keys
            for index, client_key in enumerate(plan):
                cursor += timedelta(minutes=15 * (index % 3 == 2))
                key = (
                    "flashday_jordan"
                    if client_key == "jordan"
                    else f"flashday_{staff.removeprefix('st_iw_')}_{index}"
                )
                walked_in = cursor - timedelta(hours=1, minutes=20 + 10 * index)
                booking = self.fixed(
                    key,
                    client_key,
                    FLASH_DAY,
                    staff,
                    cursor,
                    "completed",
                    max(walked_in, self.at_local(day, 10, 30)),
                )
                booking.checked_in_at = cursor - timedelta(minutes=3)
                assert booking.completed_at is not None
                if index % 4 == 1:
                    sold += 1
                    products = ((BALM, 1),) if sold % 2 else ()
                    self.sale(
                        key,
                        client_key,
                        staff,
                        Quote(FLASH_DAY, products),
                        booking,
                        booking.created_at,
                        booking.completed_at + timedelta(minutes=4),
                    )
                else:
                    self.bill(booking, "cash" if index % 3 == 0 else "card")
                cursor += timedelta(minutes=45)
        jordan = self.ctx.get(Booking, "bk_iw_flashday_jordan")
        self.note(
            jordan.id,
            "booking",
            "First tattoo. Picked the swallow from Kieran's sheet, inner right forearm, about "
            "6 cm. Walked in at opening and waited for the first slot.",
            jordan.created_at,
        )

    def storyline(self) -> None:
        self.new_client()
        self.booked()
        self.no_show()
        self.aftercare()
        self.touch_up()
        self.feedback_sessions()
        self.gifts()

    def new_client(self) -> None:
        start = self.place(MEI, CONSULT, -3, None, past=True)
        assert start is not None
        created = start - timedelta(days=6)
        consult = self.book(
            "noor_consult", "noor", CONSULT, MEI, start, "completed", created, source="online"
        )
        submitted = created + timedelta(hours=5)
        response_id = "fr_iw_brief_noor"
        answers: dict[str, object] = {
            "idea": "A loose spray of wildflowers from the Okanagan, where I grew up: lupine, "
            "arrowleaf balsamroot and a few blades of grass. Fine line, delicate, with some "
            "stems a little longer than others so it doesn't look too tidy.",
            "placement": "Forearm",
            "placement_notes": "Inner left forearm, from the wrist toward the elbow.",
            "size": "10 to 20 cm",
            "colour": "Black linework only",
            "style": "Fine line",
            "artist": "Mei Chen",
            "cover_up": False,
            "skin_notes": "A small freckle near the wrist. No other tattoos on that arm.",
            "budget": 450,
            "availability": "Weekday afternoons, or any Saturday.",
        }
        for field, asset in (
            ("reference_1", "iw_brief_reference_1.jpg"),
            ("reference_2", "iw_brief_reference_2.jpg"),
        ):
            file_id = f"fl_iw_noor_{field}"
            self.ctx.add(
                File(
                    id=file_id,
                    business_id=INKWELL,
                    parent_type="form_response",
                    parent_id=response_id,
                    purpose="attachment",
                    s3_key=f"{INKWELL}/demo/{asset}",
                    content_type="image/jpeg",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=submitted - timedelta(minutes=6),
                    updated_at=submitted - timedelta(minutes=5),
                )
            )
            answers[field] = file_id
        self.response(
            "brief",
            "noor",
            BRIEF_FORM,
            consult,
            answers,
            submitted,
            created=created + timedelta(minutes=20),
        )
        assert consult.completed_at is not None
        self.note(
            "cl_iw_noor",
            "client",
            "Consult with Mei. Fine-line wildflowers on the inner left forearm, about 16 cm. "
            "Mei quoted one two-hour session and will draw it once Noor picks a date.",
            consult.completed_at + timedelta(minutes=20),
        )

    def booked(self) -> None:
        consult = self.sitting("tomas_consult", "tomas", CONSULT, KIERAN, -19, lead_days=4)
        assert consult is not None and consult.completed_at is not None
        self.response(
            "brief",
            "tomas",
            BRIEF_FORM,
            consult,
            {
                "idea": "A traditional rose and dagger, bold lines and full colour, for my "
                "first big piece.",
                "placement": "Forearm",
                "placement_notes": "Outer right forearm.",
                "size": "10 to 20 cm",
                "colour": "Colour",
                "style": "Traditional",
                "artist": "Kieran Walsh",
                "cover_up": False,
                "budget": 800,
                "availability": "Saturdays.",
            },
            consult.created_at + timedelta(hours=3),
        )
        booked = consult.completed_at + timedelta(hours=26)
        start = self.place(KIERAN, CUSTOM_4, 9, None, past=False, forward=True)
        assert start is not None
        tomas = self.book("tomas", "tomas", CUSTOM_4, KIERAN, start, "confirmed", booked)
        self.deposit(tomas, booked + timedelta(minutes=10))
        self.policies("tomas", booked + timedelta(minutes=8))
        self.response("consent", "tomas", CONSENT_FORM, tomas, {}, None, created=booked)
        self.note(
            tomas.id,
            "booking",
            "Rose and dagger, outer right forearm, full colour. Moved from the original date "
            "at Tomás's request with more than 72 hours' notice, so the deposit carried over.",
            booked + timedelta(days=2),
        )

    def no_show(self) -> None:
        missed = self.sitting(
            "brady", "brady", CUSTOM_2, SASHA, -16, lead_days=18, status="no_show"
        )
        assert missed is not None
        self.forfeit(missed)
        self.note(
            "cl_iw_brady",
            "client",
            "Missed his two-hour session without calling. The $100 deposit was kept under the "
            "policy. A new booking needs a new deposit.",
            missed.starts_at + timedelta(hours=3),
        )

    def aftercare(self) -> None:
        start = self.place(MEI, CUSTOM_2, -5, None, past=True)
        assert start is not None
        created = start - timedelta(days=24)
        booking = self.book("lucia", "lucia", CUSTOM_2, MEI, start, "completed", created)
        assert booking.completed_at is not None
        self.deposit(booking, created + timedelta(minutes=10))
        self.policies("lucia", created + timedelta(minutes=8))
        invoice = self.invoice(
            "lucia",
            "lucia",
            booking.completed_at + timedelta(minutes=3),
            created,
            "Fine-line peony on the left shoulder with Mei, and aftercare from the front desk.",
        )
        booking.invoice_id = invoice.id
        self.lines(
            "invoice",
            invoice.id,
            Quote(CUSTOM_2, ((BALM, 1), (WASH, 1), (FILM, 1))),
            created,
            booking=booking,
        )
        self.settle(invoice, "lucia", "card", tip=(MEI, 8000))

    def touch_up(self) -> None:
        done = self.sitting("hana", "hana", CUSTOM_2, MEI, -48, lead_days=16)
        assert done is not None and done.completed_at is not None
        self.note(
            done.id,
            "booking",
            "Fine-line peony and two buds on the right ankle. Hana's nickel-sensitive, so no "
            "jewellery near the spot.",
            done.created_at,
        )
        start = self.place(MEI, TOUCHUP, 5, None, past=False, forward=True)
        assert start is not None
        booked = self.now - timedelta(hours=26)
        touchup = self.book(
            "hana_touchup", "hana", TOUCHUP, MEI, start, "confirmed", booked, price=0
        )
        self.note(
            touchup.id,
            "booking",
            "Free touch-up within three months: two petals lost a little ink while healing.",
            booked,
        )

    def feedback_sessions(self) -> None:
        self.sitting("olu", "olu", CUSTOM_6, KIERAN, -10, lead_days=40)
        self.sitting("graham", "graham", CUSTOM_4, SASHA, -13, lead_days=112, settle="etransfer")
        refunded = self.sitting("cole_flash", "cole", FLASH, SASHA, -36, lead_days=6)
        assert refunded is not None and refunded.invoice_id is not None
        self.line(refunded.invoice_id, FILM, refunded.created_at, 1)
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == refunded.invoice_id)
        assert payment.paid_at is not None
        self.refund(
            payment,
            2730,
            payment.paid_at + timedelta(days=1, hours=2),
            "Returned an unopened healing film roll.",
        )

    def gifts(self) -> None:
        card = self.gift_card(
            "amelia", "amelia", GIFT, 25000, self.at(-140, 15, 10), recipient="Ronan Fitzgerald"
        )
        visit = self.visit(
            "ronan_gift",
            "ronan",
            FLASH,
            KIERAN,
            -62,
            price=0,
            settle=None,
            note=f"Paid with gift card {card.code} from Amelia Hughes.",
        )
        assert visit is not None and visit.completed_at is not None
        self.redeem(card, 18900, visit.completed_at + timedelta(minutes=4))
        self.gift_card("ivy", "ivy", GIFT, 10000, self.at(-26, 13, 40), recipient="Mira Novak")

    def sessions(self) -> None:
        """Each artist's custom work through the history and the weeks ahead."""
        turn = 0
        for week in range(-30, 5):
            month = self.local(self.at(week * 7)).month
            for staff, usual in SESSIONS_PER_WEEK.items():
                pool, mix = POOLS[staff], MIX[staff]
                count = round(usual * SEASON.get(month, 1.0))
                for index in range(count):
                    turn += 1
                    day = week * 7 + index * 6 // max(count, 1) + (1 if week >= 0 else 0)
                    if day == 0:
                        continue
                    self.sitting(
                        f"custom_{staff.removeprefix('st_iw_')}_{turn:04}",
                        pool[turn % len(pool)],
                        mix[turn % len(mix)],
                        staff,
                        day,
                        lead_days=14 + turn % 5 * 9,
                        settle=("card", "card", "etransfer", "card", "cash")[turn % 5],
                    )

    def piercings(self) -> None:
        clients = ("ruby", "simran", "xin", "chloe", "jessie", "yuna", "ana", "mira", "tess")
        for week in range(-30, 4):
            for index in range(2):
                day = week * 7 + 2 + index * 2
                if day == 0:
                    continue
                key = f"piercing_{week + 30:02}_{index}"
                self.visit(
                    key,
                    clients[(week + index) % len(clients)],
                    PIERCING,
                    MEI,
                    day,
                    settle="card" if index else "cash",
                )

    def paperwork(self) -> None:
        """Consent before each tattoo of the last ten weeks, and aftercare after the custom ones."""
        ctx = self.ctx
        cutoff = self.now - timedelta(days=70)
        signer: dict[str, int] = {}
        for booking in sorted(ctx.all(Booking), key=lambda b: b.starts_at):
            item_id = ctx.get(Slot, booking.slot_id).item_id
            if item_id not in TATTOOS and item_id != PIERCING:
                continue
            if booking.status == "canceled" or booking.starts_at < cutoff:
                continue
            key = booking.id.removeprefix("bk_iw_")
            client = ctx.get(Client, booking.client_id)
            client_key = self.key_of(booking)
            if any(r.id == f"fr_iw_consent_{key}" for r in ctx.all(FormResponse)):
                continue
            upcoming = booking.status in {"confirmed", "pending"}
            if upcoming:
                if booking.starts_at < self.now + timedelta(days=7):
                    self.response("consent", key, CONSENT_FORM, booking, {}, None)
                continue
            if booking.status != "completed":
                continue
            signer[client_key] = signer.get(client_key, 0) + 1
            submitted = booking.starts_at - timedelta(minutes=12)
            self.response(
                "consent",
                key,
                CONSENT_FORM,
                booking,
                self.consent_answers(client, booking),
                submitted,
                opened=submitted - timedelta(minutes=6),
                created=min(booking.created_at + timedelta(minutes=5), submitted),
                signature={"name": client.name, "strokes": None, "ip": "192.0.2.64"},
            )
            if item_id in CUSTOMS and booking.completed_at is not None:
                done = booking.completed_at - timedelta(minutes=6)
                self.response(
                    "aftercare",
                    key,
                    AFTERCARE_FORM,
                    booking,
                    {
                        "film": True,
                        "wash": True,
                        "balm": True,
                        "avoid": True,
                        "no_pick": True,
                        "infection": True,
                        "touchup": True,
                    },
                    done,
                    opened=done - timedelta(minutes=3),
                    created=done - timedelta(minutes=10),
                    signature={"name": client.name, "strokes": None, "ip": "192.0.2.64"},
                )

    def consent_answers(self, client: Client, booking: Booking) -> dict[str, object]:
        key = self.key_of(booking)
        conditions, medications, allergies, notes = CONDITIONS.get(key, ([], "None.", [], ""))
        born = date(1984 + len(key) * 3 % 18, 1 + len(client.name) % 12, 1 + len(key) * 5 % 27)
        answers: dict[str, object] = {
            "legal_name": client.name,
            "date_of_birth": born.isoformat(),
            "id_type": (
                "BC driver's licence",
                "BC Services Card with photo",
                "BC driver's licence",
                "Passport",
            )[len(key) % 4],
            "id_confirmed": True,
            "conditions": conditions,
            "medications": medications,
            "allergies": allergies,
            "pregnant": "No",
            "sober": True,
            "ate": True,
            "permanent": True,
            "design_approved": True,
            "release": True,
            "photos": ("Yes", "Yes, but don't tag me", "Yes", "No")[len(client.name) % 4],
        }
        if notes:
            answers["allergy_notes"] = notes
        return answers

    def feedback(self) -> None:
        ctx = self.ctx
        for key, booking_id, rating, wait, comments in (
            (
                "olu",
                "bk_iw_olu",
                5,
                "2 to 6 weeks",
                "Kieran talked me through every break and kept checking in, which helped a lot "
                "because I get light-headed around needles. The colour is so bright.",
            ),
            (
                "graham",
                "bk_iw_graham",
                4,
                "More than 6 weeks",
                "The piece is beautiful and Sasha was careful with the placement. I waited "
                "almost four months for a first opening, which was longer than I expected.",
            ),
            (
                "lucia",
                "bk_iw_lucia",
                5,
                "2 to 6 weeks",
                "Mei redrew the peony twice until the petals sat right on my shoulder. Thanks "
                "for the aftercare kit too.",
            ),
            (
                "anika",
                "bk_iw_anika_2",
                5,
                "Under 2 weeks",
                "Three sessions in and the sleeve is coming together. Sasha plans each day so "
                "well.",
            ),
            (
                "jordan",
                "bk_iw_flashday_jordan",
                5,
                "Under 2 weeks",
                "My first tattoo. The wait in the morning was short and Kieran explained "
                "everything.",
            ),
            (
                "ronan",
                "bk_iw_ronan_gift",
                5,
                "Under 2 weeks",
                "Used a gift card from my sister. Quick, clean and friendly.",
            ),
        ):
            booking = ctx.get(Booking, booking_id)
            if booking.completed_at is None:
                continue
            submitted = min(
                booking.completed_at + timedelta(hours=22), self.now - timedelta(hours=1)
            )
            self.response(
                "feedback",
                key,
                FEEDBACK_FORM,
                booking,
                {"rating": rating, "wait": wait, "comments": comments, "book_again": True},
                submitted,
                created=booking.completed_at + timedelta(hours=2),
            )
            self.review(booking_id.removeprefix("bk_iw_"))

    def engagement(self) -> None:
        self.consents()
        self.withdraw("liam", "email", self.at(-40, 9))
        flash = self.ctx.get(Booking, "bk_iw_flashday_jordan")
        day = self.local(flash.starts_at)
        self.broadcast(
            "flash_day",
            "Flash day on Saturday",
            f"Our next flash day is Saturday, {day:%B} {day.day}, from 11 to 7. Sasha, Mei and "
            "Kieran will each have a sheet of palm-sized designs for $120, tattooed in about 30 "
            "minutes. It's first come, first served at the front desk, so there's no booking. "
            "Bring photo ID, and eat before you come.",
            self.at_local(day.date() - timedelta(days=6), 10),
        )
        self.feedback()
        self.conversations()

    def conversations(self) -> None:
        ctx = self.ctx
        consult = ctx.get(Booking, "bk_iw_noor_consult")
        assert consult.completed_at is not None
        when = consult.completed_at + timedelta(hours=20)
        thread = self.thread("noor", "email", when)
        self.say(
            thread,
            "Hi, thanks for the consultation yesterday. How soon could Mei start? I'm free most "
            "Saturdays this month and next.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Noor. Mei has a two-hour opening on a Saturday about three weeks out. If "
            "you'd like it, we'll send the booking link for the $100 deposit, which comes off "
            "the price on the day. She'll draw the design from your references before then.",
            when + timedelta(minutes=35),
        )
        tomas = ctx.get(Booking, "bk_iw_tomas")
        first = tomas.created_at + timedelta(days=2)
        thread = self.thread("tomas", "sms", first)
        self.say(
            thread,
            "Hi, it's Tomás. Something came up for my session with Kieran. Is there anything a "
            "week or so later?",
            first,
            sender=None,
        )
        self.say(
            thread,
            "No problem, Tomás. You've given more than 72 hours' notice, so your deposit moves "
            f"with you. You're now booked for {_clock(self.local(tomas.starts_at))}.",
            first + timedelta(minutes=18),
        )
        self.say(thread, "Perfect, thank you.", first + timedelta(minutes=25), sender=None)
        brady = ctx.get(Booking, "bk_iw_brady")
        when = brady.starts_at + timedelta(minutes=30)
        thread = self.thread("brady", "sms", when)
        self.say(
            thread,
            f"Hi Brady, we had you booked with Sasha at {_clock(self.local(brady.starts_at))} "
            "today. Is everything all right? Under our policy the deposit is kept for a missed "
            "session, and we're happy to book you again.",
            when,
        )
        anika = ctx.get(Booking, "bk_iw_anika_2")
        if anika.completed_at is not None:
            when = anika.completed_at + timedelta(hours=18)
            thread = self.thread("anika", "sms", when)
            self.say(
                thread,
                "Thank you, Sasha. It's healing well and the film came off this morning. See you "
                "next month for the shoulder.",
                when,
                sender=None,
            )
            self.say(
                thread,
                "So glad it's healing well, Anika. Your next session is already booked, and the "
                "reminder will come two days before.",
                when + timedelta(minutes=20),
                sender=OWNER,
            )
        kenji = ctx.get(Booking, "bk_iw_kenji")
        when = min(kenji.starts_at - timedelta(hours=26), self.now - timedelta(hours=3))
        thread = self.thread("kenji", "sms", when)
        self.say(
            thread,
            f"Hi Kenji, a reminder of your four-hour session with "
            f"{self.staff_name(kenji.staff_id or KIERAN)} on "
            f"{_clock(self.local(kenji.starts_at))}. Please eat beforehand and bring photo ID.",
            when,
        )
        self.say(
            thread,
            "Thanks. Is it OK to bring headphones?",
            when + timedelta(minutes=40),
            sender=None,
        )
        self.say(thread, "Of course. See you then.", when + timedelta(minutes=48))
        hana = ctx.get(Booking, "bk_iw_hana_touchup")
        when = hana.created_at - timedelta(minutes=30)
        thread = self.thread("hana", "sms", when)
        self.say(
            thread,
            "Hi, two petals on my ankle look a bit patchy now that it's healed. Is the touch-up "
            "still free?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Hana, yes. It's within three months of your session, so there's no charge. Mei "
            f"can see you on {_clock(self.local(hana.starts_at))}.",
            when + timedelta(minutes=30),
        )
        graham = next((r for r in ctx.all(FormResponse) if r.id == "fr_iw_feedback_graham"), None)
        if graham is not None and graham.submitted_at is not None:
            when = graham.submitted_at + timedelta(hours=5)
            thread = self.thread("graham", "email", when)
            self.say(
                thread,
                "Thank you for the kind words about the piece, Graham, and for telling us about "
                "the wait. Sasha's calendar fills months ahead, which isn't easy when you're "
                "excited to start. We now open her bookings on the first of each month and "
                "call people on her cancellation list when a day opens up. I've added you to "
                "it for the next session. Sasha",
                when,
                sender=OWNER,
            )
            self.say(
                thread,
                "Thanks, Sasha. That works for me.",
                when + timedelta(hours=3),
                sender=None,
            )


EDITION = Inkwell
