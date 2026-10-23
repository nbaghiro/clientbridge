"""Foothills Lawn and Garden: a four-person lawn and landscaping crew in Calgary."""

import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import Item, ItemKind
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, File
from clientbridge.models.scheduling import Booking, BookingStatus, Recurrence, Slot, Weekday
from clientbridge.schemas.subjects import PropertyAttributes
from clientbridge.services.bookings import expand_occurrences
from scripts.demo_context import demo_business
from scripts.demo_engine import ASSETS, WEEKDAYS, Demo, Quote
from scripts.demo_photos import add_photos
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

FOOTHILLS = "bz_foothills"
FOOTHILLS_OWNER = "us_fh_owner"

BOSS, MEGAN, TYLER, JONAH = "st_fh_owner", "st_fh_megan", "st_fh_tyler", "st_fh_jonah"
CONSULT, WEEKLY, BIWEEKLY, SPRING, FALL = (
    "it_fh_consult",
    "it_fh_mow_weekly",
    "it_fh_mow_biweekly",
    "it_fh_spring_cleanup",
    "it_fh_fall_cleanup",
)
HEDGE, BEDS, PROJECT, GROUNDS = "it_fh_hedge", "it_fh_beds", "it_fh_project", "it_fh_grounds"
SNOW, SNOW_PLAN, SNOW_PACK = "it_fh_snow_visit", "it_fh_snow_plan", "it_fh_snow_pack"
MULCH, SOIL, PERENNIAL, SHRUB, SOD, BLOCK = (
    "it_fh_mulch",
    "it_fh_soil",
    "it_fh_perennial",
    "it_fh_shrub",
    "it_fh_sod",
    "it_fh_wall_block",
)
PROPERTY_FORM, SIGN_OFF_FORM, FEEDBACK_FORM = (
    "frm_fh_property",
    "frm_fh_sign_off",
    "frm_fh_feedback",
)
LAWN_AGREEMENT, PROJECT_AGREEMENT, SNOW_AGREEMENT = (
    "con_fh_lawn",
    "con_fh_project",
    "con_fh_snow",
)

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        CONSULT,
        "service",
        "Project consultation",
        0,
        45,
        "Projects",
        "Ravi walks the yard with you, measures the area and talks through plants, soil and "
        "budget. The written estimate follows within three days. There's no charge.",
    ),
    (
        WEEKLY,
        "service",
        "Weekly mowing",
        5200,
        45,
        "Lawn care",
        "Mowing, string trimming along fences and beds, edging the walks and blowing the "
        "clippings off hard surfaces, once a week from May to the end of October. Priced for a "
        "city lot up to 6,000 sq ft.",
    ),
    (
        BIWEEKLY,
        "service",
        "Every-two-weeks mowing",
        6200,
        45,
        "Lawn care",
        "The same visit as weekly mowing, every second week. The grass is longer between cuts, "
        "so it takes a little more time and we bag the clippings when it's wet.",
    ),
    (
        SPRING,
        "service",
        "Spring cleanup",
        29500,
        180,
        "Cleanups",
        "Power raking to lift the dead thatch, raking out beds and under shrubs, picking up "
        "winter debris and the first cut of the year. Yard waste is hauled away.",
    ),
    (
        FALL,
        "service",
        "Fall cleanup with aeration",
        34500,
        180,
        "Cleanups",
        "Core aeration, leaves raked and mulched or hauled away, perennials cut back, beds "
        "tidied and the last cut of the year. Booked from late September until the ground "
        "freezes.",
    ),
    (
        HEDGE,
        "service",
        "Hedge trimming",
        18500,
        120,
        "Trees and shrubs",
        "Shaping and trimming of hedges and shrubs up to about 30 m in total, with the "
        "clippings cleaned up and hauled away. Taller hedges are quoted.",
    ),
    (
        BEDS,
        "service",
        "Garden bed maintenance",
        12000,
        90,
        "Gardens",
        "Weeding, edging, deadheading and a light top-up of mulch where it has thinned. Mulch "
        "and plants are billed separately.",
    ),
    (
        PROJECT,
        "service",
        "Landscape project day",
        148000,
        480,
        "Projects",
        "A full day of landscaping by our crew: new garden beds, sod, small retaining walls "
        "and planting. Materials are quoted separately on your estimate, and a 30% deposit on "
        "the labour holds the date.",
    ),
    (
        GROUNDS,
        "service",
        "Condo and commercial grounds visit",
        24000,
        120,
        "Lawn care",
        "Weekly mowing, trimming and litter pickup for shared grounds. Priced for common "
        "areas up to about 20,000 sq ft; larger sites are quoted.",
    ),
    (
        SNOW,
        "service",
        "Snow clearing, single visit",
        6500,
        45,
        "Snow",
        "Driveway, front walk and the city sidewalk cleared after a snowfall, with ice melt "
        "on the steps. Booked as needed.",
    ),
    (
        SNOW_PLAN,
        "subscription",
        "Winter snow plan",
        64900,
        None,
        "Snow",
        "Your driveway, front walk and city sidewalk cleared after every snowfall of 5 cm or "
        "more, from November 1 to April 30, within 24 hours of the snow stopping. Billed once "
        "for the season.",
    ),
    (
        SNOW_PACK,
        "package",
        "Five snow clearings",
        29900,
        None,
        "Snow",
        "Five single snow clearing visits, prepaid, for winters when you'd rather call us "
        "than shovel. Use them any time within a year.",
    ),
    (
        MULCH,
        "product",
        "Shredded cedar mulch, per cubic yard",
        7200,
        None,
        "Materials",
        "Natural, undyed shredded cedar. One cubic yard covers about 100 sq ft at a 3-inch "
        "depth. Delivered and spread with a bed or project visit.",
    ),
    (
        SOIL,
        "product",
        "Garden soil mix, per cubic yard",
        6800,
        None,
        "Materials",
        "A screened blend of topsoil, compost and peat for new beds and topdressing. One "
        "cubic yard fills about 50 sq ft of bed at a 6-inch depth.",
    ),
    (
        PERENNIAL,
        "product",
        "Perennial, 1 gallon pot",
        1699,
        None,
        "Plants",
        "Hardy perennials that winter well in Calgary, such as daylilies, hostas, yarrow and "
        "catmint. We pick them with you at the consultation.",
    ),
    (
        SHRUB,
        "product",
        "Shrub, #2 pot",
        4499,
        None,
        "Plants",
        "Zone 3 shrubs such as dogwood, potentilla, spirea and lilac, planted with soil mix "
        "and watered in.",
    ),
    (
        SOD,
        "product",
        "Kentucky bluegrass sod, per roll",
        650,
        None,
        "Materials",
        "Fresh-cut sod, about 9 sq ft per roll, laid on a prepared and levelled base. Ordered "
        "for each job, so it isn't kept in stock.",
    ),
    (
        BLOCK,
        "product",
        "Retaining wall block",
        950,
        None,
        "Materials",
        "Grey concrete wall block, about 12 by 6 by 4 inches, for walls up to 3 feet high. "
        "Higher walls need an engineered design.",
    ),
)
COLORS = {
    CONSULT: "#7A8B5C",
    WEEKLY: "#2F5D3A",
    BIWEEKLY: "#4F7D4A",
    SPRING: "#8FA858",
    FALL: "#B5762E",
    HEDGE: "#3E6B5A",
    BEDS: "#9C5B6E",
    PROJECT: "#6B4E3D",
    GROUNDS: "#3D5C6E",
    SNOW: "#5E7FA3",
    SNOW_PLAN: "#40618A",
    SNOW_PACK: "#7891B0",
}
# on hand today, low-stock line, unit cost, SKU; sod is ordered per job
STOCK: dict[str, tuple[int, int, int, str]] = {
    MULCH: (14, 6, 3400, "FH-MUL-CED"),
    SOIL: (9, 5, 3100, "FH-SOIL-MIX"),
    PERENNIAL: (42, 15, 750, "FH-PER-1G"),
    SHRUB: (11, 4, 2200, "FH-SHR-2"),
    BLOCK: (96, 40, 410, "FH-WALL-BLK"),
}
MATERIALS = (MULCH, SOIL, PERENNIAL, SHRUB, SOD, BLOCK)
TRAVEL_MIN = 30
MOW_TRAVEL_MIN = 15
WEEKDAYS_8 = {d: (time(7, 30), time(17, 0)) for d in range(5)}
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {**{d: (time(8, 0), time(17, 0)) for d in range(5)}, 5: (time(9, 0), time(13, 0))},
    MEGAN: WEEKDAYS_8,
    TYLER: WEEKDAYS_8,
    JONAH: WEEKDAYS_8,
}
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cash", "etransfer")
# the season runs from the first week of May to the end of October
SEASON_OPENS, SEASON_CLOSES = (5, 4), (10, 31)
# the crew's layoff over the winter, and the date they come back
CREW_BACK, CREW_OFF = (5, 1), (11, 1)
# snowfalls of 5 cm or more last winter, as month and day
SNOWFALLS = ((2, 4), (2, 12), (2, 25), (3, 9), (3, 19), (3, 31), (4, 14))

