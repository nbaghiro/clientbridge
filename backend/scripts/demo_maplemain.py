"""Maple and Main Hair Studio: a four-chair salon on the Danforth, built on the demo engine."""

from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.documents import VisitRecord
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

MAPLEMAIN = "bz_maplemain"
OWNER = "us_mm_owner"
INBOX = "us_mm_amara"

LEILA, MARCUS, TESSA, GABRIELA, DESK = (
    "st_mm_owner",
    "st_mm_marcus",
    "st_mm_tessa",
    "st_mm_gabriela",
    "st_mm_amara",
)
STYLISTS = (LEILA, MARCUS, TESSA, GABRIELA)
CUT_SENIOR, CUT, SHORT, BLOWOUT = (
    "it_mm_cut_senior",
    "it_mm_cut",
    "it_mm_short_cut",
    "it_mm_blowout",
)
ROOT, PARTIAL, FULL, BALAYAGE = (
    "it_mm_root_colour",
    "it_mm_partial_highlights",
    "it_mm_full_highlights",
    "it_mm_balayage",
)
CONSULT, TRIAL, BRIDAL, PARTY = (
    "it_mm_consultation",
    "it_mm_bridal_trial",
    "it_mm_bridal",
    "it_mm_wedding_party",
)
SHAMPOO, COLOUR_SHAMPOO, CONDITIONER, MASK = (
    "it_mm_shampoo_hydrating",
    "it_mm_shampoo_colour",
    "it_mm_conditioner",
    "it_mm_mask",
)
HEAT, TEXTURE, CREAM, HAIRSPRAY = (
    "it_mm_heat_protectant",
    "it_mm_texture_spray",
    "it_mm_styling_cream",
    "it_mm_hairspray",
)
BLOWOUTS, GIFT = "it_mm_blowout_pack", "it_mm_gift_card"
CONSULT_FORM, COLOUR_FORM, FEEDBACK_FORM, FORMULA_FORM = (
    "frm_mm_consultation",
    "frm_mm_colour_consent",
    "frm_mm_feedback",
    "frm_mm_formula",
)
POLICIES, BRIDAL_AGREEMENT = "con_mm_policies", "con_mm_bridal"
BUFFER_MIN = 15
# the policies' version 2 moved the cancellation window from 24 to 48 hours this many days ago
POLICIES_REVISED = 150


def _hours(days: dict[int, tuple[int, int]]) -> dict[int, tuple[time, time]]:
    return {day: (time(start), time(end)) for day, (start, end) in days.items()}


# weekday (Monday is 0) -> opening and closing hour; the studio is closed Sunday and Monday
HOURS = {
    LEILA: _hours({1: (10, 18), 2: (10, 18), 3: (11, 20), 4: (10, 18), 5: (9, 16)}),
    MARCUS: _hours({1: (10, 18), 3: (11, 20), 4: (11, 20), 5: (9, 17)}),
    TESSA: _hours({1: (12, 20), 2: (10, 18), 3: (12, 20), 4: (10, 18), 5: (9, 17)}),
    GABRIELA: _hours({1: (10, 18), 2: (10, 18), 3: (11, 20), 4: (10, 18), 5: (9, 17)}),
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
    staff: tuple[str, ...] = (),
) -> Offering:
    return Offering(
        id=item_id,
        kind="service",
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="standard",
        minutes=minutes,
        color=color,
        online_bookable=online,
        buffer_after_min=BUFFER_MIN,
        deposit_type="fixed" if deposit else "none",
        deposit_value=deposit,
        staff=staff,
    )


def _product(
    item_id: str,
    name: str,
    price: int,
    cost: int,
    sku: str,
    stock: Stock,
    description: str,
) -> Offering:
    return Offering(
        id=item_id,
        kind="product",
        name=name,
        price_cents=price,
        category="Retail",
        description=description,
        tax_class="standard",
        sell_online=True,
        sku=sku,
        cost_cents=cost,
        stock=stock,
    )


ITEMS = (
    _service(
        CUT_SENIOR,
        "Cut and style, senior stylist",
        9500,
        60,
        "Cuts",
        "#7B3F35",
        "A consultation, wash, cut and blow-dry with Leila or Marcus, who have each cut hair "
        "for over ten years. Includes a fringe trim between visits.",
        staff=(LEILA, MARCUS),
    ),
    _service(
        CUT,
        "Cut and style, stylist",
        7200,
        60,
        "Cuts",
        "#A0583F",
        "A consultation, wash, cut and blow-dry with Tessa. The same service as the senior "
        "cut, priced for a stylist in her first years behind the chair.",
        staff=(TESSA,),
    ),
    _service(
        SHORT,
        "Short cut",
        4800,
        30,
        "Cuts",
        "#5E6B73",
        "A clipper or scissor cut for short hair, with a wash and a quick finish. Most "
        "clients rebook every three to five weeks.",
    ),
    _service(
        BLOWOUT,
        "Blowout",
        5800,
        45,
        "Styling",
        "#C08A5B",
        "A wash and a round-brush blow-dry, smooth or with volume. Lasts about three days "
        "with a silk pillowcase and dry shampoo.",
    ),
    _service(
        ROOT,
        "Root colour",
        11500,
        90,
        "Colour",
        "#6B4C7A",
        "Colour on up to 3 cm of regrowth for grey coverage or to match your shade, with a "
        "wash and blow-dry. A patch test is needed 48 hours before a first colour.",
        staff=(LEILA, GABRIELA),
    ),
    _service(
        PARTIAL,
        "Partial highlights",
        16500,
        150,
        "Colour",
        "#8C5E9E",
        "Foils around the face and through the top section, toned and finished with a "
        "blow-dry. A $40 deposit is taken when you book and comes off your bill.",
        deposit=4000,
        staff=(LEILA, GABRIELA),
    ),
    _service(
        FULL,
        "Full highlights",
        21500,
        180,
        "Colour",
        "#7A4F8F",
        "Foils through the whole head, toned and finished with a blow-dry. Allow three hours. "
        "A $50 deposit is taken when you book and comes off your bill.",
        deposit=5000,
        staff=(GABRIELA,),
    ),
    _service(
        BALAYAGE,
        "Balayage",
        28500,
        210,
        "Colour",
        "#B07A3F",
        "Hand-painted lightening for a soft, grown-in look, with a toner, treatment and "
        "blow-dry. Allow three and a half hours. A $75 deposit is taken when you book.",
        deposit=7500,
        staff=(GABRIELA,),
    ),
    _service(
        CONSULT,
        "Colour consultation",
        0,
        30,
        "Colour",
        "#5F7F6E",
        "Thirty minutes with Gabriela to look at your hair, talk through the colour you want "
        "and do a patch test. Recommended before a first highlight or balayage.",
        staff=(GABRIELA,),
    ),
    _service(
        TRIAL,
        "Bridal trial",
        15000,
        90,
        "Bridal",
        "#B5677A",
        "A run-through of your wedding hair four to eight weeks before the day, so we can "
        "settle the style and timing. A $50 deposit is taken when you book.",
        deposit=5000,
        online=False,
    ),
    _service(
        BRIDAL,
        "Bridal styling",
        19500,
        90,
        "Bridal",
        "#9E4E64",
        "Your wedding morning style in the studio, with your veil or accessories set in place. "
        "A $100 deposit holds the date.",
        deposit=10000,
        online=False,
    ),
    _service(
        PARTY,
        "Wedding party styling",
        11000,
        60,
        "Bridal",
        "#C4889A",
        "An updo, half-up style or waves for each member of the wedding party, booked with "
        "the bride's wedding morning.",
        online=False,
    ),
    _product(
        SHAMPOO,
        "Hydrating shampoo, 300 ml",
        3200,
        1500,
        "MM-SH-HYD-300",
        Stock(18, 6),
        "A gentle shampoo for dry or thick hair. Sulphate free.",
    ),
    _product(
        COLOUR_SHAMPOO,
        "Colour-safe shampoo, 300 ml",
        3400,
        1600,
        "MM-SH-COL-300",
        Stock(14, 6),
        "A low-lather shampoo that helps colour and toner last between visits.",
    ),
    _product(
        CONDITIONER,
        "Hydrating conditioner, 300 ml",
        3400,
        1600,
        "MM-CO-HYD-300",
        Stock(16, 6),
        "A light daily conditioner that detangles without weighing hair down.",
    ),
    _product(
        MASK,
        "Repair mask, 200 ml",
        4200,
        1900,
        "MM-MK-REP-200",
        Stock(9, 4),
        "A weekly treatment for lightened or heat-styled hair. Leave on for five minutes.",
    ),
    _product(
        HEAT,
        "Heat protectant spray, 150 ml",
        3000,
        1300,
        "MM-SP-HEAT-150",
        Stock(12, 5),
        "Spray through damp hair before blow-drying or using a flat iron.",
    ),
    _product(
        TEXTURE,
        "Dry texture spray, 150 ml",
        3200,
        1400,
        "MM-SP-TEX-150",
        Stock(3, 5),
        "Adds grip and lift to waves and updos. Spray at the roots and through the lengths.",
    ),
    _product(
        CREAM,
        "Styling cream, 100 ml",
        2800,
        1200,
        "MM-CR-STY-100",
        Stock(11, 4),
        "A soft cream that smooths frizz and defines curls, for air-drying or a quick finish.",
    ),
    _product(
        HAIRSPRAY,
        "Flexible hairspray, 250 ml",
        2900,
        1250,
        "MM-SP-HOLD-250",
        Stock(10, 4),
        "A light hold that brushes out, for blowouts and wedding styles.",
    ),
    Offering(
        id=BLOWOUTS,
        kind="package",
        name="Three blowouts",
        price_cents=15000,
        category="Packages",
        description="Three blowouts for the price of two and a half, to use within six "
        "months. Book each one as a blowout and it comes off the package.",
        tax_class="standard",
        sessions=3,
        covers=BLOWOUT,
        validity_days=180,
        ref="blowouts",
    ),
    Offering(
        id=GIFT,
        kind="gift",
        name="Gift card",
        price_cents=0,
        category="Gift cards",
        description="A gift card for any amount, good for any service or product at the "
        "studio. It doesn't expire.",
        tax_class="exempt",
        ref="gift",
    ),
)

POLICIES_V1 = (
    "Colour services over two hours need a deposit when you book, which comes off your bill at "
    "the end of the visit. You can cancel or move any appointment up to 24 hours before it "
    "starts; after that, or if you miss it, the deposit is kept. If you're more than 15 "
    "minutes late we may need to shorten the service. Tell us within 7 days if you're not "
    "happy and we'll adjust the cut or colour at no charge."
)
POLICIES_BODY = "\n\n".join(
    (
        "These policies apply to every appointment at Maple and Main Hair Studio. It is demo "
        "text for a fictional business, not legal advice.",
        "Deposits\nPartial highlights, full highlights and balayage take a deposit when you "
        "book: $40, $50 and $75. The deposit comes off your bill at the end of the visit.",
        "Cancelling or moving an appointment\nYou can cancel or move an appointment online or "
        "by phone up to 48 hours before it starts. After that, a colour deposit is kept.",
        "Missed appointments\nIf you miss an appointment without letting us know, the deposit "
        "is kept. For services without a deposit, we'll ask for one the next time you book.",
        "Arriving late\nIf you're more than 15 minutes late, we may need to shorten the "
        "service or move it so the next client isn't kept waiting.",
        "Colour and patch tests\nWe patch test 48 hours before a first colour, and again if "
        "your health or the products you use have changed. The result of a colour service "
        "depends on your hair's history, so a big change can take more than one visit.",
        "If you're not happy\nTell us within 7 days and we'll adjust the cut or the colour at "
        "no charge. Products can be returned unopened within 14 days.",
        "Payment\nWe take debit, credit, cash and e-Transfer. Tips are welcome and go to your "
        "stylist.",
    )
)
BRIDAL_BODY = "\n\n".join(
    (
        "This agreement covers the hair styling Maple and Main Hair Studio provides for your "
        "wedding. It is demo text for a fictional business, not legal advice.",
        "Bridal trial\nThe trial is a 90-minute appointment, usually four to eight weeks "
        "before the wedding. Bring photos of styles you like and your veil or hair "
        "accessories, and wear a top with a neckline like your dress.",
        "Wedding morning\nWe style the bride and the wedding party in the studio, in the order "
        "and at the times on your confirmation. Each person should arrive with clean, dry hair, "
        "washed the night before.",
        "Deposit and payment\nA $100 deposit is due when the wedding morning is booked and "
        "comes off the final bill. The trial is paid on the day of the trial, and the rest on "
        "the wedding morning by card, cash or e-Transfer.",
        "Changes to the party\nYou can add or remove people up to 14 days before the wedding. "
        "After that, a styling time we've set aside is charged at the full rate.",
        "Cancelling\nIf you cancel more than 60 days before the wedding, the deposit is "
        "refunded. After that it's kept, because we turn down other bookings for that morning.",
        "Timing on the day\nWe plan 60 minutes for each member of the wedding party and 90 "
        "minutes for the bride. If someone arrives late, we may need to simplify their style "
        "to keep the bride on time.",
    )
)
CONSULT_FIELDS: tuple[DocField, ...] = (
    ("hair_goal", "longtext", "What would you like from this visit?", None, True, ()),
    (
        "hair_type",
        "select",
        "How would you describe your hair?",
        None,
        True,
        ("Straight", "Wavy", "Curly", "Coily"),
    ),
    ("density", "select", "How thick is your hair?", None, False, ("Fine", "Medium", "Thick")),
    (
        "length",
        "select",
        "Current length",
        None,
        True,
        ("Short", "Chin to shoulder", "Below the shoulder", "Mid-back or longer"),
    ),
    (
        "last_colour",
        "select",
        "When was your hair last coloured?",
        None,
        True,
        ("Never", "In the last 3 months", "3 to 12 months ago", "More than a year ago"),
    ),
    (
        "history",
        "multiselect",
        "What has been used on your hair?",
        "Include anything done at home. It changes how colour takes.",
        False,
        (
            "Salon colour",
            "Box dye",
            "Henna",
            "Bleach or lightener",
            "Keratin or smoothing treatment",
            "Perm or relaxer",
        ),
    ),
    (
        "allergies",
        "longtext",
        "Allergies or reactions to hair or skin products",
        "If you've had a reaction before, we'll patch test before any colour.",
        False,
        (),
    ),
    (
        "scalp",
        "select",
        "Is your scalp sensitive?",
        None,
        False,
        ("No", "A little", "Yes, it reacts easily"),
    ),
    (
        "maintenance",
        "select",
        "How often would you like to come in?",
        None,
        False,
        ("Every 4 to 6 weeks", "Every 2 to 3 months", "A few times a year"),
    ),
    (
        "styling_time",
        "select",
        "How long do you spend on your hair in the morning?",
        None,
        False,
        ("Under 5 minutes", "5 to 15 minutes", "More than 15 minutes"),
    ),
    (
        "current_photo",
        "image",
        "A photo of your hair now",
        "In daylight and from behind, if you can.",
        False,
        (),
    ),
    ("inspiration_photo", "image", "A photo of the look you'd like", None, False, ()),
    ("event_date", "date", "Are you getting ready for an event? When is it?", None, False, ()),
    (
        "referral",
        "select",
        "How did you hear about us?",
        None,
        False,
        ("Instagram", "Google", "A friend", "Walking by"),
    ),
)
COLOUR_FIELDS: tuple[DocField, ...] = (
    ("patch_test_date", "date", "Patch test date", None, True, ()),
    (
        "patch_result",
        "select",
        "Patch test result after 48 hours",
        "Leave the test spot unwashed and tell us about any itching, redness or swelling.",
        True,
        ("No reaction", "Mild redness that settled", "A reaction"),
    ),
    (
        "medications",
        "text",
        "Any new medication or scalp treatment since your last colour?",
        None,
        False,
        (),
    ),
    (
        "understand_result",
        "checkbox",
        "I understand the result depends on my hair's history and may take more than one visit",
        None,
        True,
        (),
    ),
    (
        "understand_lift",
        "checkbox",
        "I understand lightening can change how my hair feels, and that aftercare matters",
        None,
        True,
        (),
    ),
    (
        "aftercare",
        "checkbox",
        "I've been shown which shampoo and aftercare to use",
        None,
        False,
        (),
    ),
    ("notes", "longtext", "Anything else your colourist should know", None, False, ()),
)
FORMULA_FIELDS: tuple[DocField, ...] = (
    (
        "colour",
        "longtext",
        "Colour and developer",
        "Shades, mixing ratio and developer volume, by section.",
        True,
        (),
    ),
    ("timing", "text", "Processing time", None, True, ()),
    ("toner", "text", "Toner or gloss", None, False, ()),
    (
        "result",
        "select",
        "Result",
        None,
        False,
        ("As planned", "Warmer than planned", "Cooler than planned", "Needs a correction"),
    ),
    ("next_time", "longtext", "Next time", None, False, ()),
)
# formula notes Gabriela wrote after colour visits: note key, visit, minutes after, answers
FORMULA_NOTES: tuple[tuple[str, str, int, dict[str, object]], ...] = (
    *(
        (
            f"grace_{n}",
            f"grace_{n}",
            8 + n,
            {
                "colour": "Roots: 5N + 5G (1:1) with 20 volume.",
                "timing": "35 minutes",
                **({"toner": "Gloss 7N on the ends, 10 minutes"} if n % 2 else {}),
                "result": "As planned",
                "next_time": "Same formula. Grey is coming through a little more at the temples."
                if n == 4
                else "Same formula in six weeks.",
            },
        )
        for n in range(5)
    ),
    (
        "olivia_spring",
        "olivia_spring",
        12,
        {
            "colour": "Lightener with 20 volume, hand painted from mid-length. Soft root left "
            "natural.",
            "timing": "40 minutes",
            "toner": "9V + 9N (1:1), 15 minutes",
            "result": "As planned",
            "next_time": "Refresh in the fall with two brighter pieces around the face.",
        },
    ),
    (
        "amira",
        "amira",
        10,
        {
            "colour": "Lightener with 20 volume, hand painted, foils at the crown.",
            "timing": "45 minutes",
            "toner": "8A + 9V (1:1), 15 minutes",
            "result": "As planned",
        },
    ),
    (
        "natasha",
        "natasha_colour",
        6,
        {
            "colour": "Roots: 6N + 6G (2:1) with 20 volume.",
            "timing": "30 minutes",
            "result": "Warmer than planned",
            "next_time": "Drop the gold: 6N + 6A (1:1), and check the shade on the swatch with "
            "her first.",
        },
    ),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your visit?", None, True, ()),
    (
        "on_time",
        "select",
        "Did your appointment start on time?",
        None,
        False,
        ("Yes", "A few minutes late", "More than 15 minutes late"),
    ),
    ("comments", "longtext", "Anything you'd like to tell us?", None, False, ()),
    ("book_again", "checkbox", "I'd book with my stylist again", None, False, ()),
)