LAWN_V1 = (
    "Foothills Lawn and Garden will mow your lawn on the schedule you choose, from the first "
    "week of May to the end of October. Each visit is billed to your card on file after it's "
    "done. If it rains, we move the visit to the next dry day and text you. Please keep gates "
    "unlocked and dogs inside on your mowing day, and flag sprinkler heads near the lawn edge. "
    "You can pause or cancel any time with a week's notice."
)
LAWN_BODY = "\n\n".join(
    (
        "This agreement covers seasonal lawn care by Foothills Lawn and Garden at the property "
        "named on your client record. It is demo text for a fictional business, not legal "
        "advice.",
        "The season\nMowing runs from the first week of May to the end of October, weekly or "
        "every two weeks as you choose. Your series is set up on one weekday, and the last "
        "visit of the season is the final cut before the fall cleanup.",
        "Each visit\nWe mow, trim along fences and beds, edge the walks and blow clippings off "
        "the driveway and walks. Clippings are mulched into the lawn unless you ask us to bag "
        "them.",
        "Weather\nWe don't mow wet grass or during thunderstorms, because it tears the lawn and "
        "leaves ruts. If rain stops a visit, we move it to the next dry day and text you the "
        "new time. In a dry spell we may raise the mower height and skip a week if the lawn "
        "has stopped growing; a skipped visit isn't charged.",
        "Gates, dogs and access\nPlease leave the gate unlocked or give us the code, and keep "
        "dogs inside on your mowing day. We close and latch every gate we open. If we can't get "
        "into the yard, we mow the front and let you know.",
        "Sprinklers and property\nPlease flag sprinkler heads, low lighting and anything else "
        "near the lawn edge. We repair damage we cause to marked items. We aren't responsible "
        "for unmarked heads, cables or objects hidden in the grass.",
        "Billing\nEach visit is billed after it's done, to the card on file or by e-Transfer. "
        "Invoices are due within 14 days.",
        "Pausing or cancelling\nYou can pause or cancel your series at any time with a week's "
        "notice. There's no charge for visits that haven't happened.",
    )
)
PROJECT_BODY = "\n\n".join(
    (
        "This agreement covers the landscaping project described on your accepted estimate. "
        "It is demo text for a fictional business, not legal advice.",
        "Scope of work\nWe supply the labour and materials listed on the accepted estimate. "
        "Work that isn't on it, such as removing a tree stump, moving a sprinkler line or "
        "hauling extra fill, is quoted and agreed with you before we do it.",
        "Utility locates\nBefore we dig, we request free locates for buried gas, power and "
        "communication lines through Utility Safety Partners. We start once every line is "
        "marked, which usually takes three to five business days. Private lines, such as a "
        "line to a garage or a sprinkler system, aren't covered by the locate, so please show "
        "us where they run.",
        "Deposit and payment\nA deposit of 30% of the labour holds your date and is applied to "
        "the final invoice. The balance is due within 14 days of completion by card or "
        "e-Transfer.",
        "Weather and schedule\nWe don't lay sod or move soil in heavy rain. If the weather "
        "delays the project, we'll agree a new date with you, and the deposit carries over.",
        "Plant and sod warranty\nTrees, shrubs and perennials we plant are covered for one "
        "growing season, as long as they're watered as we show you at the sign-off. Sod is "
        "covered for 30 days. The warranty doesn't cover damage from drought, hail, pets or "
        "deer.",
        "Cancellation\nYou can move or cancel the project at no charge up to 7 days before it "
        "starts. After that, the deposit covers materials we've ordered and the time we set "
        "aside.",
    )
)
SNOW_BODY = "\n\n".join(
    (
        "This agreement covers the winter snow plan at the property named on your client "
        "record. It is demo text for a fictional business, not legal advice.",
        "What's included\nFrom November 1 to April 30 we clear the driveway, the front walk "
        "and the city sidewalk in front of your property after every snowfall of 5 cm or more, "
        "and put ice melt on the front steps. Snowfalls under 5 cm aren't included unless you "
        "ask, and are charged as a single visit.",
        "Timing\nWe start clearing when the snow stops and aim to finish every plan property "
        "within 24 hours, which matches the City of Calgary's time limit for clearing public "
        "sidewalks. During a long storm we may come twice.",
        "Your part\nPlease move vehicles off the driveway when you can, and mark the edges of "
        "the driveway and any garden beds next to it before the first snow. We can't clear "
        "around vehicles left on the driveway.",
        "Damage\nSnow clearing can scuff lawn edges along the driveway. We touch these up with "
        "the spring cleanup at no charge. We aren't responsible for unmarked objects under "
        "the snow.",
        "Price and renewal\nThe plan is billed once for the season, in October, to your card on "
        "file. It renews each October unless you cancel before September 30, and we'll email "
        "you a month before it renews.",
        "Cancelling\nYou can cancel before the season starts for a full refund. After November "
        "1, the plan isn't refunded.",
    )
)
PROPERTY_FIELDS: tuple[DocField, ...] = (
    ("address", "address", "Property address", None, True, ()),
    (
        "lot_size",
        "select",
        "Lot size",
        "A rough guess is fine. A typical city lot is about 5,000 sq ft.",
        True,
        ("Under 4,000 sq ft", "4,000 to 6,000 sq ft", "6,000 to 9,000 sq ft", "Over 9,000 sq ft"),
    ),
    (
        "gate",
        "text",
        "Gate code, or how we get into the back yard",
        "We use access details only on the day of a visit.",
        False,
        (),
    ),
    (
        "dogs",
        "select",
        "Dogs",
        None,
        True,
        (
            "No dogs",
            "Dogs, kept inside on service days",
            "Dogs in the yard, please call before you open the gate",
        ),
    ),
    ("dog_notes", "text", "Their names and anything we should know", None, False, ()),
    (
        "irrigation",
        "select",
        "Sprinklers",
        None,
        True,
        ("No sprinklers", "In-ground sprinklers", "Hose and sprinklers only"),
    ),
    (
        "irrigation_notes",
        "longtext",
        "Where are the sprinkler heads and the controller?",
        "Please flag any heads near the lawn edge so the mower and edger stay clear of them.",
        False,
        (),
    ),
    (
        "clippings",
        "select",
        "Grass clippings",
        None,
        False,
        ("Mulch them into the lawn", "Bag them and take them away"),
    ),
    (
        "services",
        "multiselect",
        "What can we help with?",
        None,
        True,
        (
            "Weekly mowing",
            "Every-two-weeks mowing",
            "Spring cleanup",
            "Fall cleanup",
            "Hedge trimming",
            "Garden beds",
            "Snow clearing",
            "A landscaping project",
        ),
    ),
    (
        "preferred_day",
        "select",
        "Preferred day for mowing",
        None,
        False,
        ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "No preference"),
    ),
    (
        "photo",
        "image",
        "A photo of the yard",
        "The front or back yard, whichever needs us.",
        False,
        (),
    ),
    ("notes", "longtext", "Anything else we should know?", None, False, ()),
)
SIGN_OFF_FIELDS: tuple[DocField, ...] = (
    ("completed_on", "date", "Date completed", None, True, ()),
    ("work_done", "longtext", "Work completed", None, True, ()),
    ("plants_installed", "number", "Plants and shrubs installed", None, False, ()),
    ("locate_ticket", "text", "Utility locate ticket number", None, False, ()),
    (
        "watering_explained",
        "checkbox",
        "We went over how to water the new plants and sod",
        "New beds need a deep watering two or three times a week for the first month.",
        True,
        (),
    ),
    ("site_clean", "checkbox", "The site is cleaned up and the debris removed", None, True, ()),
    ("rating", "rating", "How did the project go?", None, False, ()),
    ("follow_up", "longtext", "Anything we need to come back for", None, False, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was the visit?", None, True, ()),
    (
        "highlights",
        "multiselect",
        "What went well?",
        None,
        False,
        (
            "On time",
            "Clean edges",
            "Tidy cleanup",
            "Gates and yard left as we found them",
            "Communication",
        ),
    ),
    ("comments", "longtext", "Anything we could do better?", None, False, ()),
    ("follow_up", "checkbox", "You can contact me about this", None, False, ()),
)


@dataclass(frozen=True)
class Yard:
    key: str
    name: str
    address: str
    lot_sqft: int
    gate: str | None = None
    dogs: str | None = None
    irrigation: str | None = None
    since_days: int | None = None


NAMED = (
    Yard(
        "helen",
        "Helen Bergstrom",
        "3412 Varsity Drive NW, Calgary, AB T3B 3J7",
        5600,
        "Side gate on the left, no lock.",
        None,
        "In-ground, four zones. The controller is in the garage and set to Tuesday and "
        "Friday mornings.",
        since_days=900,
    ),
    Yard(
        "rosa",
        "Rosa Villanueva",
        "127 Ranchlands Boulevard NW, Calgary, AB T3G 1N2",
        4800,
        "Back gate code 1904.",
        None,
        None,
        since_days=560,
    ),
    Yard(
        "jun",
        "Jun Choi",
        "5807 Dalhousie Drive NW, Calgary, AB T3A 1B4",
        6100,
        "Gate on the right side of the garage, latch sticks a little.",
        "Mochi, a shiba inu, stays inside on Tuesdays.",
        "In-ground, three zones. Heads along the front walk are flagged.",
        since_days=420,
    ),
    Yard(
        "carol",
        "Carol Jensen",
        "4415 Brentwood Boulevard NW, Calgary, AB T2L 1K8",
        5900,
        "Side gate with a spring latch. Please make sure it clicks shut.",
        "Buddy, a beagle, is in the back yard most days and will slip out of an open gate.",
        None,
        since_days=780,
    ),
    Yard(
        "harjit",
        "Harjit Dhillon",
        "212 Hawkwood Boulevard NW, Calgary, AB T3G 2S5",
        7200,
        "Gate code 5521.",
        None,
        "In-ground, six zones. The controller is on the back wall of the house.",
        since_days=640,
    ),
    Yard(
        "tom",
        "Tom Fitzgerald",
        "2219 Charleswood Drive NW, Calgary, AB T2L 1Y4",
        6400,
        "Both gates open; the back one swings shut on its own.",
        None,
        None,
        since_days=1300,
    ),
    Yard(
        "kwame",
        "Kwame Asante",
        "6115 Silver Springs Road NW, Calgary, AB T3B 2X1",
        6800,
        "Gate code 3370.",
        "Two dogs, Kofi and Ama, kept in the house on mowing day.",
        "Hose and sprinklers only.",
        since_days=300,
    ),
    Yard(
        "amir",
        "Amir Haddad",
        "5311 Edgemont Boulevard NW, Calgary, AB T3A 2N4",
        8200,
        "Back gate padlock code 0711.",
        None,
        "In-ground, five zones, blown out by us each October.",
        since_days=480,
    ),
    Yard(
        "lucy",
        "Lucy Tremblay",
        "1608 22 Avenue NW, Calgary, AB T2M 1R1",
        4200,
        "Back lane gate, no lock.",
        None,
        None,
        since_days=8,
    ),
    Yard(
        "mariana",
        "Mariana Pereira",
        "2931 Cambrian Drive NW, Calgary, AB T2K 1R4",
        5400,
        "Side gate, no lock.",
        "Lua, a border collie, comes in when we arrive.",
        "In-ground, three zones. The line to the back bed was capped for the new garden.",
        since_days=360,
    ),
    Yard(
        "graham",
        "Graham Ellison",
        "3816 Collingwood Drive NW, Calgary, AB T2L 0R5",
        7400,
        "Gate code 2286.",
        None,
        "In-ground, four zones.",
        since_days=700,
    ),
    Yard(
        "farah",
        "Farah Qureshi",
        "36 Scenic Acres Drive NW, Calgary, AB T3L 1W4",
        5000,
        "Gate opens from the back lane.",
        None,
        "Hose and sprinklers only.",
        since_days=6,
    ),
    Yard(
        "doug",
        "Doug Pearson",
        "4027 Bowness Road NW, Calgary, AB T3B 0B3",
        6600,
        "Side gate, no lock.",
        None,
        None,
        since_days=29,
    ),
    Yard(
        "svetlana",
        "Svetlana Ivanova",
        "3104 Parkdale Boulevard NW, Calgary, AB T2N 3T1",
        4600,
        "Back gate from the lane, code 8812.",
        None,
        None,
        since_days=500,
    ),
    Yard(
        "bernadette",
        "Bernadette Kwan",
        "4523 Varsity Drive NW, Calgary, AB T3A 0Z5",
        8800,
        "Both side gates unlocked.",
        None,
        "In-ground, five zones. We blow out the lines with the fall cleanup.",
        since_days=820,
    ),
    Yard(
        "ewan",
        "Ewan MacDonald",
        "1123 5 Avenue NW, Calgary, AB T2N 0S1",
        3900,
        "Back gate from the lane.",
        None,
        None,
        since_days=260,
    ),
    Yard(
        "yusuf",
        "Yusuf Aydin",
        "6208 Dalhousie Drive NW, Calgary, AB T3A 1C1",
        5200,
        "Gate code 4108.",
        None,
        None,
        since_days=330,
    ),
    Yard(
        "chloe",
        "Chloe Martin",
        "2715 Capitol Hill Crescent NW, Calgary, AB T2M 4B9",
        4400,
        "Side gate, no lock.",
        "Pip, a small terrier, stays inside.",
        None,
        since_days=200,
    ),
    Yard(
        "linda",
        "Linda Chow",
        "5520 Brisebois Drive NW, Calgary, AB T2L 2G6",
        6000,
        "Side gate, no lock.",
        None,
        "In-ground, four zones.",
        since_days=690,
    ),
    Yard(
        "patrick",
        "Patrick O'Neill",
        "811 Ranchlands Boulevard NW, Calgary, AB T3G 1T5",
        5300,
        None,
        None,
        None,
        since_days=230,
    ),
    Yard(
        "adebayo",
        "Adebayo Ogunleye",
        "171 Hawkwood Boulevard NW, Calgary, AB T3G 2S8",
        5800,
        "Gate code 6290.",
        None,
        None,
        since_days=4,
    ),
    Yard(
        "nina",
        "Nina Rossi",
        "3422 Elbow Drive SW, Calgary, AB T2S 2J7",
        7900,
        "Back gate, no lock.",
        None,
        "In-ground, five zones. Heads along the cedar hedge are flagged.",
        since_days=610,
    ),
    Yard(
        "marco",
        "Marco Esposito",
        "5715 Britannia Drive SW, Calgary, AB T2V 2B5",
        6900,
        "Side gate, no lock.",
        None,
        None,
        since_days=400,
    ),
    Yard(
        "ken",
        "Ken Takahashi",
        "2516 Silver Springs Road NW, Calgary, AB T3B 4N7",
        6300,
        "Gate code 1150.",
        None,
        "In-ground, three zones.",
        since_days=950,
    ),
    Yard(
        "olga",
        "Olga Petrenko",
        "4104 Charleswood Drive NW, Calgary, AB T2L 2E7",
        4900,
        None,
        None,
        None,
        since_days=380,
    ),
)
CONDO = Yard(
    "silverridge",
    "Silver Ridge Court Condominium Board",
    "5520 Silver Ridge Drive NW, Calgary, AB T3B 5J5",
    22000,
    "Maintenance gate by unit 12, code 2020. Park in visitor parking.",
    "Several residents walk dogs on the east lawn; pick up any litter before mowing.",
    "In-ground, twelve zones. The controller is in the maintenance room by unit 12.",
    since_days=760,
)
PEOPLE = (
    ("Sandeep", "Brar"),
    ("Maria", "Oliveira"),
    ("Wei", "Huang"),
    ("Thanh", "Pham"),
    ("Omar", "Khalil"),
    ("Chinedu", "Eze"),
    ("Oksana", "Kovalenko"),
    ("Fiona", "Campbell"),
    ("Gurpreet", "Sidhu"),
    ("José", "Reyes"),
    ("Mei", "Lin"),
    ("Hoang", "Tran"),
    ("Layla", "Nasser"),
    ("Tunde", "Bakare"),
    ("Andriy", "Melnyk"),
    ("Brian", "MacLeod"),
    ("Amandeep", "Grewal"),
    ("Grace", "Dela Cruz"),
    ("Kevin", "Huang"),
    ("Linh", "Vo"),
    ("Sami", "Aziz"),
    ("Ngozi", "Okeke"),
    ("Natalia", "Shevchenko"),
    ("Ian", "Robertson"),
    ("Simran", "Toor"),
    ("Paolo", "Navarro"),
    ("Alice", "Wong"),
    ("Minh", "Le"),
    ("Hassan", "Ibrahim"),
    ("Folake", "Adeyemi"),
    ("Dmytro", "Bondar"),
    ("Heather", "Sinclair"),
    ("Jaspreet", "Mann"),
    ("Carlo", "Aquino"),
    ("Emily", "Leung"),
    ("Rachel", "Gauthier"),
)
GENERATED = len(PEOPLE)
STREETS = (
    ("Varsity Estates Drive NW", "T3B 3B9"),
    ("Dalhousie Drive NW", "T3A 1B8"),
    ("Edgemont Boulevard NW", "T3A 2M5"),
    ("Hawkwood Boulevard NW", "T3G 2S2"),
    ("Silver Springs Road NW", "T3B 2Y4"),
    ("Brentwood Boulevard NW", "T2L 1L3"),
    ("Charleswood Drive NW", "T2L 1Z2"),
    ("Collingwood Drive NW", "T2L 0R2"),
    ("Cambrian Drive NW", "T2K 1P9"),
    ("Bowness Road NW", "T3B 0A9"),
    ("Parkdale Boulevard NW", "T2N 3S9"),
    ("Ranchlands Boulevard NW", "T3G 1M8"),
)
GATES = (
    "Gate code {code}.",
    "Side gate, no lock.",
    "Back gate from the lane.",
    "Gate code {code}; the latch is on the inside at the top.",
)
# client -> weekday, start, every n weeks, how they pay; all on Jonah's mowing route
SERIES: dict[str, tuple[int, time, int, Settle]] = {
    "helen": (0, time(8, 0), 1, "card"),
    "rosa": (0, time(9, 0), 1, "card"),
    "home_00": (0, time(10, 0), 2, "card"),
    "home_01": (0, time(11, 0), 2, "card"),
    "jun": (1, time(10, 0), 1, "card"),
    "home_02": (1, time(11, 0), 1, "etransfer"),
    "carol": (2, time(8, 0), 1, "card"),
    "harjit": (2, time(9, 0), 1, "card"),
    "home_03": (2, time(10, 0), 2, "card"),
    "tom": (3, time(8, 0), 1, "cheque"),
    "home_04": (3, time(9, 0), 2, "card"),
    "home_05": (3, time(10, 0), 1, "card"),
    "kwame": (4, time(8, 0), 2, "etransfer"),
    "home_06": (4, time(9, 0), 1, "card"),
    "home_07": (4, time(10, 0), 2, "card"),
}
CONDO_SERIES = (1, time(7, 30))
# last winter's plan holders renewed this October; the rest signed up this fall
SNOW_RENEWALS = (
    ("tom", 371),
    ("bernadette", 359),
    ("ken", 368),
    ("harjit", 367),
    ("home_09", 372),
    ("home_10", 376),
)
SNOW_SIGNUPS = (("linda", 23), ("patrick", 11), ("adebayo", 3), ("home_11", 16))
PHOTO_CLIENTS = (
    "helen",
    "amir",
    "lucy",
    "kwame",
    "home_01",
    "graham",
    "farah",
    "svetlana",
    "bernadette",
    "tom",
    "yusuf",
    "chloe",
    "linda",
    "adebayo",
    "nina",
    "harjit",
    "marco",
    "olga",
    "rosa",
    "jun",
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    mowing = item_id in {WEEKLY, BIWEEKLY, SNOW}
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="standard",
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=item_id in {CONSULT, WEEKLY, SPRING, FALL, HEDGE, BEDS, SNOW},
        addon_for=(PROJECT, BEDS, SPRING, FALL) if kind == "product" else (),
        buffer_after_min=(MOW_TRAVEL_MIN if mowing else TRAVEL_MIN) if kind == "service" else 0,
        deposit_type="percent" if item_id == PROJECT else "none",
        deposit_value=30 if item_id == PROJECT else None,
        frequency="year" if kind == "subscription" else None,
        sku=stock[3] if stock else ("FH-SOD-KBG" if item_id == SOD else None),
        cost_cents=stock[2] if stock else (310 if item_id == SOD else None),
        stock=Stock(stock[0], stock[1]) if stock else None,
        sessions=5 if kind == "package" else None,
        covers=SNOW if kind == "package" else None,
        validity_days=365 if kind == "package" else None,
        ref={SNOW_PLAN: "snow", SNOW_PACK: "snow_five"}.get(item_id),
        contract=SNOW_AGREEMENT if item_id == SNOW_PLAN else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(FOOTHILLS),
    code="fh",
    slug="foothills",
    login_domain="foothills.example",
    owner=FOOTHILLS_OWNER,
    people=(
        Person(
            FOOTHILLS_OWNER,
            BOSS,
            "owner",
            "Ravi Gill",
            "+15875550190",
            "owner",
            "Owner, estimates and snow clearing",
            "#2F5D3A",
            HOURS[BOSS],
        ),
        Person(
            "us_fh_megan",
            MEGAN,
            "megan",
            "Megan Doyle",
            "+15875550191",
            "staff",
            "Crew lead, cleanups and projects",
            "#B5762E",
            HOURS[MEGAN],
            payee=True,
            rate_type="hourly",
            rate_cents=2900,
        ),
        Person(
            "us_fh_tyler",
            TYLER,
            "tyler",
            "Tyler Nguyen",
            "+15875550192",
            "staff",
            "Seasonal crew, hedges and beds",
            "#3E6B5A",
            HOURS[TYLER],
            payee=True,
            rate_type="hourly",
            rate_cents=2150,
        ),
        Person(
            "us_fh_jonah",
            JONAH,
            "jonah",
            "Jonah Pelletier",
            "+15875550193",
            "staff",
            "Seasonal crew, mowing route",
            "#5E7FA3",
            HOURS[JONAH],
            payee=True,
            rate_type="hourly",
            rate_cents=2000,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Mowing, cleanups, garden beds and snow clearing for homes and condos in "
        "northwest Calgary.",
        "about": (
            "Foothills Lawn and Garden is a crew of four based in northeast Calgary. From May "
            "to October we mow on a weekly or every-two-weeks route, trim hedges, look after "
            "garden beds and build new ones. Spring and fall cleanups book up early, so we "
            "open them a month ahead. In winter we clear driveways and sidewalks for clients "
            "on our snow plan. Ravi quotes every project in person, and the estimate lists "
            "labour and materials line by line."
        ),
        "address": "2615 42 Avenue NE, Calgary, AB T2E 7T1",
        "phone": "+1 587-555-0198",
        "email": "hello@foothills.example",
        "neighbourhood": "Northwest Calgary",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 48,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject="property",
    sms_number="+15875550199",
    gst_hst_number="742318956RT0001",
    forms=(
        FormSpec(
            PROPERTY_FORM,
            "New property details",
            "ff_fh_property_",
            PROPERTY_FIELDS,
            send_on="booking",
        ),
        FormSpec(
            SIGN_OFF_FORM,
            "Project sign-off",
            "ff_fh_sign_off_",
            SIGN_OFF_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK_FORM, "Visit feedback", "ff_fh_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(
            LAWN_AGREEMENT,
            "Seasonal lawn care agreement",
            LAWN_BODY,
            version=2,
            earlier_body=LAWN_V1,
            revised_day=-215,
            created_day=-400,
        ),
        ContractSpec(PROJECT_AGREEMENT, "Landscape project agreement", PROJECT_BODY),
        ContractSpec(SNOW_AGREEMENT, "Winter snow plan agreement", SNOW_BODY, created_day=-400),
    ),
    storyline=(
        Stage("Weekly mowing series that ends with the season", "helen", ("sch_fh_helen",)),
        Stage(
            "Fall cleanup quotes sent, one accepted and booked",
            "amir",
            ("est_fh_lucy", "est_fh_kwame", "est_fh_amir", "bk_fh_amir"),
        ),
        Stage(
            "Project accepted, deposit paid, done with before and after photos",
            "mariana",
            ("est_fh_mariana", "bk_fh_mariana", "fl_fh_mariana_before", "fl_fh_mariana_after"),
        ),
        Stage(
            "Project accepted and booked, deposit paid", "graham", ("est_fh_graham", "bk_fh_graham")
        ),
        Stage("Sod estimate sent with optional lines", "farah", ("est_fh_farah",)),
        Stage(
            "Today's route: on site, on the way and later today",
            "bernadette",
            ("bk_fh_bernadette", "bk_fh_chloe"),
        ),
        Stage(
            "Snow plan sign-ups for the winter",
            "linda",
            ("sub_fh_snow_linda", "sub_fh_snow_patrick", "sub_fh_snow_adebayo"),
        ),
        Stage(
            "Condo board on a weekly series, one invoice overdue",
            "silverridge",
            ("sch_fh_silverridge", "inv_fh_silverridge_hedges"),
        ),
        Stage("Rain-delayed visit moved to the next dry day", "nina", ("bk_fh_nina",)),
        Stage("Five-star feedback and a review request", "harjit", ("fr_fh_feedback_harjit",)),
        Stage(
            "Three-star feedback about a gate left open, with a reply",
            "carol",
            ("fr_fh_feedback_carol",),
        ),
        Stage("Hedge trim paid by Tap to Pay", "marco", ("ord_fh_marco",)),
        Stage("Declined retaining wall estimate", "doug", ("est_fh_doug",)),
    ),
    pacing=Pacing(
        {MEGAN: 8, TYLER: 7, BOSS: 2, JONAH: 4},
        (BEDS, HEDGE),
        weeks=37,
        ahead_weeks=5,
        seasonality={
            1: 0.0,
            2: 0.0,
            3: 0.0,
            4: 0.6,
            5: 1.2,
            6: 1.0,
            7: 0.9,
            8: 0.9,
            9: 1.0,
            10: 1.2,
            11: 0.3,
            12: 0.0,
        },
        services_by_month={
            4: (SPRING, SPRING, BEDS),
            5: (SPRING, BEDS, SPRING, HEDGE),
            6: (HEDGE, BEDS, BEDS),
            7: (BEDS, HEDGE),
            8: (BEDS, HEDGE, BEDS),
            9: (FALL, HEDGE, BEDS),
            10: (FALL, FALL, HEDGE, FALL),
            11: (FALL,),
        },
        settlements=SETTLEMENTS,
        cancel_every=31,
    ),
    photo_clients=PHOTO_CLIENTS,
    founded_day=-2200,
    catalog_day=-420,
    documents_day=-410,
    restock_days=(-420, -200, -150, -110, -60, -25),
    payouts_from_day=-250,
    invoice_start=4300,
    estimate_start=610,
    cheque_start=1200,
    seed=47,
)


def _email(name: str) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", name.lower()) if c.isascii())
    return f"{plain.replace(' ', '.').replace('-', '').replace("'", '')}@example.test"


def _generated(index: int) -> Yard:
    first, last = PEOPLE[index]
    street, postal = STREETS[index % len(STREETS)]
    number = 104 + (index * 173) % 5800
    code = f"{(index * 7919) % 9000 + 1000}"
    return Yard(
        f"home_{index:02}",
        f"{first} {last}",
        f"{number} {street}, Calgary, AB {postal}",
        4200 + (index * 389) % 4200,
        GATES[index % len(GATES)].format(code=code),
        "A dog in the yard; keep the gate latched." if index % 6 == 2 else None,
        ("In-ground, three zones.", None, "Hose and sprinklers only.")[index % 3],
        since_days=120 + (index * 47) % 700,
    )


def _attributes(yard: Yard) -> dict[str, object]:
    access = " ".join(
        part
        for part in (yard.gate, f"Sprinklers: {yard.irrigation}" if yard.irrigation else None)
        if part
    )
    attributes = PropertyAttributes.model_validate(
        {
            "address": yard.address,
            "access": access or None,
            "pets": yard.dogs,
            "lot_size_sqft": yard.lot_sqft,
            "irrigation": yard.irrigation or "None",
        }
    )
    return attributes.model_dump(mode="json", exclude_none=True)


class Foothills(Demo):
    spec = SPEC

    def story(self) -> None:
        self.yards()
        self.seasons()
        self.regulars()
        self.today_route()
        self.storyline()
        self.winter()
        self.fill(self.routine_clients())
        self.paperwork()
        self.engagement()

    def finish(self) -> None:
        super().finish()
        negative = self.negative_clients()
        add_photos(
            self.ctx,
            self.spec.id,
            [p.user_id for p in self.spec.people if p.photo],
            [
                self.client_id(key)
                for key in self.spec.photo_clients
                if self.client_id(key) not in negative
            ],
        )

    def negative_clients(self) -> set[str]:
        """Clients a stock portrait may not stand in for, by the rules demo_validate checks."""
        ctx = self.ctx
        paid: Counter[str] = Counter()
        for payment in ctx.all(Payment):
            if payment.invoice_id and payment.status == "succeeded" and payment.kind != "refund":
                paid[payment.invoice_id] += payment.amount_cents
        found: set[str | None] = {
            *(
                b.client_id
                for b in ctx.all(Booking)
                if b.status in {"no_show", "waitlisted"} or b.deposit_status == "forfeited"
            ),
            *(e.client_id for e in ctx.all(Estimate) if e.status == "declined"),
            *(s.client_id for s in ctx.all(Signature) if s.status in {"declined", "expired"}),
            *(
                p.client_id
                for p in ctx.all(Payment)
                if p.status == "failed" or p.dispute_status is not None
            ),
            *(
                i.client_id
                for i in ctx.all(Invoice)
                if i.overdue_notified_at is not None
                or (i.status == "sent" and i.total_cents > paid[i.id])
            ),
            *(
                r.client_id
                for r in ctx.all(FormResponse)
                if int(str(r.answers.get("rating", 5))) <= 3
            ),
        }
        return {client_id for client_id in found if client_id}

    def visit_note(self, item: Item, booking: Booking) -> str:
        address = self.ctx.get(Subject, booking.subject_id or "").attributes.get("address", "")
        return f"{item.name} at {address}."

    def days_to(self, when: datetime) -> int:
        return (self.local(when).date() - self.local(self.now).date()).days

    def on(self, day: date, at: time) -> datetime:
        return datetime.combine(day, at, self.ctx.zone).astimezone(UTC)

    def this_year(self, month: int, day: int) -> date:
        """A date in the year of the latest mowing season to have started."""
        today = self.local(self.now).date()
        year = today.year if today >= date(today.year, *CREW_BACK) else today.year - 1
        return date(year, month, day)

    def crew(self, day: int = 0) -> str:
        """Tyler during the season; Ravi stands in while the seasonal crew is laid off."""
        when = self.local(self.at(day)).date()
        working = self.this_year(*CREW_BACK) <= when < self.this_year(*CREW_OFF) - timedelta(days=7)
        return TYLER if working else BOSS

    def last(self, month: int, day: int) -> date:
        """The latest such date on or before today."""
        today = self.local(self.now).date()
        found = date(today.year, month, day)
        return found if found <= today else date(today.year - 1, month, day)

    def yards(self) -> None:
        for index, yard in enumerate((*NAMED, *(_generated(i) for i in range(GENERATED)))):
            self.yard(yard, index)
        self.yard(CONDO, len(NAMED) + GENERATED, tags=["commercial", "condo board"])
        self.ctx.get(Subject, "sj_fh_silverridge").name = "Silver Ridge Court common grounds"

    def yard(self, yard: Yard, index: int, *, tags: list[str] | None = None) -> None:
        since = self.at(-yard.since_days, 10) if yard.since_days else None
        self.client(
            yard.key,
            yard.name,
            "board@silverridgecourt.example.test" if tags else _email(yard.name),
            f"+1587555{100 + index:04}",
            tags=tags or [],
            channel="email" if tags or index % 3 == 0 else "sms",
            fields={"source": ("referral", "google", "lawn sign", "neighbour")[index % 4]},
            subject=yard.address.split(",")[0],
            attributes=_attributes(yard),
            since=since,
        )
        if since is not None:
            self.joined(yard.key, since)

    def routine_clients(self) -> list[str]:
        busy = {
            *SERIES,
            "lucy",
            "farah",
            "doug",
            "amir",
            "mariana",
            "graham",
            "nina",
            "marco",
            "ken",
            "adebayo",
            "silverridge",
            "carol",
            "harjit",
        }
        named = [y.key for y in NAMED if y.key not in busy]
        generated = [f"home_{i:02}" for i in range(GENERATED) if f"home_{i:02}" not in busy]
        return [*named, *generated]

    def seasons(self) -> None:
        """The seasonal crew is laid off from November to the end of April."""
        today = self.local(self.now).date()
        back = self.this_year(*CREW_BACK)
        off = self.this_year(*CREW_OFF)
        start = self.local(self.at(-(self.spec.pacing.weeks if self.spec.pacing else 30) * 7 - 7))
        for staff in (TYLER, JONAH):
            name = staff.removeprefix("st_fh_")
            if start.date() < back:
                self.time_off(
                    f"{name}_winter",
                    staff,
                    start.replace(hour=0).astimezone(UTC),
                    self.on(back, time(0, 0)),
                    "Seasonal crew, back for the mowing season",
                )
            if off < today + timedelta(days=150):
                self.time_off(
                    f"{name}_layoff",
                    staff,
                    self.on(off, time(0, 0)),
                    self.on(back.replace(year=back.year + 1), time(0, 0)),
                    "Seasonal crew, off until spring",
                )

    def regulars(self) -> None:
        for key, (weekday, at, every, settle) in SERIES.items():
            recurrence = self.season(
                key, WEEKLY if every == 1 else BIWEEKLY, weekday, at, every, settle
            )
            self.sign(
                f"{key}_lawn",
                key,
                LAWN_AGREEMENT,
                recurrence.created_at + timedelta(days=3, hours=9),
                f"sj_fh_{key}",
            )
        weekday, at = CONDO_SERIES
        self.season("silverridge", GROUNDS, weekday, at, 1, "cheque")
        # two long-time clients signed last season's agreement and haven't re-signed
        for key in ("tom", "helen"):
            signature = self.ctx.get(Signature, f"sig_fh_{key}_lawn")
            self.ctx.rows.remove(signature)
            self.sign(f"{key}_lawn", key, LAWN_AGREEMENT, self.at(-388, 18), f"sj_fh_{key}")
        helen = self.ctx.get(Booking, self.last_of("helen"))
        cleanup = self.place(
            MEGAN, FALL, self.days_to(helen.starts_at) + 7, "sj_fh_helen", past=False
        )
        if cleanup is not None and helen.starts_at > self.now:
            self.book(
                "helen_fall",
                "helen",
                FALL,
                MEGAN,
                cleanup,
                "confirmed",
                self.now - timedelta(days=2, hours=3),
            )
        self.note(
            "cl_fh_helen",
            "client",
            f"Final cut of the season on {self.local(helen.starts_at):%B} "
            f"{self.local(helen.starts_at).day}. Helen wants the fall cleanup the week after "
            "and the same weekly series again next May.",
            self.now - timedelta(days=3),
        )

    def last_of(self, key: str) -> str:
        bookings = [
            b
            for b in self.ctx.all(Booking)
            if b.client_id == self.client_id(key) and b.id.startswith(f"bk_fh_{key}_")
        ]
        return max(bookings, key=lambda b: b.starts_at).id

    def season(
        self, key: str, item_id: str, weekday: int, at: time, every: int, settle: Settle
    ) -> Recurrence:
        """A mowing series on Jonah's route from the first week of May to October 31."""
        opens = self.this_year(*SEASON_OPENS)
        opens += timedelta(days=(weekday - opens.weekday()) % 7)
        closes = self.this_year(*SEASON_CLOSES)
        visits = 1 + (closes - opens).days // (7 * every)
        byday: list[Weekday] = [WEEKDAYS[weekday]]
        recurrence = Recurrence(
            id=f"sch_fh_{key}",
            business_id=FOOTHILLS,
            item_id=item_id,
            staff_id=JONAH,
            client_id=self.client_id(key),
            frequency="week",
            interval=every,
            byday=byday,
            count=visits,
            status="active",
        )
        self.ctx.add(recurrence)
        recurrence.created_at = recurrence.updated_at = min(
            self.on(opens, at) - timedelta(days=24), self.now - timedelta(days=1)
        )
        days = expand_occurrences(
            start_date=opens,
            frequency="week",
            interval=every,
            byday=byday,
            count=visits,
            until=None,
        )
        length = timedelta(minutes=self.items[item_id].duration_min or 60)
        for index, day in enumerate(days):
            start = self.on(day, at)
            if not self.free(JONAH, f"sj_fh_{key}", start, start + length, 0, MOW_TRAVEL_MIN):
                raise ValueError(f"{recurrence.id}: visit {index} overlaps another visit")
            done = start + length <= self.now
            booking = self.book(
                f"{key}_{index}",
                key,
                item_id,
                JONAH,
                start,
                "completed" if done else "confirmed",
                recurrence.created_at,
            )
            self.ctx.get(Slot, booking.slot_id).recurrence_id = recurrence.id
            if done:
                self.bill(booking, settle)
        return recurrence

    def today_route(self) -> None:
        """Megan is on site at a fall cleanup and Tyler is on the way to a hedge trim."""
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        plan = (
            ("home_17", MEGAN, BEDS, -165),
            ("bernadette", MEGAN, FALL, -30),
            ("ewan", MEGAN, BEDS, 180),
            ("home_18", self.crew(), BEDS, -150),
            ("chloe", self.crew(), HEDGE, 15),
            ("home_08", self.crew(), BEDS, 165),
        )

        def window(item_id: str, offset: int) -> tuple[datetime, datetime]:
            start = (floor + timedelta(minutes=offset)).astimezone(UTC)
            return start, start + timedelta(minutes=self.items[item_id].duration_min or 60)

        def fits(staff: str, item_id: str, offset: int) -> bool:
            start, end = window(item_id, offset)
            return self.within_hours(staff, start, end)

        live = all(fits(staff, item, offset) for _, staff, item, offset in plan[1:2] + plan[4:5])
        for key, staff, item_id, offset in plan:
            start, end = window(item_id, offset)
            if live and not fits(staff, item_id, offset):
                continue
            if not live:
                found = self.place(staff, item_id, 1, f"sj_fh_{key}", past=False)
                assert found is not None
                start, end = found, found + (end - start)
            done = live and end <= self.now
            created = min(start - timedelta(days=12), self.now - timedelta(days=3))
            booking = self.book(
                key, key, item_id, staff, start, "completed" if done else "confirmed", created
            )
            if done:
                self.bill(booking, "card")
                booking.departed_at = start - timedelta(minutes=18)
                booking.checked_in_at = start + timedelta(minutes=2)
        if live:
            bernadette = self.ctx.get(Booking, "bk_fh_bernadette")
            bernadette.departed_at = bernadette.starts_at - timedelta(minutes=20)
            bernadette.checked_in_at = bernadette.starts_at + timedelta(minutes=4)
            chloe = self.ctx.get(Booking, "bk_fh_chloe")
            chloe.departed_at = self.now - timedelta(minutes=8)
        for key, body in (
            (
                "bernadette",
                "Both side gates unlocked. Blow out the sprinkler lines after the aeration; the "
                "valve box is by the back step. Leaves go to the compost bin, not the bags.",
            ),
            (
                "chloe",
                "Cedar hedge along the back lane and the two lilacs by the deck. Pip stays "
                "inside. Leave the trimmings bagged by the lane gate.",
            ),
            (
                "ewan",
                "Cut back the perennials in the front bed and top up the mulch at the walk. "
                "Back gate from the lane.",
            ),
        ):
            booking = next((b for b in self.ctx.all(Booking) if b.id == f"bk_fh_{key}"), None)
            if booking is not None:
                self.note(booking.id, "booking", body, booking.created_at)

    def storyline(self) -> None:
        self.fall_quotes()
        self.projects()
        self.rain_delay()
        self.tap_to_pay()
        self.refund_story()
        self.spring()
        self.condo()

    def consult(self, key: str, day: int, *, status: BookingStatus = "completed") -> Booking:
        past = status == "completed"
        start = self.place(BOSS, CONSULT, day, f"sj_fh_{key}", past=past)
        assert start is not None
        created = min(start - timedelta(days=5), self.now - timedelta(hours=6))
        return self.book(
            f"{key}_consult", key, CONSULT, BOSS, start, status, created, source="online"
        )

    def fall_quotes(self) -> None:
        sent = (
            (
                "lucy",
                -5,
                "Fall cleanup for a 4,200 sq ft lot with a back lane gate. Gutter clearing and "
                "a bed cutback are optional.",
                (
                    (None, 1, "Gutter clearing, single-storey house", 9500),
                    (BEDS, 1, "Cut back and mulch the front perennial bed", 12000),
                ),
            ),
            (
                "kwame",
                -3,
                "Fall cleanup with aeration. The larger lot and the leaves from the two "
                "poplars add time, so a second crew member is included.",
                (
                    (None, 1, "Second crew member for the poplar leaves, 2 hours", 11000),
                    (MULCH, 2, "Shredded cedar mulch for the front beds", 7200),
                ),
            ),
        )
        for key, day, note, optional in sent:
            visit = self.consult(key, day - 2)
            assert visit.completed_at is not None
            self.estimate(
                key,
                key,
                Quote(FALL),
                min(visit.completed_at + timedelta(hours=6), self.now - timedelta(hours=2)),
                status="sent",
                note=note,
                optional=optional,
            )
        self.estimate(
            "home_12",
            "home_12",
            Quote(FALL),
            self.now - timedelta(hours=3),
            status="draft",
            note="Draft from the lawn sign enquiry. Confirm the lot size before sending.",
        )
        # accepted and booked for next week
        amir = self.consult("amir", -9)
        assert amir.completed_at is not None
        quote = Quote(FALL, ((MULCH, 3),))
        estimate = self.estimate(
            "amir",
            "amir",
            quote,
            amir.completed_at + timedelta(hours=5),
            status="accepted",
            decided=amir.completed_at + timedelta(days=1, hours=3),
            note="Fall cleanup with aeration for the 8,200 sq ft lot, plus three yards of "
            "mulch for the beds along the back fence. We'll blow out the sprinklers too.",
        )
        helper = self.crew(6)
        start = self.place(MEGAN, FALL, 6, "sj_fh_amir", past=False, helper=helper)
        assert start is not None and estimate.accepted_at is not None
        booking = self.book(
            "amir",
            "amir",
            FALL,
            MEGAN,
            start,
            "confirmed",
            estimate.accepted_at + timedelta(minutes=20),
        )
        assert self.helper_on(booking, helper)
        self.addons(booking, estimate, quote)

    def projects(self) -> None:
        mariana_quote = Quote(PROJECT, ((SOIL, 4), (MULCH, 3), (PERENNIAL, 14), (SHRUB, 3)))
        booking = self.project(
            "mariana",
            mariana_quote,
            consult_day=-38,
            project_day=-12,
            note="A new 18 by 6 ft garden bed along the back fence: remove the sod, cap the "
            "sprinkler line, add soil mix, plant perennials and three dogwoods, then mulch.",
            settle="etransfer",
        )
        self.job_photos("mariana", booking)
        self.sign_off(
            "mariana",
            booking,
            "New bed along the back fence: sod removed, sprinkler line capped, four yards of "
            "soil mix, fourteen perennials and three dogwoods planted, three yards of mulch.",
            17,
        )
        graham_quote = Quote(PROJECT, ((BLOCK, 60), (SOIL, 2), (SOD, 40), (PERENNIAL, 8)))
        self.project(
            "graham",
            graham_quote,
            consult_day=-17,
            project_day=9,
            note="A low retaining wall along the side yard slope, two feet high and 24 feet "
            "long, with new sod above it and a strip of perennials at its base.",
        )
        farah = self.consult("farah", -4)
        assert farah.completed_at is not None
        self.estimate(
            "farah",
            "farah",
            Quote(PROJECT, ((SOIL, 3), (SOD, 55))),
            min(farah.completed_at + timedelta(hours=20), self.now - timedelta(hours=1)),
            status="sent",
            note="Replace the front lawn: strip the old sod, regrade, add soil mix and lay new "
            "Kentucky bluegrass. The bed edging and the mulch are optional.",
            optional=(
                (None, 1, "Steel bed edging, 40 ft installed", 46000),
                (MULCH, 2, "Shredded cedar mulch for the new bed edge", 7200),
            ),
        )
        estimate = self.ctx.get(Estimate, "est_fh_farah")
        self.ctx.add(
            Signature(
                id="sig_fh_farah",
                business_id=FOOTHILLS,
                contract_id=PROJECT_AGREEMENT,
                client_id="cl_fh_farah",
                parent_type="subject",
                parent_id="sj_fh_farah",
                token="demo_signature_fh_farah",
                status="pending",
                contract_version=1,
                opened_at=min(
                    estimate.created_at + timedelta(hours=4), self.now - timedelta(minutes=30)
                ),
                created_at=estimate.created_at + timedelta(minutes=5),
                updated_at=estimate.created_at + timedelta(minutes=5),
            )
        )
        doug = self.consult("doug", -26)
        assert doug.completed_at is not None
        declined = self.estimate(
            "doug",
            "doug",
            Quote(PROJECT, ((BLOCK, 140), (SOIL, 3), (SHRUB, 6))),
            doug.completed_at + timedelta(hours=22),
            status="declined",
            decided=doug.completed_at + timedelta(days=8),
            note="A terraced retaining wall in the back yard, two tiers of about 2.5 ft, with "
            "shrubs planted on the terrace.",
        )
        declined.decline_reason = (
            "We've decided to wait until next spring and do the wall and the patio together."
        )

    def project(
        self,
        key: str,
        quote: Quote,
        *,
        consult_day: int,
        project_day: int,
        note: str,
        settle: Settle = "etransfer",
    ) -> Booking:
        visit = self.consult(key, consult_day)
        assert visit.completed_at is not None
        sent = visit.completed_at + timedelta(hours=20)
        accepted = sent + timedelta(days=2, hours=4)
        estimate = self.estimate(
            key, key, quote, sent, status="accepted", decided=accepted, note=note
        )
        self.sign(key, key, PROJECT_AGREEMENT, accepted + timedelta(minutes=15), f"sj_fh_{key}")
        booked = accepted + timedelta(minutes=30)
        past = project_day < 0
        helper = self.crew(project_day)
        start = self.place(
            MEGAN,
            PROJECT,
            project_day,
            f"sj_fh_{key}",
            past=past,
            not_before=booked + timedelta(days=5),
            helper=helper,
        )
        assert start is not None
        booking = self.book(
            key, key, PROJECT, MEGAN, start, "completed" if past else "confirmed", booked
        )
        assert self.helper_on(booking, helper)
        self.deposit(booking, booked + timedelta(minutes=10))
        if not past:
            self.addons(booking, estimate, quote)
            return booking
        assert booking.completed_at is not None
        address = self.ctx.get(Subject, f"sj_fh_{key}").attributes.get("address", "")
        invoice = self.invoice(
            key,
            key,
            booking.completed_at + timedelta(minutes=40),
            booked,
            f"Landscape project at {address}. Plants are covered for one growing season.",
        )
        booking.invoice_id = estimate.converted_invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booked, booking=booking)
        self.settle(invoice, key, settle)
        return booking

    def job_photos(self, key: str, booking: Booking) -> None:
        slot = self.ctx.get(Slot, booking.slot_id)
        for caption, asset, minutes in (
            ("before", "fh_photo_before.jpg", 10),
            ("progress", "fh_photo_progress.jpg", 240),
            ("after", "fh_photo_after.jpg", 455),
        ):
            when = slot.starts_at + timedelta(minutes=minutes)
            self.ctx.add(
                File(
                    id=f"fl_fh_{key}_{caption}",
                    business_id=FOOTHILLS,
                    parent_type="booking",
                    parent_id=booking.id,
                    purpose="photo",
                    s3_key=f"{FOOTHILLS}/demo/{asset}",
                    content_type="image/jpeg",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=when,
                    updated_at=when,
                )
            )

    def sign_off(self, key: str, booking: Booking, work: str, plants: int) -> None:
        slot = self.ctx.get(Slot, booking.slot_id)
        client = self.ctx.get(Client, booking.client_id)
        submitted = slot.ends_at - timedelta(minutes=8)
        self.response(
            "sign_off",
            key,
            SIGN_OFF_FORM,
            booking,
            {
                "completed_on": self.local(slot.starts_at).date().isoformat(),
                "work_done": work,
                "plants_installed": plants,
                "locate_ticket": f"USP-{self.local(slot.starts_at):%y%m%d}-0{len(key) * 7}",
                "watering_explained": True,
                "site_clean": True,
                "rating": 5,
            },
            submitted,
            opened=submitted - timedelta(minutes=6),
            created=submitted - timedelta(minutes=15),
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.61"},
        )

    def rain_delay(self) -> None:
        """Nina's hedge trim was rained out yesterday and moved to the next dry day."""
        start = self.place(MEGAN, HEDGE, 1, "sj_fh_nina", past=False)
        assert start is not None
        rained = self.local(self.now).date() - timedelta(days=1)
        while rained.weekday() > 4:
            rained -= timedelta(days=1)
        original = self.on(rained, time(13, 0))
        booking = self.book(
            "nina", "nina", HEDGE, MEGAN, start, "confirmed", original - timedelta(days=9)
        )
        booking.reschedule_count = 1
        moved = self.on(rained, time(7, 40))
        booking.updated_at = moved
        local = self.local(start)
        self.note(
            booking.id,
            "booking",
            f"Moved from {rained:%A, %B} {rained.day} at 1:00 PM because of rain. Cedar hedge "
            "along the south fence and the front spruce row. Heads along the hedge are flagged.",
            moved,
        )
        self.ctx.add(
            Audit(
                id="aud_fh_nina_rain",
                business_id=FOOTHILLS,
                performed_by=FOOTHILLS_OWNER,
                action="booking.reschedule",
                entity_type="booking",
                entity_id=booking.id,
                changes={"from": original.isoformat(), "to": start.isoformat()},
                created_at=moved,
            )
        )
        thread = self.thread("nina", "sms", moved)
        self.say(
            thread,
            f"Hi Nina, it's Ravi from Foothills. Rain is forecast all afternoon, so we'd like to "
            f"move today's hedge trim to {local:%A} at {_clock(local)}. Does that work?",
            moved,
        )
        self.say(
            thread,
            "Yes, that's fine. Thanks for the heads up.",
            moved + timedelta(minutes=35),
            sender=None,
        )
        self.say(
            thread,
            f"Thanks, Nina. You're booked for {local:%A, %B} {local.day} at {_clock(local)}.",
            moved + timedelta(minutes=40),
        )

    def tap_to_pay(self) -> None:
        booking = self.visit("marco", "marco", HEDGE, self.crew(-6), -6, settle=None)
        assert booking is not None and booking.completed_at is not None
        self.sale(
            "marco",
            "marco",
            booking.staff_id or BOSS,
            Quote(HEDGE),
            booking,
            booking.created_at,
            booking.completed_at + timedelta(minutes=8),
        )
        self.note(
            booking.id,
            "booking",
            "Marco paid at the door by Tap to Pay. Trim the caragana hedge lower next time, "
            "about 4 ft.",
            booking.completed_at + timedelta(minutes=10),
        )

    def spring(self) -> None:
        """Spring cleanups for the clients whose stories need a visit before the first mow."""
        for key in ("carol", "harjit"):
            day = (self.this_year(4, 24) - self.local(self.now).date()).days
            booking = self.visit(f"{key}_spring", key, SPRING, MEGAN, day if day < -1 else -2)
            if booking is not None:
                self.helper_on(booking, self.crew(self.days_to(booking.starts_at)))

    def refund_story(self) -> None:
        booking = self.visit("ken", "ken", FALL, MEGAN, -8)
        assert booking is not None and booking.invoice_id is not None
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == booking.invoice_id)
        assert payment.paid_at is not None
        self.refund(
            payment,
            6000,
            payment.paid_at + timedelta(days=1, hours=2),
            "Aeration skipped: the ground was too dry for the aerator to pull cores",
        )
        self.note(
            "cl_fh_ken",
            "client",
            "Refunded $60 for the aeration we couldn't do in the fall. Offer it with the spring "
            "cleanup once the ground is soft.",
            payment.paid_at + timedelta(days=1, hours=2),
        )

    def condo(self) -> None:
        hedges = self.visit(
            "silverridge_hedges",
            "silverridge",
            HEDGE,
            MEGAN,
            -44,
            settle=None,
            note="All the cedar hedges along the east and west paths, about 120 m.",
        )
        assert hedges is not None and hedges.completed_at is not None
        invoice = self.invoice(
            "silverridge_hedges",
            "silverridge",
            hedges.completed_at + timedelta(hours=2),
            hedges.created_at,
            "Hedge trimming of the common grounds, east and west paths. Four units of hedge "
            "trimming as quoted.",
        )
        hedges.invoice_id = invoice.id
        self.line(invoice.id, HEDGE, hedges.created_at, booking=hedges, quantity=4)
        self.settle(invoice, "silverridge", "overdue")

    def winter(self) -> None:
        """Last winter's snow clearings, this fall's plan renewals and sign-ups."""
        today = self.local(self.now).date()
        start = today - timedelta(weeks=(self.spec.pacing.weeks if self.spec.pacing else 30))
        package = self.package("olga", SNOW_PACK, self.on(self.last(1, 28), time(14, 0)))
        package_uses = 0
        for month, day in SNOWFALLS:
            fall = self.last(month, day)
            if fall < start or fall >= today - timedelta(days=1):
                continue
            offset = (fall - today).days
            plan = [key for key, _ in SNOW_RENEWALS]
            extra = ["olga"] if package_uses < 3 else []
            for index, key in enumerate([*plan, *extra, "home_13" if day % 2 else "home_14"]):
                staff = BOSS if index % 2 == 0 else MEGAN
                starts = self.place(staff, SNOW, offset, f"sj_fh_{key}", past=True, forward=True)
                if starts is None:
                    continue
                visit_key = f"snow_{key}_{month:02}{day:02}"
                created = starts - timedelta(hours=10)
                if key in plan:
                    booking = self.book(
                        visit_key, key, SNOW, staff, starts, "completed", created, price=0
                    )
                    self.note(booking.id, "booking", "Included in the winter snow plan.", created)
                elif key == "olga":
                    package_uses += 1
                    self.book(
                        visit_key,
                        key,
                        SNOW,
                        staff,
                        starts,
                        "completed",
                        created,
                        package_id=package.id,
                    )
                else:
                    booking = self.book(visit_key, key, SNOW, staff, starts, "completed", created)
                    self.bill(booking, "card")
        for key, days_ago in SNOW_RENEWALS:
            self.subscribe(key, SNOW_PLAN, self.at(-days_ago, 11))
        for key, days_ago in SNOW_SIGNUPS:
            self.subscribe(key, SNOW_PLAN, self.at(-days_ago, 19))

    def paperwork(self) -> None:
        for key in ("lucy", "kwame", "amir", "farah", "doug", "graham", "mariana"):
            consult = self.ctx.get(Booking, f"bk_fh_{key}_consult")
            self.property_answers(key, consult)
        for key in ("home_15", "home_16"):
            upcoming = self.consult(key, 4 + len(key) % 3 * 2, status="confirmed")
            self.response("property", key, PROPERTY_FORM, upcoming, {}, None)

    def property_answers(self, key: str, booking: Booking) -> None:
        site = self.ctx.get(Subject, booking.subject_id or "")
        attributes = site.attributes
        lot = int(str(attributes.get("lot_size_sqft", 5000)))
        submitted = min(
            booking.created_at + timedelta(hours=4), booking.starts_at - timedelta(hours=2)
        )
        answers: dict[str, object] = {
            "address": str(attributes.get("address", "")),
            "lot_size": "Under 4,000 sq ft"
            if lot < 4000
            else "4,000 to 6,000 sq ft"
            if lot <= 6000
            else "6,000 to 9,000 sq ft"
            if lot <= 9000
            else "Over 9,000 sq ft",
            "dogs": "Dogs, kept inside on service days" if attributes.get("pets") else "No dogs",
            "irrigation": "No sprinklers"
            if attributes.get("irrigation") == "None"
            else "Hose and sprinklers only"
            if "Hose" in str(attributes.get("irrigation"))
            else "In-ground sprinklers",
            "services": ["A landscaping project"]
            if key in {"farah", "doug", "graham", "mariana"}
            else ["Fall cleanup", "Snow clearing"],
            "preferred_day": "No preference",
        }
        gate = str(attributes.get("access") or "").split(" Sprinklers:")[0]
        if gate:
            answers["gate"] = gate
        if attributes.get("pets"):
            answers["dog_notes"] = str(attributes["pets"])
        if attributes.get("irrigation") not in {None, "None"}:
            answers["irrigation_notes"] = str(attributes["irrigation"])
        self.response("property", key, PROPERTY_FORM, booking, answers, submitted)

    def engagement(self) -> None:
        self.consents()
        self.withdraw("home_05", "email", self.now - timedelta(days=52))
        self.broadcast(
            "fall",
            "Fall cleanups and the snow plan",
            "Fall cleanup bookings are open for October and early November. Each one includes "
            "core aeration, leaves, the last cut and cutting back the perennials. Clients on a "
            "mowing series can reply to this email and we'll fit it in after your final cut. "
            "The winter snow plan is open too: we clear the driveway, front walk and city "
            "sidewalk after every snowfall of 5 cm or more, from November to April. It's "
            "$649 plus GST for the season.",
            self.at(-34, 10),
        )
        self.reviews()
        self.conversations()

    def feedback(
        self,
        key: str,
        booking: Booking,
        rating: int,
        highlights: list[str],
        comment: str | None = None,
        *,
        follow_up: bool = False,
    ) -> FormResponse:
        assert booking.completed_at is not None
        submitted = min(booking.completed_at + timedelta(hours=4), self.now - timedelta(hours=1))
        answers: dict[str, object] = {"rating": rating, "highlights": highlights}
        if comment:
            answers["comments"] = comment
        if follow_up:
            answers["follow_up"] = True
        return self.response(
            "feedback",
            key,
            FEEDBACK_FORM,
            booking,
            answers,
            submitted,
            created=booking.completed_at + timedelta(minutes=30),
        )

    def latest_visit(self, key: str, *, before: timedelta = timedelta(days=2)) -> Booking | None:
        done = [
            b
            for b in self.ctx.all(Booking)
            if b.client_id == self.client_id(key)
            and b.status == "completed"
            and b.completed_at is not None
            and b.completed_at < self.now - before
            and b.price_cents
        ]
        return max(done, key=lambda b: b.starts_at, default=None)

    def reviews(self) -> None:
        happy = (
            (
                "harjit",
                5,
                ["On time", "Clean edges", "Communication"],
                "Jonah has kept the lawn looking great all summer, and the edges along the "
                "driveway are always sharp.",
            ),
            ("rosa", 5, ["On time", "Clean edges"], None),
            ("jun", 5, ["Gates and yard left as we found them", "Clean edges"], None),
            ("svetlana", 5, ["Tidy cleanup", "Communication"], "The beds look so much better."),
            ("yusuf", 5, ["Tidy cleanup"], None),
            (
                "marco",
                5,
                ["On time", "Tidy cleanup"],
                "Quick and tidy, and paying at the door was easy.",
            ),
            (
                "home_06",
                4,
                ["Clean edges"],
                "Good work. Twice this summer the visit was a day "
                "late after rain, and a text would have helped.",
            ),
            ("tom", 5, ["On time", "Communication"], None),
        )
        for key, rating, highlights, comment in happy:
            booking = self.latest_visit(key)
            if booking is None:
                continue
            self.feedback(key, booking, rating, highlights, comment)
            if rating == 5:
                self.review(booking.id.removeprefix("bk_fh_"))
        mariana = self.ctx.get(Booking, "bk_fh_mariana")
        self.feedback(
            "mariana",
            mariana,
            5,
            ["Tidy cleanup", "Communication"],
            "Megan and the crew were careful around the sprinkler line and left the yard "
            "cleaner than they found it. The new bed looks lovely.",
        )
        self.review("mariana")
        carol = self.latest_visit("carol")
        if carol is not None:
            response = self.feedback(
                "carol",
                carol,
                3,
                ["Clean edges"],
                "The lawn looks fine, but the side gate was left open after the mow and Buddy "
                "got out into the lane. A neighbour caught him. Please make sure the gate is "
                "latched.",
                follow_up=True,
            )
            assert response.submitted_at is not None
            when = response.submitted_at + timedelta(hours=1, minutes=10)
            thread = self.thread("carol", "email", when)
            self.say(
                thread,
                "Carol, I'm sorry about the gate, and glad Buddy is safe. That's on us. Jonah "
                "now checks every gate he opened before he leaves a yard, and I've added a note "
                "to your property so it's the first thing he sees on your visits.",
                when,
                sender=FOOTHILLS_OWNER,
            )
            self.say(
                thread,
                "Thank you, Ravi. I appreciate the quick reply.",
                min(when + timedelta(hours=3), self.now - timedelta(minutes=20)),
                sender=None,
            )
            self.note(
                "sj_fh_carol",
                "subject",
                "Latch the side gate and check it clicks shut before leaving. Buddy (beagle) "
                "gets out through an open gate.",
                when,
            )

    def conversations(self) -> None:
        ctx = self.ctx
        lucy = ctx.get(Estimate, "est_fh_lucy")
        when = lucy.created_at + timedelta(minutes=20)
        thread = self.thread("lucy", "email", when)
        self.say(
            thread,
            "Hi Lucy, your fall cleanup estimate is ready. The gutter clearing and the bed "
            "cutback are optional, so you can tick them or leave them off when you accept.",
            when,
            sender=FOOTHILLS_OWNER,
        )
        self.say(
            thread,
            "Thanks! Do I need to be home on the day? We both work downtown.",
            min(when + timedelta(hours=4), self.now - timedelta(minutes=50)),
            sender=None,
        )
        self.say(
            thread,
            "No need. With the lane gate unlocked we can do everything, and we'll text you when "
            "we're done.",
            min(when + timedelta(hours=5), self.now - timedelta(minutes=30)),
            sender=FOOTHILLS_OWNER,
        )
        chloe = ctx.get(Booking, "bk_fh_chloe")
        when = min(chloe.starts_at - timedelta(hours=22), self.now - timedelta(hours=3))
        local = self.local(chloe.starts_at)
        thread = self.thread("chloe", "sms", when)
        self.say(
            thread,
            f"Hi Chloe, Tyler from Foothills is booked for your hedge trim on {local:%A, %B} "
            f"{local.day} at {_clock(local)}. Reply here if anything has changed.",
            when,
        )
        self.say(
            thread,
            "Great, Pip will be inside. The lane gate is open.",
            when + timedelta(minutes=25),
            sender=None,
        )
        overdue = ctx.get(Invoice, "inv_fh_silverridge_hedges")
        if overdue.overdue_notified_at is not None:
            when = overdue.overdue_notified_at + timedelta(hours=2)
            thread = self.thread("silverridge", "email", when)
            self.say(
                thread,
                f"Hello, invoice {overdue.number} for the hedge trimming on the common grounds "
                "is past due. You can pay by card from the link in the invoice email, by "
                "e-Transfer to hello@foothills.example, or by cheque as usual.",
                when,
                sender=FOOTHILLS_OWNER,
            )
            self.say(
                thread,
                "Thanks, Ravi. The board approves invoices over $500 at its monthly meeting, "
                "which is next Thursday. We'll send the cheque after that.",
                when + timedelta(hours=6),
                sender=None,
            )
        mariana = ctx.get(Booking, "bk_fh_mariana")
        assert mariana.completed_at is not None
        when = mariana.completed_at + timedelta(days=2, hours=3)
        thread = self.thread("mariana", "email", when)
        self.say(
            thread,
            "Thank you all for the new garden. Everything has perked up after the rain. How "
            "often should I water the dogwoods now that it's getting colder?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Mariana, we're glad you like it. Give the dogwoods a deep soak once a week "
            "until the ground freezes, then one more good watering in late October. The mulch "
            "will help them through the winter.",
            when + timedelta(hours=2),
            sender=FOOTHILLS_OWNER,
        )
        helen = ctx.get(Booking, self.last_of("helen"))
        when = self.now - timedelta(days=2, hours=4)
        local = self.local(helen.starts_at)
        thread = self.thread("helen", "sms", when)
        if helen.starts_at < self.now:
            return
        self.say(
            thread,
            f"Hi Helen, your last mow of the season is on {local:%A, %B} {local.day}. Would you "
            "like us to book the fall cleanup for the week after?",
            when,
        )
        self.say(
            thread,
            "Yes please, and put me down for next summer too.",
            when + timedelta(hours=1),
            sender=None,
        )
        linda = ctx.get(Client, "cl_fh_linda")
        when = self.now - timedelta(days=24)
        thread = self.thread("linda", "email", when)
        self.say(
            thread,
            "Hi, I saw the email about the snow plan. Does it include the sidewalk in front of "
            "the house? The city is strict about it.",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"Hi {linda.name.split()[0]}, yes. The plan covers the driveway, the front walk and "
            "the city sidewalk, cleared within 24 hours of the snow stopping. You can sign up "
            "from the link in the email and the plan starts on November 1.",
            when + timedelta(hours=2),
            sender=FOOTHILLS_OWNER,
        )


def _clock(when: datetime) -> str:
    return f"{when:%I:%M %p}".removeprefix("0")


EDITION = Foothills