# key, name, days since they first came in (None: dated by their bookings)
CLIENTS: tuple[tuple[str, str, int | None], ...] = (
    ("farah", "Farah Ansari", None),
    ("grace", "Grace Liu", -940),
    ("olivia", "Olivia Lambert", -610),
    ("tamara", "Tamara Brown", -380),
    ("sofia", "Sofia Romano", None),
    ("elena", "Elena Papadakis", -1020),
    ("david", "David Okonkwo", -500),
    ("priyanka", "Priyanka Menon", None),
    ("amira", "Amira Yusuf", -720),
    ("robert", "Robert Kowalczyk", -860),
    ("chloe", "Chloé Bouchard", None),
    ("mariana", "Mariana Costa", -980),
    ("nkechi", "Nkechi Adeyemi", -650),
    ("hannah", "Hannah Goldberg", -540),
    ("thanh", "Thanh Nguyen", -470),
    ("rachel", "Rachel O'Brien", -830),
    ("zainab", "Zainab Hussain", -300),
    ("kavya", "Kavya Raman", -260),
    ("maria", "Maria Fernandes", -1000),
    ("yasmin", "Yasmin Farahani", -760),
    ("carmen", "Carmen Vargas", -420),
    ("aaliyah", "Aaliyah Grant", -330),
    ("natasha", "Natasha Volkova", -690),
    ("lauren", "Lauren Mitchell", -560),
    ("meera", "Meera Shah", -900),
    ("jessica", "Jessica Tran", -280),
    ("alicia", "Alicia Campbell", -610),
    ("fatima", "Fatima Abdi", -350),
    ("sarah", "Sarah Cohen", -870),
    ("nicole", "Nicole Fraser", -520),
    ("angela", "Angela Rossi", -1040),
    ("joanna", "Joanna Nowak", -440),
    ("christine", "Christine Dela Cruz", -600),
    ("mina", "Mina Kang", -310),
    ("leah", "Leah Silver", -730),
    ("dimitra", "Dimitra Georgiou", -1060),
    ("shanice", "Shanice Williams", -390),
    ("anjali", "Anjali Mehta", -270),
    ("erin", "Erin Kelly", -480),
    ("sunita", "Sunita Thapa", -360),
    ("bianca", "Bianca Moreira", -640),
    ("ayesha", "Ayesha Malik", -250),
    ("kim", "Kimberly Ho", -580),
    ("patricia", "Patricia Alvarez", -950),
    ("noor", "Noor Karimi", -230),
    ("julia", "Julia Lambert", -700),
    ("tenzin", "Tenzin Dolma", -340),
    ("samantha", "Samantha Clarke", -460),
    ("vanessa", "Vanessa Pereira", -810),
    ("hiba", "Hiba Mansour", -290),
    ("rosa", "Rosa Bianchi", -1080),
    ("adwoa", "Adwoa Mensah", -400),
    ("megan", "Megan Walsh", -240),
    ("lucia", "Lucía Herrera", -530),
    ("jiwoo", "Ji-woo Han", -320),
    ("claire", "Claire Fitzgerald", -670),
    ("folake", "Folake Adebayo", -410),
    ("irene", "Irene Wong", -990),
    ("katarina", "Katarina Petrović", -560),
    ("ashley", "Ashley Kim", -260),
    ("roya", "Roya Ahmadi", -750),
    ("gwen", "Gwen Taylor", -890),
    ("paula", "Paula Medeiros", -620),
    ("deepa", "Deepa Krishnan", -510),
    ("kevin", "Kevin Lam", -800),
    ("andre", "André Baptiste", -680),
    ("daniel", "Daniel Ferreira", -430),
    ("omar", "Omar Haidari", -370),
    ("ethan", "Ethan Clarke", -300),
    ("brandon", "Brandon Walsh", -450),
    ("marco", "Marco DeLuca", -920),
    ("madison", "Madison Hughes", None),
    ("lina", "Lina Zhao", None),
    ("sana", "Sana Qureshi", None),
    ("jamal", "Jamal Ibrahim", None),
)
SOURCES = ("a friend", "instagram", "google", "walk-in")
POOLS: dict[str, tuple[str, ...]] = {
    LEILA: (
        "elena",
        "mariana",
        "hannah",
        "yasmin",
        "sarah",
        "rachel",
        "dimitra",
        "angela",
        "leah",
        "rosa",
        "patricia",
        "julia",
        "irene",
        "katarina",
        "gwen",
        "roya",
        "deepa",
        "carmen",
        "christine",
    ),
    MARCUS: (
        "thanh",
        "lauren",
        "nicole",
        "alicia",
        "natasha",
        "mina",
        "joanna",
        "shanice",
        "kim",
        "samantha",
        "vanessa",
        "ashley",
        "paula",
        "jiwoo",
        "maria",
        "fatima",
        "bianca",
        "tenzin",
        "claire",
    ),
    TESSA: (
        "kavya",
        "aaliyah",
        "megan",
        "jessica",
        "zainab",
        "erin",
        "nkechi",
        "amira",
        "olivia",
        "noor",
        "hiba",
        "adwoa",
        "sunita",
        "anjali",
        "ayesha",
        "folake",
        "lucia",
        "meera",
        "tamara",
    ),
    GABRIELA: (
        "olivia",
        "amira",
        "mariana",
        "christine",
        "meera",
        "dimitra",
        "yasmin",
        "natasha",
        "thanh",
        "carmen",
        "julia",
        "rosa",
        "bianca",
        "vanessa",
        "paula",
        "roya",
        "katarina",
        "nkechi",
        "hiba",
        "samantha",
        "irene",
        "tamara",
    ),
}
# short-cut regulars: stylist, weeks between cuts
SHORT_CUTS: dict[str, tuple[str, int]] = {
    "david": (MARCUS, 4),
    "andre": (MARCUS, 3),
    "daniel": (MARCUS, 4),
    "robert": (MARCUS, 5),
    "ethan": (TESSA, 5),
    "omar": (TESSA, 4),
    "brandon": (TESSA, 6),
    "marco": (LEILA, 5),
    "jamal": (TESSA, 3),
}
# today's chair for each stylist, in order from opening; Gabriela's balayage is Olivia's
TODAY: dict[str, tuple[tuple[str, str], ...]] = {
    LEILA: (
        ("mariana", CUT_SENIOR),
        ("dimitra", ROOT),
        ("yasmin", CUT_SENIOR),
        ("hannah", BLOWOUT),
        ("sarah", CUT_SENIOR),
        ("rachel", BLOWOUT),
    ),
    MARCUS: (
        ("andre", SHORT),
        ("thanh", CUT_SENIOR),
        ("lauren", CUT_SENIOR),
        ("daniel", SHORT),
        ("nicole", CUT_SENIOR),
        ("alicia", BLOWOUT),
        ("ethan", SHORT),
    ),
    TESSA: (
        ("kavya", CUT),
        ("aaliyah", BLOWOUT),
        ("megan", CUT),
        ("jessica", BLOWOUT),
        ("zainab", CUT),
        ("erin", BLOWOUT),
        ("omar", SHORT),
    ),
    GABRIELA: (("meera", ROOT), ("christine", ROOT), ("katarina", CONSULT)),
}
# past checkouts with retail at the desk: client, stylist, service, products, days ago
CHECKOUTS: tuple[tuple[str, str, str, tuple[tuple[str, int], ...], int], ...] = (
    ("rosa", LEILA, CUT_SENIOR, ((MASK, 1),), -190),
    ("kim", MARCUS, CUT_SENIOR, ((HEAT, 1), (HAIRSPRAY, 1)), -171),
    ("aaliyah", TESSA, BLOWOUT, ((CREAM, 1),), -150),
    ("irene", LEILA, CUT_SENIOR, ((COLOUR_SHAMPOO, 1), (CONDITIONER, 1)), -128),
    ("samantha", MARCUS, BLOWOUT, ((TEXTURE, 1),), -104),
    ("folake", TESSA, CUT, ((SHAMPOO, 1), (CONDITIONER, 1)), -86),
    ("gwen", LEILA, BLOWOUT, ((HEAT, 1),), -61),
    ("paula", MARCUS, CUT_SENIOR, ((MASK, 1), (COLOUR_SHAMPOO, 1)), -40),
    ("megan", TESSA, CUT, ((TEXTURE, 1), (HAIRSPRAY, 1)), -23),
    ("hiba", TESSA, BLOWOUT, ((SHAMPOO, 1),), -13),
)
PHOTO_CLIENTS = (
    "grace",
    "olivia",
    "sofia",
    "elena",
    "david",
    "priyanka",
    "amira",
    "chloe",
    "farah",
    "mariana",
    "nkechi",
    "thanh",
    "kavya",
    "yasmin",
    "aaliyah",
    "meera",
    "christine",
    "dimitra",
    "kevin",
    "andre",
    "lucia",
    "irene",
    "marco",
    "deepa",
    "gwen",
)


def _clock(when: datetime) -> str:
    return f"{when:%A, %B} {when.day} at {when:%I:%M %p}".replace(" 0", " ")


SPEC = BusinessSpec(
    listing=demo_business(MAPLEMAIN),
    code="mm",
    slug="maplemain",
    login_domain="maplemain.example",
    owner=OWNER,
    people=(
        Person(
            OWNER,
            LEILA,
            "owner",
            "Leila Haddad",
            "+14165550190",
            "owner",
            "Owner and senior stylist",
            "#7B3F35",
            HOURS[LEILA],
        ),
        Person(
            "us_mm_marcus",
            MARCUS,
            "marcus",
            "Marcus Chen",
            "+14165550191",
            "staff",
            "Senior stylist",
            "#3F6B7B",
            HOURS[MARCUS],
            payee=True,
            rate_type="percent",
            rate_bps=4500,
            retail_rate_bps=1000,
        ),
        Person(
            "us_mm_tessa",
            TESSA,
            "tessa",
            "Tessa Novak",
            "+14165550192",
            "staff",
            "Stylist",
            "#C08A5B",
            HOURS[TESSA],
            payee=True,
            rate_type="percent",
            rate_bps=4000,
            retail_rate_bps=1000,
        ),
        Person(
            "us_mm_gabriela",
            GABRIELA,
            "gabriela",
            "Gabriela Santos",
            "+14165550193",
            "staff",
            "Colourist",
            "#6B4C7A",
            HOURS[GABRIELA],
            payee=True,
            rate_type="percent",
            rate_bps=4500,
            retail_rate_bps=1000,
        ),
        Person(
            INBOX,
            DESK,
            "amara",
            "Amara Okoye",
            "+14165550194",
            "admin",
            "Front desk coordinator",
            "#6B7280",
            bookable_online=False,
        ),
    ),
    items=ITEMS,
    brand={
        "tagline": "Cuts, colour and bridal hair on the Danforth, near Main subway station.",
        "about": (
            "Maple and Main is a four-chair studio in East Toronto. Leila Haddad opened it in "
            "2023 after twelve years at salons downtown. Leila and Marcus are senior stylists, "
            "Tessa is a stylist with a lower price for the same cut, and Gabriela does our "
            "colour, from root touch-ups to balayage. New colour clients start with a free "
            "consultation and a patch test. We're open Tuesday to Saturday, with evenings on "
            "Thursday and Friday."
        ),
        "address": "2087 Danforth Avenue, Toronto, ON M4C 1J9",
        "phone": "+1 416-555-0198",
        "email": "hello@maplemain.example",
        "neighbourhood": "Danforth East",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 4,
        "step_min": 15,
        "cancel_cutoff_hours": 48,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject=None,
    sms_number="+14165550199",
    gst_hst_number="804317265RT0001",
    forms=(
        FormSpec(CONSULT_FORM, "New client consultation", "ff_mm_consult_", CONSULT_FIELDS),
        FormSpec(
            COLOUR_FORM,
            "Colour consent and patch test",
            "ff_mm_colour_",
            COLOUR_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK_FORM, "Visit feedback", "ff_mm_feedback_", FEEDBACK_FIELDS),
        FormSpec(FORMULA_FORM, "Colour formula", "ff_mm_formula_", FORMULA_FIELDS),
    ),
    contracts=(
        ContractSpec(
            POLICIES,
            "Salon policies",
            POLICIES_BODY,
            version=2,
            earlier_body=POLICIES_V1,
            revised_day=-POLICIES_REVISED,
        ),
        ContractSpec(BRIDAL_AGREEMENT, "Bridal services agreement", BRIDAL_BODY),
    ),
    storyline=(
        Stage(
            "First-time client with the consultation form submitted",
            "farah",
            ("bk_mm_farah_consult", "fr_mm_consult_farah"),
        ),
        Stage("Regular rebooked every six weeks with a series", "grace", ("sch_mm_grace",)),
        Stage("Today's book, with a balayage in progress", "olivia", ("bk_mm_olivia",)),
        Stage("No-show with a forfeited deposit", "tamara", ("bk_mm_tamara",)),
        Stage(
            "Bridal party booked after the trial",
            "sofia",
            ("bk_mm_sofia_trial", "bk_mm_sofia_bride", "sig_mm_sofia_bridal"),
        ),
        Stage("Retail sold at checkout with a cut", "elena", ("bk_mm_elena", "ord_mm_elena")),
        Stage("Gift card bought", "david", ("gc_mm_david",)),
        Stage("Gift card redeemed", "priyanka", ("bk_mm_priyanka_gift",)),
        Stage("Three-blowout package, two used", "chloe", ("pkg_mm_blowouts_chloe",)),
        Stage("Five-star feedback", "amira", ("fr_mm_feedback_amira",)),
        Stage("Four-star feedback about the wait", "robert", ("fr_mm_feedback_robert",)),
        Stage(
            "Colour formula noted on each visit",
            "grace",
            ("vr_mm_formula_grace_4", "vr_mm_formula_natasha"),
        ),
        Stage("Visit invoice overdue", "roya", ("inv_mm_roya_highlights",)),
    ),
    pacing=Pacing(
        {LEILA: 8, MARCUS: 7, TESSA: 8, GABRIELA: 6},
        (CUT_SENIOR,),
        staff_services={
            LEILA: (CUT_SENIOR, BLOWOUT, CUT_SENIOR, ROOT, CUT_SENIOR, BLOWOUT, PARTIAL),
            MARCUS: (CUT_SENIOR, BLOWOUT, CUT_SENIOR, CUT_SENIOR, BLOWOUT),
            TESSA: (CUT, BLOWOUT, CUT, BLOWOUT, CUT),
            GABRIELA: (ROOT, FULL, ROOT, BALAYAGE, ROOT, PARTIAL),
        },
        weeks=30,
        ahead_weeks=5,
        seasonality={
            3: 0.95,
            4: 1.0,
            5: 1.1,
            6: 1.15,
            7: 0.9,
            8: 0.8,
            9: 1.0,
            10: 1.0,
            11: 1.05,
            12: 1.2,
        },
        settlements=("card", "card", "card", "cash", "card", "card", "etransfer", "card"),
        cancel_every=29,
    ),
    photo_clients=PHOTO_CLIENTS,
    inbox_user=INBOX,
    founded_day=-1100,
    catalog_day=-1080,
    documents_day=-1070,
    restock_days=(-240, -190, -140, -95, -50, -15),
    invoice_start=4100,
    seed=31,
)


class MapleMain(Demo):
    spec = SPEC

    def story(self) -> None:
        self.clients()
        self.series_regulars()
        self.away()
        self.today()
        self.storyline()
        self.short_cuts()
        self.checkouts()
        self.fill((), by_staff=POOLS)
        self.paperwork()
        self.formula_notes()
        self.photos()
        self.engagement()

    def staff_name(self, staff: str) -> str:
        return next(p.name for p in self.spec.people if p.staff_id == staff).split()[0]

    def visit_note(self, item: Item, booking: Booking) -> str:
        return f"{item.name} with {self.staff_name(booking.staff_id or LEILA)}."

    def tip(self, booking: Booking) -> tuple[str, int] | None:
        if booking.staff_id is None or self.rng.random() < 0.2:
            return None
        share = self.rng.choice((0.15, 0.18, 0.2, 0.2))
        return booking.staff_id, max(500, round(booking.price_cents * share / 100) * 100)

    def bill(
        self, booking: Booking, settle: Settle, *, tip: tuple[str, int] | None = None
    ) -> Invoice | None:
        """Visits are paid at the desk as the client leaves, and most card payments carry a tip."""
        if booking.completed_at is None or not booking.price_cents or booking.package_id:
            return None
        if tip is None and settle == "card":
            tip = self.tip(booking)
        key = booking.id.removeprefix("bk_mm_")
        client_key = booking.client_id.removeprefix("cl_mm_")
        item = self.items[self.ctx.get(Slot, booking.slot_id).item_id]
        issued = booking.completed_at + timedelta(minutes=2)
        invoice = self.invoice(key, client_key, issued, booking.created_at, "")
        invoice.notes = self.visit_note(item, booking)
        booking.invoice_id = invoice.id
        self.line(invoice.id, item.id, booking.created_at, booking=booking)
        self.settle(invoice, client_key, settle, tip=tip)
        return invoice

    def settle(
        self,
        invoice: Invoice,
        client_key: str,
        settle: Settle,
        *,
        tip: tuple[str, int] | None = None,
    ) -> Payment | None:
        if settle in {"open", "overdue"}:
            return super().settle(invoice, client_key, settle, tip=tip)
        issued = invoice.issued_at or self.now
        transfer = (issued + timedelta(hours=5)).replace(minute=12)
        if settle == "etransfer" and transfer < self.now:
            method: Settle = "etransfer"
            paid = transfer
        elif settle == "cash":
            method, paid = "cash", issued + timedelta(minutes=2)
        else:
            method, paid = "card", issued + timedelta(minutes=3)
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
        for index, (key, name, since) in enumerate(CLIENTS):
            self.client(
                key,
                name,
                f"+1416555{100 + index:04}",
                fields={"source": SOURCES[index % len(SOURCES)]},
                since=None if since is None else self.at(since, 11),
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
        source: str = "manual",
    ) -> Booking:
        """A booking at an exact time, which must fit the member's hours and calendar."""
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        if not self.within_hours(staff, start, end):
            raise ValueError(f"{key}: outside {staff}'s hours")
        if not self.free(staff, None, start, end, 0, item.buffer_after_min):
            raise ValueError(f"{key}: overlaps another visit of {staff}'s")
        return self.book(
            key,
            client_key,
            item_id,
            staff,
            start,
            status,
            created,
            source="online" if source == "online" else "manual",
        )

    def series_regulars(self) -> None:
        self.series(
            "grace", "grace", ROOT, GABRIELA, weekday=3, at=time(11), every=6, visits=8, before=5
        )
        self.series(
            "kevin",
            "kevin",
            SHORT,
            MARCUS,
            weekday=4,
            at=time(17, 30),
            every=3,
            visits=12,
            before=9,
        )

    def away(self) -> None:
        today = self.local(self.now).date()
        summer = today - timedelta(days=95 + today.weekday())
        self.time_off(
            "tessa_summer",
            TESSA,
            self.at_local(summer, 0),
            self.at_local(summer + timedelta(days=6), 23),
            "Vacation",
        )
        thursday = today + timedelta(days=(3 - today.weekday()) % 7 + 14)
        self.time_off(
            "marcus_course",
            MARCUS,
            self.at_local(thursday, 9),
            self.at_local(thursday, 20),
            "Colour correction course",
        )

    def book_day(self) -> tuple[date, datetime, bool]:
        """Today when Olivia's balayage can be under way now, else the next day all four work."""
        local = self.local(self.now)
        anchor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        anchor -= timedelta(minutes=75)
        length = timedelta(minutes=self.items[BALAYAGE].duration_min or 210)
        if self.within_hours(GABRIELA, anchor, anchor + length) and all(
            self.hours_on(staff, local.date()) for staff in STYLISTS
        ):
            return local.date(), anchor.astimezone(UTC), True
        day = local.date()
        while True:
            day += timedelta(days=1)
            if all(self.hours_on(staff, day) for staff in STYLISTS):
                window = self.hours_on(GABRIELA, day)
                assert window is not None
                start = self.at_local(day, window[0].hour) + timedelta(minutes=105)
                while not self.free(GABRIELA, None, start, start + length, 0, BUFFER_MIN):
                    start += timedelta(minutes=15)
                return day, start, False

    def today(self) -> None:
        day, anchor, live = self.book_day()
        olivia = self.fixed(
            "olivia",
            "olivia",
            BALAYAGE,
            GABRIELA,
            anchor,
            "confirmed",
            min(anchor - timedelta(days=26), self.now - timedelta(days=1)),
        )
        self.deposit(olivia, olivia.created_at + timedelta(minutes=10))
        if live:
            olivia.checked_in_at = olivia.starts_at - timedelta(minutes=4)
            before = olivia.starts_at + timedelta(minutes=6)
            self.ctx.add(
                File(
                    id="fl_mm_olivia_before",
                    business_id=MAPLEMAIN,
                    parent_type="booking",
                    parent_id=olivia.id,
                    purpose="photo",
                    s3_key=f"{MAPLEMAIN}/demo/mm_photo_before.jpg",
                    content_type="image/jpeg",
                    size=(ASSETS / "mm_photo_before.jpg").stat().st_size,
                    created_at=before,
                    updated_at=before,
                )
            )
        self.note(
            olivia.id,
            "booking",
            "Refresh of last spring's balayage. Keep the root soft and add two brighter pieces "
            "around the face. Toner 9V + 9N, 15 minutes.",
            olivia.created_at,
        )
        step = timedelta(minutes=15)
        for staff, plan in TODAY.items():
            window = self.hours_on(staff, day)
            assert window is not None
            cursor = self.at_local(day, window[0].hour, window[0].minute)
            for index, (client_key, item_id) in enumerate(plan):
                length = timedelta(minutes=self.items[item_id].duration_min or 60)
                while self.within_hours(staff, cursor, cursor + length) and not self.free(
                    staff, None, cursor, cursor + length, 0, BUFFER_MIN
                ):
                    cursor += step
                if not self.within_hours(staff, cursor, cursor + length):
                    break
                key = f"today_{staff.removeprefix('st_mm_')}_{index}"
                self.chair(key, client_key, item_id, staff, cursor, index)
                cursor += length + step

    def chair(
        self, key: str, client_key: str, item_id: str, staff: str, start: datetime, index: int
    ) -> None:
        end = start + timedelta(minutes=self.items[item_id].duration_min or 60)
        created = min(start - timedelta(days=4 + index * 3), self.now - timedelta(hours=6))
        status: BookingStatus = "completed" if end <= self.now else "confirmed"
        booking = self.fixed(key, client_key, item_id, staff, start, status, created)
        if start <= self.now:
            booking.checked_in_at = start - timedelta(minutes=3)
        if end <= self.now - timedelta(minutes=10):
            self.bill(booking, "cash" if index == 2 else "card")

    def storyline(self) -> None:
        self.first_timer()
        self.no_show()
        self.bridal()
        self.retail()
        self.gift()
        self.blowouts()
        self.spring_balayage()
        self.feedback_visits()
        self.unpaid()

    def first_timer(self) -> None:
        start = self.place(GABRIELA, CONSULT, 2, None, past=False)
        assert start is not None
        created = self.now - timedelta(hours=20)
        booking = self.book(
            "farah_consult", "farah", CONSULT, GABRIELA, start, "pending", created, source="online"
        )
        submitted = created + timedelta(hours=2, minutes=10)
        response_id = "fr_mm_consult_farah"
        answers: dict[str, object] = {
            "hair_goal": "I'd like to go from my dark brown to a soft caramel balayage that "
            "grows out without a hard line. I'm hoping it can be done before my cousin's "
            "wedding in December.",
            "hair_type": "Wavy",
            "density": "Thick",
            "length": "Below the shoulder",
            "last_colour": "More than a year ago",
            "history": ["Box dye"],
            "allergies": "None that I know of.",
            "scalp": "No",
            "maintenance": "Every 2 to 3 months",
            "styling_time": "5 to 15 minutes",
            "event_date": (self.local(self.now) + timedelta(days=58)).date().isoformat(),
            "referral": "Instagram",
        }
        for field, asset in (
            ("current_photo", "mm_consult_current.jpg"),
            ("inspiration_photo", "mm_consult_inspiration.jpg"),
        ):
            file_id = f"fl_mm_farah_{field}"
            self.ctx.add(
                File(
                    id=file_id,
                    business_id=MAPLEMAIN,
                    parent_type="form_response",
                    parent_id=response_id,
                    purpose="attachment",
                    s3_key=f"{MAPLEMAIN}/demo/{asset}",
                    content_type="image/jpeg",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=submitted - timedelta(minutes=6),
                    updated_at=submitted - timedelta(minutes=5),
                )
            )
            answers[field] = file_id
        self.response(
            "consult", "farah", CONSULT_FORM, booking, answers, submitted, created=created
        )
        self.response("colour", "farah", COLOUR_FORM, booking, {}, None, created=submitted)
        self.sign("farah_policies", "farah", POLICIES, created + timedelta(minutes=8), None)
        self.note(
            "cl_mm_farah",
            "client",
            "First visit. Dark brown, about level 3, with box dye a year ago on the lengths. "
            "Wants a soft caramel balayage, likely in two sessions. Patch test at the "
            "consultation.",
            submitted + timedelta(hours=1),
        )

    def no_show(self) -> None:
        missed = self.visit("tamara", "tamara", FULL, GABRIELA, -12, status="no_show", settle=None)
        assert missed is not None
        self.deposit(missed, missed.created_at + timedelta(minutes=10))
        self.forfeit(missed)
        self.note(
            "cl_mm_tamara",
            "client",
            "Missed her full highlights without calling; the $50 deposit was kept under the "
            "policy. Rebooked with a new deposit.",
            missed.starts_at + timedelta(hours=3),
        )
        start = self.place(GABRIELA, FULL, 9, None, past=False)
        assert start is not None
        rebooked = missed.starts_at + timedelta(hours=26)
        rebook = self.book("tamara_rebook", "tamara", FULL, GABRIELA, start, "confirmed", rebooked)
        self.deposit(rebook, rebooked + timedelta(minutes=10))
        self.visit("brandon_missed", "brandon", SHORT, TESSA, -30, status="no_show", settle=None)

    def wedding_day(self) -> date:
        today = self.local(self.now).date()
        return today + timedelta(days=(5 - today.weekday()) % 7 + 14)

    def bridal(self) -> None:
        start = self.place(LEILA, TRIAL, -24, None, past=True)
        assert start is not None
        trial = self.book(
            "sofia_trial", "sofia", TRIAL, LEILA, start, "completed", start - timedelta(days=12)
        )
        assert trial.completed_at is not None
        self.deposit(trial, trial.created_at + timedelta(minutes=10))
        self.bill(trial, "card")
        self.sign(
            "sofia_bridal",
            "sofia",
            BRIDAL_AGREEMENT,
            trial.created_at + timedelta(minutes=30),
            None,
        )
        self.sign(
            "sofia_policies", "sofia", POLICIES, trial.created_at + timedelta(minutes=35), None
        )
        self.note(
            trial.id,
            "booking",
            "Low textured bun with soft pieces at the front, pearl pins on the left. Cathedral "
            "veil goes under the bun. Took 80 minutes; she'd like a little more volume at the "
            "crown on the day.",
            trial.completed_at,
        )
        day = self.wedding_day()
        booked = trial.completed_at + timedelta(hours=1)
        party = (
            (
                "party_0",
                MARCUS,
                9,
                0,
                "Giulia Romano, maid of honour and Sofia's sister: soft "
                "curls, half up, with the pearl pins Sofia is bringing.",
            ),
            (
                "party_1",
                TESSA,
                9,
                0,
                "Teresa Romano, mother of the bride: a smooth low chignon, "
                "nothing too tight at the nape.",
            ),
            (
                "party_2",
                GABRIELA,
                9,
                0,
                "Nadia Fiore, bridesmaid: loose waves, all down, with texture spray.",
            ),
            (
                "party_3",
                MARCUS,
                10,
                15,
                "Alessia Conti, bridesmaid: a braided crown to match Giulia's pins.",
            ),
        )
        for key, staff, hour, minute, note in party:
            booking = self.fixed(
                f"sofia_{key}",
                "sofia",
                PARTY,
                staff,
                self.at_local(day, hour, minute),
                "confirmed",
                booked,
            )
            self.note(booking.id, "booking", note, booked)
        bride = self.fixed(
            "sofia_bride", "sofia", BRIDAL, LEILA, self.at_local(day, 10), "confirmed", booked
        )
        self.deposit(bride, booked + timedelta(minutes=15))
        self.note(
            bride.id,
            "booking",
            "The style from the trial with more volume at the crown. Photographer arrives at "
            "11:30, so Sofia needs to be finished by 11:20.",
            booked,
        )

    def retail(self) -> None:
        start = self.place(LEILA, CUT_SENIOR, -6, None, past=True)
        assert start is not None
        booking = self.book(
            "elena", "elena", CUT_SENIOR, LEILA, start, "completed", start - timedelta(days=9)
        )
        assert booking.completed_at is not None
        self.sale(
            "elena",
            "elena",
            LEILA,
            Quote(CUT_SENIOR, ((COLOUR_SHAMPOO, 1), (CONDITIONER, 1))),
            booking,
            booking.created_at,
            booking.completed_at + timedelta(minutes=6),
            tip=(LEILA, 1500),
        )

    def checkouts(self) -> None:
        for client_key, staff, service, products, day in CHECKOUTS:
            booking = self.visit(
                f"{client_key}_checkout", client_key, service, staff, day, settle=None
            )
            if booking is None or booking.completed_at is None:
                continue
            self.sale(
                f"{client_key}_checkout",
                client_key,
                staff,
                Quote(service, products),
                booking,
                booking.created_at,
                booking.completed_at + timedelta(minutes=5),
                tip=self.tip(booking),
            )

    def gift(self) -> None:
        bought = self.at(-45, 14, 20)
        card = self.gift_card("david", "david", GIFT, 15000, bought, recipient="Priyanka Menon")
        visit = self.visit(
            "priyanka_gift",
            "priyanka",
            CUT_SENIOR,
            MARCUS,
            -20,
            price=0,
            settle=None,
            note=f"Paid with gift card {card.code} from David Okonkwo.",
        )
        assert visit is not None and visit.completed_at is not None
        self.redeem(card, 10735, visit.completed_at + timedelta(minutes=4))
        self.visit("priyanka_next", "priyanka", BLOWOUT, MARCUS, 12)

    def blowouts(self) -> None:
        self.joined("chloe", self.at(-62, 11))
        package = self.package("chloe", BLOWOUTS, self.at(-62, 12))
        for index, day in enumerate((-55, -27, 4)):
            self.visit(
                f"chloe_blowout_{index}", "chloe", BLOWOUT, TESSA, day, package_id=package.id
            )

    def spring_balayage(self) -> None:
        spring = self.visit("olivia_spring", "olivia", BALAYAGE, GABRIELA, -165, settle=None)
        assert spring is not None and spring.completed_at is not None
        self.deposit(spring, spring.created_at + timedelta(minutes=10))
        self.bill(spring, "card")
        after = spring.completed_at - timedelta(minutes=4)
        self.ctx.add(
            File(
                id="fl_mm_olivia_spring_after",
                business_id=MAPLEMAIN,
                parent_type="booking",
                parent_id=spring.id,
                purpose="photo",
                s3_key=f"{MAPLEMAIN}/demo/mm_photo_after.jpg",
                content_type="image/jpeg",
                size=(ASSETS / "mm_photo_after.jpg").stat().st_size,
                created_at=after,
                updated_at=after,
            )
        )

    def feedback_visits(self) -> None:
        amira = self.visit("amira", "amira", BALAYAGE, GABRIELA, -4, settle=None)
        assert amira is not None
        self.deposit(amira, amira.created_at + timedelta(minutes=10))
        self.bill(amira, "card")
        self.visit("robert", "robert", SHORT, MARCUS, -9)
        refunded = self.visit("natasha_colour", "natasha", ROOT, GABRIELA, -33)
        assert refunded is not None and refunded.invoice_id is not None
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == refunded.invoice_id)
        assert payment.paid_at is not None
        self.refund(
            payment,
            2500,
            payment.paid_at + timedelta(days=2),
            "Goodwill refund: the colour came out warmer than agreed.",
        )
        self.visit("noor", "noor", CUT, TESSA, 3)
        self.visit("madison_first", "madison", CUT, TESSA, -15)
        self.visit("lina_first", "lina", BLOWOUT, MARCUS, -8)
        self.visit("sana_first", "sana", CONSULT, GABRIELA, -18)
        self.visit("sana_partial", "sana", PARTIAL, GABRIELA, 6, settle=None)

    def unpaid(self) -> None:
        """Full highlights the card reader couldn't take, invoiced and still unpaid."""
        visit = self.visit("roya_highlights", "roya", FULL, GABRIELA, -27, settle=None)
        assert visit is not None
        self.deposit(visit, visit.created_at + timedelta(minutes=10))
        invoice = self.bill(visit, "overdue")
        assert invoice is not None
        invoice.notes = (
            "Full highlights with Gabriela. The card reader was offline at checkout, so the "
            "balance after your deposit."
        )

    def formula_notes(self) -> None:
        """Colour formulas the stylist wrote after each visit, as visit records off devices."""
        people = {person.staff_id: person for person in SPEC.people}
        for key, visit, minutes, answers in FORMULA_NOTES:
            booking = self.ctx.get(Booking, f"bk_mm_{visit}")
            assert booking.completed_at is not None and booking.staff_id is not None
            person = people[booking.staff_id]
            written = booking.completed_at + timedelta(minutes=minutes)
            self.ctx.add(
                VisitRecord(
                    id=f"vr_mm_formula_{key}",
                    business_id=self.spec.id,
                    form_id=FORMULA_FORM,
                    client_id=booking.client_id,
                    booking_id=booking.id,
                    answers=answers,
                    signature={
                        "user_id": person.user_id,
                        "staff_id": person.staff_id,
                        "name": person.name,
                        "signed_at": written.isoformat(),
                        "amends": None,
                    },
                    created_at=written,
                    updated_at=written,
                )
            )

    def short_cuts(self) -> None:
        for key, (staff, weeks) in SHORT_CUTS.items():
            first = -200 + len(key) * 3 if key != "jamal" else -20
            day, index = first, 0
            while day < 0:
                if not (key == "robert" and -14 < day < -4):
                    self.visit(f"{key}_{index}", key, SHORT, staff, day)
                day += weeks * 7
                index += 1
            self.visit(f"{key}_next", key, SHORT, staff, day if day < 30 else 2)

    def paperwork(self) -> None:
        ctx = self.ctx
        grace = ctx.get(Booking, "bk_mm_grace_0")
        for key, booking in (
            ("grace", grace),
            ("olivia", ctx.get(Booking, "bk_mm_olivia")),
            ("amira", ctx.get(Booking, "bk_mm_amira")),
            ("sana", ctx.get(Booking, "bk_mm_sana_first")),
        ):
            client = ctx.get(Client, booking.client_id)
            submitted = min(booking.created_at + timedelta(hours=3), self.now - timedelta(hours=8))
            patch = self.local(booking.starts_at - timedelta(days=3)).date()
            self.response(
                "colour",
                key,
                COLOUR_FORM,
                booking,
                {
                    "patch_test_date": patch.isoformat(),
                    "patch_result": "No reaction",
                    "understand_result": True,
                    "understand_lift": True,
                    "aftercare": True,
                },
                submitted,
                signature={"name": client.name, "strokes": None, "ip": "192.0.2.41"},
            )
        signers = sorted(
            {*POOLS[LEILA], *POOLS[MARCUS], *POOLS[TESSA][::2], "grace", "david", "kevin"}
        )
        for key in signers:
            client = ctx.get(Client, self.client_id(key))
            signed = min(
                max(client.created_at or self.now, self.at(self.spec.documents_day + 1, 9))
                + timedelta(hours=1),
                self.now - timedelta(hours=2),
            )
            self.sign(f"{key}_policies", key, POLICIES, signed, None)
        self.sign(
            "lucia_bridal", "lucia", BRIDAL_AGREEMENT, self.at(-2, 16), None, status="pending"
        )
        for key, body in (
            (
                "grace",
                "Formula: 5N + 5G (1:1) with 20 volume, 35 minutes on the roots. Covers grey "
                "well. Gloss 7N on the ends every other visit.",
            ),
            (
                "olivia",
                "Balayage: lightener with 20 volume, hand painted, 40 minutes. Toner 9V + 9N "
                "(1:1), 15 minutes. Prefers a soft root.",
            ),
            (
                "amira",
                "Prefers the private room at the back. Balayage toned with 8A + 9V, 15 minutes.",
            ),
            (
                "mariana",
                "Fine hair. Likes the back short with length at the front. Uses the repair "
                "mask weekly.",
            ),
            (
                "dimitra",
                "Root colour 6N with 20 volume, 30 minutes. Sensitive scalp: barrier cream at "
                "the hairline.",
            ),
        ):
            client = ctx.get(Client, self.client_id(key))
            self.note(
                client.id, "client", body, (client.created_at or self.now) + timedelta(days=1)
            )

    def engagement(self) -> None:
        self.consents()
        self.withdraw("julia", self.at(-50, 9))
        self.broadcast(
            "holidays",
            "Holiday colour bookings",
            "Our November and December calendar is open. Colour appointments before the "
            "holidays fill early, so if you'd like highlights or balayage before then, book "
            "online or reply to this message and we'll find a time. Gift cards are available at "
            "the front desk in any amount. We're closed December 25 to 27.",
            self.at(-21, 10),
        )
        self.feedback()
        self.conversations()
        for key in (
            "amira",
            "robert",
            "grace_4",
            "elena",
            "sofia_trial",
            "priyanka_gift",
            "chloe_blowout_1",
            "madison_first",
        ):
            self.review(key)

    def feedback(self) -> None:
        ctx = self.ctx
        for key, booking_id, rating, on_time, comments in (
            (
                "amira",
                "bk_mm_amira",
                5,
                "Yes",
                "Gabriela explained the toner before she started, and the colour came out "
                "just like the photo I brought. The back room was quiet and comfortable.",
            ),
            (
                "robert",
                "bk_mm_robert",
                4,
                "More than 15 minutes late",
                "The cut was great, as usual. My appointment started about 20 minutes late, "
                "and nobody mentioned it until I asked at the desk.",
            ),
            (
                "grace",
                "bk_mm_grace_4",
                5,
                "Yes",
                "Grey coverage is perfect again. Thank you, Gabriela.",
            ),
            (
                "elena",
                "bk_mm_elena",
                5,
                "Yes",
                "Leila always listens. Thanks for the shampoo tip too.",
            ),
            (
                "sofia",
                "bk_mm_sofia_trial",
                5,
                "Yes",
                "The trial took away all my worry about the day. Leila tried two versions and "
                "took photos of both.",
            ),
            (
                "priyanka",
                "bk_mm_priyanka_gift",
                5,
                "A few minutes late",
                "Lovely first visit. Marcus took his time with the layers.",
            ),
        ):
            booking = ctx.get(Booking, booking_id)
            if booking.completed_at is None:
                continue
            submitted = min(
                booking.completed_at + timedelta(hours=20), self.now - timedelta(hours=1)
            )
            self.response(
                "feedback",
                key,
                FEEDBACK_FORM,
                booking,
                {"rating": rating, "on_time": on_time, "comments": comments, "book_again": True},
                submitted,
                created=booking.completed_at + timedelta(hours=2),
            )

    def conversations(self) -> None:
        ctx = self.ctx
        farah = ctx.get(Booking, "bk_mm_farah_consult")
        when = farah.created_at + timedelta(hours=3)
        thread = self.thread("farah", when)
        self.say(
            thread,
            "Hi, I booked a consultation online and filled in the form. Is one visit usually "
            "enough to go from dark brown to caramel? And do I need a patch test first?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Farah. Gabriela will look at your hair at the consultation and tell you "
            "whether it's one session or two. From dark brown with box dye, it's often two. "
            "She'll do the patch test at the same visit, so you can book the colour from 48 "
            "hours later.",
            when + timedelta(minutes=40),
        )
        grace = ctx.get(Booking, "bk_mm_grace_4")
        if grace.completed_at is not None:
            when = grace.completed_at + timedelta(hours=4)
            thread = self.thread("grace", when)
            self.say(
                thread,
                "Thank you, Gabriela, the colour is perfect again. See you in six weeks.",
                when,
                sender=None,
            )
            self.say(
                thread,
                "Thanks, Grace. You're booked for the same time in six weeks, and you'll get a "
                "reminder two days before.",
                when + timedelta(minutes=12),
            )
        tamara = ctx.get(Booking, "bk_mm_tamara")
        when = tamara.starts_at + timedelta(minutes=25)
        thread = self.thread("tamara", when)
        self.say(
            thread,
            "Hi Tamara, we had you booked with Gabriela at "
            f"{self.local(tamara.starts_at):%I:%M %p}".replace(" 0", " ")
            + " today for full highlights. Is everything all right?",
            when,
        )
        self.say(
            thread,
            "I'm so sorry, I completely forgot. Can I rebook?",
            when + timedelta(hours=2),
            sender=None,
        )
        rebook = ctx.get(Booking, "bk_mm_tamara_rebook")
        self.say(
            thread,
            "Of course. Under our policy the $50 deposit for today is kept, and a new deposit "
            f"holds the next one. You're booked for {_clock(self.local(rebook.starts_at))}.",
            rebook.created_at,
        )
        bride = ctx.get(Booking, "bk_mm_sofia_bride")
        when = bride.created_at - timedelta(minutes=30)
        thread = self.thread("sofia", when)
        self.say(
            thread,
            "Thank you for the trial! Could we book the wedding morning for me and four "
            "others: my sister Giulia, my mom Teresa, and two bridesmaids, Nadia and Alessia?",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"Congratulations, Sofia. You're all booked for {_clock(self.local(bride.starts_at))} "
            "with Leila, with Giulia, Teresa and Nadia at 9:00 and Alessia at 10:15. The $100 "
            "deposit holds the morning and comes off the final bill.",
            bride.created_at + timedelta(minutes=20),
            sender=OWNER,
        )
        gift = self.thread("david", self.at(-46, 18))
        self.say(
            gift,
            "Hi, can I buy a $150 gift card for my partner's birthday? She'd like a cut with "
            "Marcus.",
            self.at(-46, 18),
            sender=None,
        )
        self.say(
            gift,
            "Of course. You can pay at the front desk or over the phone, and we'll email you "
            "the gift card to pass on. It's good for any service or product.",
            self.at(-46, 18, 25),
        )
        robert = ctx.get(Booking, "bk_mm_robert")
        if robert.completed_at is not None:
            when = robert.completed_at + timedelta(days=1, hours=2)
            thread = self.thread("robert", when)
            self.say(
                thread,
                "Hi Robert, it's Leila. Thank you for the feedback, and I'm sorry about the "
                "wait. Marcus's appointment before yours ran long, and we should have told you "
                "when you arrived. The front desk now texts the next client when a stylist is "
                "running more than ten minutes behind.",
                when,
                sender=OWNER,
            )
            self.say(
                thread,
                "Thanks, Leila. That would help. See you next month.",
                when + timedelta(hours=3),
                sender=None,
            )
        noor = ctx.get(Booking, "bk_mm_noor")
        when = noor.created_at - timedelta(minutes=20)
        thread = self.thread("noor", when)
        self.say(
            thread,
            "Hi, could I move my cut with Tessa to later in the week? My original day doesn't "
            "work anymore.",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"No problem, Noor. You're now booked with Tessa on "
            f"{_clock(self.local(noor.starts_at))}.",
            noor.created_at,
        )


EDITION = MapleMain
