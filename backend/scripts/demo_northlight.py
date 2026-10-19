"""Northlight Security: a four-person camera installer in Victoria, seeded beside Birchbark."""

import random
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.base import TimestampMixin
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import Item, StockMovement, Subscription
from clientbridge.models.clients import Client, Consent, Note, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Audit, File
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Addon, Booking, BookingStatus, Hours, Slot
from clientbridge.schemas.business import BrandInput
from clientbridge.schemas.subjects import Building, Equipment, SiteAttributes
from clientbridge.services.catalog import deposit_cents
from clientbridge.services.consents import allows_marketing
from clientbridge.services.forms import form_definition
from scripts.demo_chronology import align_timestamps, chronology_errors
from scripts.demo_context import BUSINESS_TIMEZONE, LEGAL_ADDRESSES, DemoContext
from scripts.demo_finance import (
    apply_deposit_at,
    post_invoices,
    post_payments,
    price_documents,
    seed_earnings,
    seed_payouts,
)
from scripts.demo_identity import placeholder_identity
from scripts.demo_validate import validate_graph

NORTHLIGHT = "bz_northlight"
NORTHLIGHT_OWNER = "us_nl_owner"
ASSETS = Path(__file__).parent / "demo_assets"

BOSS, OFFICE, LIAM, AVA = "st_nl_owner", "st_nl_office", "st_nl_liam", "st_nl_ava"
SURVEY, HOME, SHOP, CALL, CHECK = (
    "it_nl_survey",
    "it_nl_install_home",
    "it_nl_install_commercial",
    "it_nl_service_call",
    "it_nl_system_check",
)
TURRET, BULLET, DOORBELL, PTZ = "it_nl_turret", "it_nl_bullet", "it_nl_doorbell", "it_nl_ptz"
NVR8, NVR16, SWITCH, CABLE, JBOX = (
    "it_nl_nvr8",
    "it_nl_nvr16",
    "it_nl_poe_switch",
    "it_nl_cable_run",
    "it_nl_junction_box",
)
REMOTE, MAINTENANCE = "it_nl_remote_viewing", "it_nl_maintenance"
SURVEY_FORM, HANDOVER_FORM = "frm_nl_site_survey", "frm_nl_handover"
AGREEMENT, NOTICE = "con_nl_agreement", "con_nl_surveillance"

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, str, str, int, int | None, str, str], ...] = (
    (
        SURVEY,
        "service",
        "Site survey",
        0,
        45,
        "Visits",
        "We walk the outside and inside with you, check the network and plan where each "
        "camera and the recorder should go. The estimate follows within two days.",
    ),
    (
        HOME,
        "service",
        "Residential install",
        52000,
        240,
        "Installs",
        "Half-day install for a house or townhouse: mounting, cable runs, recorder setup and "
        "the viewing app on your phone. Equipment is quoted separately.",
    ),
    (
        SHOP,
        "service",
        "Commercial install",
        104000,
        480,
        "Installs",
        "Full-day install for a shop, office or warehouse, including signage placement and a "
        "walkthrough of the recorder with your staff. Equipment is quoted separately.",
    ),
    (
        CALL,
        "service",
        "Service call",
        13500,
        60,
        "Visits",
        "One hour on site to fix, move or add a camera. Warranty repairs are not charged.",
    ),
    (
        CHECK,
        "service",
        "Annual system check",
        16500,
        90,
        "Visits",
        "Clean lenses, check every camera's picture and night view, update the recorder and "
        "test that recordings play back. Included in the maintenance plan.",
    ),
    (
        TURRET,
        "product",
        "4MP turret camera",
        21900,
        None,
        "Cameras",
        "Outdoor turret camera with 30 m night vision and a wide 2.8 mm lens.",
    ),
    (
        BULLET,
        "product",
        "4K bullet camera",
        27900,
        None,
        "Cameras",
        "Outdoor 4K bullet camera for driveways and long sightlines.",
    ),
    (
        DOORBELL,
        "product",
        "Video doorbell",
        23900,
        None,
        "Cameras",
        "Wired doorbell with a 2K camera and two-way talk; records to the recorder.",
    ),
    (
        PTZ,
        "product",
        "PTZ camera",
        89900,
        None,
        "Cameras",
        "Pan, tilt and 25x zoom camera for yards and parking lots.",
    ),
    (
        NVR8,
        "product",
        "8-channel recorder, 2 TB",
        49900,
        None,
        "Recorders",
        "Network video recorder for up to eight cameras, about 30 days of recording.",
    ),
    (
        NVR16,
        "product",
        "16-channel recorder, 4 TB",
        84900,
        None,
        "Recorders",
        "Network video recorder for up to sixteen cameras, for larger homes and businesses.",
    ),
    (
        SWITCH,
        "product",
        "8-port PoE switch",
        16900,
        None,
        "Network",
        "Powers and connects up to eight cameras over one cable each.",
    ),
    (
        CABLE,
        "product",
        "Cat6 cable run",
        6500,
        None,
        "Network",
        "One outdoor-rated Cat6 run up to 30 m, with connectors and clips.",
    ),
    (
        JBOX,
        "product",
        "Junction box",
        2900,
        None,
        "Network",
        "Weatherproof base that hides the cable joint behind a camera.",
    ),
    (
        REMOTE,
        "subscription",
        "Remote viewing and cloud backup",
        2499,
        None,
        "Plans",
        "Secure remote access from the app and a 7-day cloud copy of motion clips.",
    ),
    (
        MAINTENANCE,
        "subscription",
        "Maintenance plan",
        19900,
        None,
        "Plans",
        "A yearly plan with the annual system check included and priority service calls.",
    ),
)
COLORS = {
    SURVEY: "#3A7CA5",
    HOME: "#1F2F4A",
    SHOP: "#2E6670",
    CALL: "#A95C43",
    CHECK: "#5C6B3A",
    REMOTE: "#3F5E80",
    MAINTENANCE: "#7D5A82",
}
# on hand today, low-stock line, unit cost, SKU; the PTZ camera sits under its line
STOCK: dict[str, tuple[int, int, int, str]] = {
    TURRET: (26, 8, 11800, "NL-CAM-T4MP"),
    BULLET: (14, 6, 15200, "NL-CAM-B4K"),
    DOORBELL: (9, 4, 12800, "NL-DB-2K"),
    PTZ: (1, 2, 52000, "NL-CAM-PTZ"),
    NVR8: (7, 3, 26800, "NL-NVR-8CH"),
    NVR16: (4, 2, 45500, "NL-NVR-16CH"),
    SWITCH: (10, 4, 8200, "NL-SW-POE8"),
    JBOX: (40, 10, 1100, "NL-JB-01"),
}
EQUIPMENT_PREFIX = {
    TURRET: "T4M",
    BULLET: "B4K",
    DOORBELL: "VDB",
    PTZ: "PTZ",
    NVR8: "NVR8",
    NVR16: "NVR16",
    SWITCH: "SW8",
}
CAMERA_SPOTS = (
    "Front entrance",
    "Driveway",
    "Back yard",
    "Side gate",
    "Garage",
    "Back door",
    "Front yard",
    "Carport",
)
SHOP_SPOTS = (
    "Main entrance",
    "Parking lot",
    "Loading bay",
    "Rear door",
    "Office hallway",
    "Gate",
    "Yard",
    "Front counter",
)
# staff, weekday -> (start, end); the office manager is not bookable
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {**{d: (time(8, 0), time(17, 0)) for d in range(5)}, 5: (time(9, 0), time(13, 0))},
    LIAM: {**{d: (time(8, 0), time(17, 0)) for d in range(5)}, 5: (time(9, 0), time(15, 0))},
    AVA: {**{d: (time(8, 0), time(17, 0)) for d in range(5)}, 5: (time(9, 0), time(15, 0))},
}
TRAVEL_MIN = 30
WARRANTY_DAYS = 730
AGREEMENT_BODY = (
    "Northlight Security will supply and install the equipment listed on your accepted "
    "estimate at the site named on it. A 25% deposit on the labour is due when you book the "
    "install and is applied to the final invoice. Equipment stays ours until the invoice is "
    "paid in full. Cameras, recorders and doorbells carry a two-year parts warranty from the "
    "install date, and our labour is covered for one year. The warranty does not cover damage "
    "from storms, power surges or changes made by others. You can move or cancel the install "
    "at no charge up to 48 hours before it starts."
)
NOTICE_BODY = (
    "This notice covers the cameras Northlight Security installs at your business. You agree "
    "to post the signs we provide at each public entrance, saying that the area is recorded "
    "and who to contact with questions. Cameras will not point into washrooms, change rooms "
    "or neighbouring private property. Recordings are kept for 30 days and then overwritten, "
    "unless you save a clip for an incident. Only the people you name can view footage, and "
    "you are responsible for answering requests for footage from staff, customers or police. "
    "Tell us if any of this changes so we can update the recorder settings."
)
SURVEY_FIELDS: tuple[tuple[str, str, str, bool, tuple[str, ...]], ...] = (
    (
        "building_type",
        "select",
        "Building type",
        True,
        ("House", "Townhouse", "Apartment", "Retail", "Office", "Warehouse"),
    ),
    ("entrances", "number", "How many doors lead outside?", True, ()),
    (
        "existing_wiring",
        "select",
        "Existing wiring",
        False,
        ("None", "Cable from an old system", "Network cable in most rooms", "Not sure"),
    ),
    ("internet", "text", "Internet provider and where the modem is", False, ()),
    ("recorder_location", "text", "Where should the recorder go?", False, ()),
    ("goals", "longtext", "What do you want the cameras to cover?", False, ()),
    ("photo_front", "image", "A photo of the front of the building", False, ()),
    ("photo_side", "image", "A photo of the side or back entrance", False, ()),
)
HANDOVER_FIELDS: tuple[tuple[str, str, str, bool], ...] = (
    ("cameras_installed", "number", "Cameras installed", True),
    ("camera_locations", "longtext", "Where each camera is mounted", False),
    ("recorder_location", "text", "Where the recorder is", False),
    ("app_setup", "checkbox", "The viewing app is set up on my phone", True),
    (
        "retention_explained",
        "checkbox",
        "I know how long recordings are kept and how to save a clip",
        True,
    ),
    ("follow_up", "longtext", "Anything we need to follow up on", False),
)


@dataclass(frozen=True)
class Household:
    key: str
    name: str
    email: str
    phone: str
    address: str
    building: Building
    access: str | None = None
    pets: str | None = None
    internet: str | None = None
    recorder: str | None = None


@dataclass(frozen=True)
class Quote:
    labour: str
    parts: tuple[tuple[str, int], ...]


type Settle = Literal["card", "etransfer", "cheque", "open", "overdue"]

HOMEOWNERS = (
    Household(
        "harper",
        "Harper Sinclair",
        "harper.sinclair@example.test",
        "+12505550100",
        "1734 Hollywood Crescent, Victoria, BC V8S 1J2",
        "house",
        internet="Telus fibre, modem in the front hall",
    ),
    Household(
        "rajesh",
        "Rajesh Menon",
        "rajesh.menon@example.test",
        "+12505550101",
        "4012 Cedar Hill Cross Road, Saanich, BC V8N 2N9",
        "house",
        access="Park on the street; the driveway is shared.",
        internet="Shaw cable, modem in the basement office",
        recorder="Basement office closet",
    ),
    Household(
        "claire",
        "Claire Beaumont",
        "claire.beaumont@example.test",
        "+12505550102",
        "2251 Beach Drive, Oak Bay, BC V8R 6K1",
        "house",
        access="Lockbox on the side door, code sent by text the day before.",
        internet="Telus fibre, modem in the den",
        recorder="Den cabinet",
    ),
    Household(
        "owen",
        "Owen Gallagher",
        "owen.gallagher@example.test",
        "+12505550103",
        "3150 Carey Road, Saanich, BC V8Z 4H1",
        "house",
        access="Side gate code 4471. The garage is left open for the recorder shelf.",
        internet="Telus fibre, modem in the garage",
        recorder="Garage shelf beside the panel",
    ),
    Household(
        "meilin",
        "Mei Lin Zhou",
        "meilin.zhou@example.test",
        "+12505550104",
        "1462 Westall Avenue, Victoria, BC V8T 2G6",
        "house",
        access="Gate code 2208. Use the front door.",
        pets="Dog in the back yard (Juniper, friendly but jumps up). Keep the side gate shut.",
        internet="Shaw cable, modem in the upstairs office",
        recorder="Upstairs office closet",
    ),
    Household(
        "sarah",
        "Sarah Whitfield",
        "sarah.whitfield@example.test",
        "+12505550105",
        "887 Royal Oak Avenue, Saanich, BC V8X 3T4",
        "house",
        access="Back gate is unlocked during the day.",
        internet="Telus fibre, modem in the laundry room",
        recorder="Laundry room shelf",
    ),
    Household(
        "fiona",
        "Fiona MacLeod",
        "fiona.macleod@example.test",
        "+12505550106",
        "516 Admirals Road, Esquimalt, BC V9A 2N8",
        "house",
        pets="Cat indoors; keep doors closed.",
        internet="Shaw cable, modem in the living room",
        recorder="Hall closet",
    ),
    Household(
        "gordon",
        "Gordon Pike",
        "gordon.pike@example.test",
        "+12505550107",
        "2930 Glenwood Avenue, Victoria, BC V8T 3A7",
        "house",
    ),
    Household(
        "natalie",
        "Natalie Ferreira",
        "natalie.ferreira@example.test",
        "+12505550108",
        "1205 Haultain Street, Victoria, BC V8T 1V8",
        "townhouse",
    ),
    Household(
        "kevin",
        "Kevin Brandt",
        "kevin.brandt@example.test",
        "+12505550109",
        "3478 Tillicum Road, Saanich, BC V8Z 4H6",
        "house",
        internet="Telus fibre, modem in the basement",
        recorder="Basement utility room",
    ),
    Household(
        "joan",
        "Joan Whitaker",
        "joan.whitaker@example.test",
        "+12505550110",
        "4471 Cordova Bay Road, Saanich, BC V8X 3V5",
        "house",
        access="Key under the planter by the side door when Joan is away.",
        internet="Telus fibre, modem in the study",
        recorder="Study cabinet",
    ),
    Household(
        "arjun",
        "Arjun Bhatt",
        "arjun.bhatt@example.test",
        "+12505550111",
        "1018 Pemberton Road, Victoria, BC V8S 3R5",
        "house",
        internet="Shaw cable, modem in the front room",
        recorder="Front room cabinet",
    ),
    Household(
        "louise",
        "Louise Gagnon",
        "louise.gagnon@example.test",
        "+12505550112",
        "5 Sea Lion Way, View Royal, BC V9B 6S3",
        "townhouse",
        access="Visitor parking in front of unit 5.",
        internet="Telus fibre, modem in the kitchen",
        recorder="Kitchen pantry shelf",
    ),
    Household(
        "tariq",
        "Tariq Haddad",
        "tariq.haddad@example.test",
        "+12505550113",
        "2766 Shelbourne Street, Victoria, BC V8R 4M3",
        "house",
        internet="Telus fibre, modem in the den",
        recorder="Den closet",
    ),
    Household(
        "ingrid",
        "Ingrid Solberg",
        "ingrid.solberg@example.test",
        "+12505550114",
        "1590 Rockland Avenue, Victoria, BC V8S 1W5",
        "house",
        pets="Two dogs, kept inside during the install.",
        internet="Shaw cable, modem in the basement",
        recorder="Basement storage room",
    ),
    Household(
        "marco",
        "Marco Rossi",
        "marco.rossi@example.test",
        "+12505550115",
        "322 Kingston Street, Victoria, BC V8V 1V4",
        "townhouse",
        internet="Telus fibre, modem in the hall closet",
        recorder="Hall closet",
    ),
    Household(
        "hana",
        "Hana Kim",
        "hana.kim@example.test",
        "+12505550116",
        "1129 Oscar Street, Victoria, BC V8V 2X3",
        "apartment",
        access="Buzz 204 at the front door; strata approved the doorbell.",
        internet="Shaw cable, modem in the living room",
    ),
    Household(
        "peter",
        "Peter Nakamura",
        "peter.nakamura@example.test",
        "+12505550117",
        "3840 Blenkinsop Road, Saanich, BC V8P 3N9",
        "house",
        internet="Telus fibre, modem in the garage",
        recorder="Garage shelf",
    ),
    Household(
        "rebecca",
        "Rebecca Thornton",
        "rebecca.thornton@example.test",
        "+12505550118",
        "2041 Lansdowne Road, Oak Bay, BC V8P 1B4",
        "house",
        internet="Telus fibre, modem in the office",
        recorder="Office closet",
    ),
    Household(
        "colin",
        "Colin McAllister",
        "colin.mcallister@example.test",
        "+12505550119",
        "715 Ellery Street, Esquimalt, BC V9A 4R5",
        "house",
        internet="Shaw cable, modem in the basement",
        recorder="Basement shelf",
    ),
    Household(
        "diane",
        "Diane Ostrowski",
        "diane.ostrowski@example.test",
        "+12505550120",
        "4290 Lindsay Street, Saanich, BC V8N 4C9",
        "house",
        internet="Telus fibre",
    ),
    Household(
        "simon",
        "Simon Leclerc",
        "simon.leclerc@example.test",
        "+12505550121",
        "2610 Asquith Street, Victoria, BC V8R 3Y6",
        "house",
        access="Parking in the lane behind the house.",
        internet="Shaw cable, modem in the basement",
        recorder="Basement furnace room shelf",
    ),
    Household(
        "aisha",
        "Aisha Rahman",
        "aisha.rahman@example.test",
        "+12505550122",
        "1847 Carnarvon Street, Victoria, BC V8R 2V3",
        "house",
        internet="Telus fibre, modem in the den",
        recorder="Den cabinet",
    ),
    Household(
        "victor",
        "Victor Almeida",
        "victor.almeida@example.test",
        "+12505550123",
        "3395 Richmond Road, Saanich, BC V8P 4P7",
        "house",
    ),
    Household(
        "emily",
        "Emily Chow",
        "emily.chow@example.test",
        "+12505550124",
        "958 Craigflower Road, Esquimalt, BC V9A 2X9",
        "house",
        internet="Shaw cable, modem in the kitchen",
        recorder="Kitchen pantry",
    ),
    Household(
        "graham",
        "Graham Fletcher",
        "graham.fletcher@example.test",
        "+12505550125",
        "6120 Old West Saanich Road, Saanich, BC V9E 2G8",
        "house",
        access="Long gravel driveway; the gate opens from the keypad, code 1912.",
        internet="Starlink, router in the workshop",
        recorder="Workshop cabinet",
    ),
    Household(
        "nora",
        "Nora Lindgren",
        "nora.lindgren@example.test",
        "+12505550126",
        "2875 Colquitz Avenue, Saanich, BC V8Z 1J5",
        "house",
        internet="Telus fibre, modem in the hallway",
        recorder="Hall closet",
    ),
    Household(
        "patrick",
        "Patrick Doyle",
        "patrick.doyle@example.test",
        "+12505550127",
        "1432 Fort Street, Victoria, BC V8S 1Z1",
        "house",
        internet="Shaw cable, modem in the study",
        recorder="Study closet",
    ),
    Household(
        "ruth",
        "Ruth Abernathy",
        "ruth.abernathy@example.test",
        "+12505550128",
        "14 Cook Street Mews, Victoria, BC V8V 3W8",
        "townhouse",
        internet="Telus fibre, modem in the kitchen",
        recorder="Kitchen cupboard",
    ),
    Household(
        "jasmine",
        "Jasmine Oduya",
        "jasmine.oduya@example.test",
        "+12505550129",
        "3021 Jutland Road, Victoria, BC V8T 5K2",
        "house",
        internet="Telus fibre, modem in the front hall",
    ),
)
BUSINESSES = (
    Household(
        "islandstorage",
        "Island Self Storage",
        "accounts.islandstorage@example.test",
        "+12505550130",
        "2790 Jacklin Road, Langford, BC V9B 3X6",
        "warehouse",
        access="Office opens at 8. Ask for the gate fob at the front desk.",
        internet="Telus business fibre, rack in the office",
        recorder="Office network rack",
    ),
    Household(
        "cookdental",
        "Cook Street Dental",
        "office.cookdental@example.test",
        "+12505550131",
        "1120 Cook Street, Victoria, BC V8V 3Z9",
        "office",
        access="Install before 8 or after 5 on clinic days; staff entrance at the back.",
        internet="Shaw business, rack in the staff room",
        recorder="Staff room network rack",
    ),
    Household(
        "harbourbikes",
        "Harbourline Bikes",
        "hello.harbourbikes@example.test",
        "+12505550132",
        "530 Herald Street, Victoria, BC V8W 1S6",
        "retail",
        access="Loading door in the lane off Herald Street.",
        internet="Telus business fibre, modem behind the counter",
        recorder="Back office shelf",
    ),
    Household(
        "gorgeauto",
        "Gorge Road Auto",
        "service.gorgeauto@example.test",
        "+12505550133",
        "455 Gorge Road East, Victoria, BC V8T 2W1",
        "warehouse",
        access="Bays open at 7:30. Park by the tire rack.",
        internet="Shaw business, modem in the service office",
        recorder="Service office cabinet",
    ),
)
STORAGE_SAANICH = Household(
    "islandstorage_saanich",
    "Saanich facility",
    "",
    "",
    "4120 Glanford Avenue, Saanich, BC V8Z 4B6",
    "warehouse",
    access="Gate code 5530 after hours. The manager's office is beside unit A1.",
    internet="Shaw business, modem in the manager's office",
    recorder="Manager's office cabinet",
)
FIRST_NAMES = (
    "Brooke",
    "Colin",
    "Dana",
    "Elliot",
    "Gemma",
    "Hugo",
    "Iris",
    "Jonah",
    "Keira",
    "Lucas",
    "Mira",
    "Quinn",
)
LAST_NAMES = ("Arsenault", "Boyd", "Crane", "Desai", "Ellison")
STREETS = (
    ("Shelbourne Street", "Victoria", "V8R 4L9"),
    ("Richmond Road", "Victoria", "V8R 4H6"),
    ("Bay Street", "Victoria", "V8T 1R6"),
    ("Oak Bay Avenue", "Oak Bay", "V8R 1G2"),
    ("McKenzie Avenue", "Saanich", "V8N 1A9"),
    ("Gorge Road West", "Saanich", "V9A 1M7"),
    ("Burnside Road West", "Saanich", "V9A 1C2"),
    ("Lands End Road", "North Saanich", "V8L 5L8"),
    ("Goldstream Avenue", "Langford", "V9B 2X5"),
    ("Sooke Road", "Colwood", "V9C 3P4"),
    ("Beacon Avenue", "Sidney", "V8L 1X4"),
    ("Helmcken Road", "View Royal", "V9B 1S6"),
)
# the first few generated households are new leads and recent estimates, the rest past installs
GENERATED = 60
LEADS, QUOTED, BOOKED = range(0, 4), range(4, 7), range(7, 10)
HOME_QUOTES = (
    Quote(HOME, ((TURRET, 4), (NVR8, 1), (CABLE, 4), (JBOX, 4))),
    Quote(HOME, ((TURRET, 3), (DOORBELL, 1), (NVR8, 1), (CABLE, 4), (JBOX, 3))),
    Quote(HOME, ((TURRET, 2), (BULLET, 2), (NVR8, 1), (CABLE, 4), (JBOX, 2))),
    Quote(HOME, ((TURRET, 5), (BULLET, 1), (NVR8, 1), (SWITCH, 1), (CABLE, 6), (JBOX, 5))),
    Quote(HOME, ((DOORBELL, 1), (TURRET, 2), (NVR8, 1), (CABLE, 3), (JBOX, 2))),
)
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cheque", "etransfer")


def _add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    for last in (31, 30, 29, 28):
        try:
            return date(year, month, min(day.day, last))
        except ValueError:
            continue
    raise ValueError(f"no day in {year}-{month}")


def _site_attributes(home: Household) -> dict[str, object]:
    attributes = SiteAttributes(
        address=home.address,
        building=home.building,
        access=home.access,
        pets=home.pets,
        internet=home.internet,
        recorder_location=home.recorder,
    )
    return attributes.model_dump(mode="json", exclude_none=True)


def _generated_household(index: int) -> Household:
    first, last = FIRST_NAMES[index % 12], LAST_NAMES[index // 12]
    street, city, postal = STREETS[index % len(STREETS)]
    number = 1100 + (index * 137) % 3800
    building: Building = "townhouse" if index % 5 == 3 else "house"
    return Household(
        f"home_{index:02}",
        f"{first} {last}",
        f"{first.lower()}.{last.lower()}@example.test",
        f"+12505550{134 + index}",
        f"{number} {street}, {city}, BC {postal}",
        building,
        pets="Dog at home; keep gates closed." if index % 7 == 2 else None,
        internet="Telus fibre" if index % 2 else "Shaw cable",
        recorder="Basement shelf" if building == "house" else "Hall closet",
    )


class Northlight:
    def __init__(self, ctx: DemoContext) -> None:
        self.ctx = ctx
        self.rng = random.Random(23)
        self.busy: list[tuple[str, str | None, datetime, datetime, int, int]] = []
        self.invoice_number = 2100
        self.estimate_number = 300
        self.serial = 1800
        self.payment_number = 0
        self.sized: list[tuple[Payment, Literal["deposit", "balance", "total"]]] = []
        self.items: dict[str, Item] = {}

    def at(self, days: float, hour: int = 9, minute: int = 0) -> datetime:
        return self.ctx.at(days, hour, minute)

    @property
    def now(self) -> datetime:
        return self.ctx.now

    def build(self) -> None:
        self.identity()
        self.catalog()
        self.documents()
        self.households()
        self.storyline()
        self.history()
        self.upcoming()
        self.plans()
        self.engagement()
        self.finish()

    def identity(self) -> None:
        ctx = self.ctx
        founded = self.at(-640)
        brand = BrandInput.model_validate(
            {
                "logo_file_id": "fl_nl_logo",
                "primary": "#1F2F4A",
                "tagline": "Security cameras and video doorbells for homes and businesses in "
                "Greater Victoria.",
                "about": (
                    "Northlight Security is a team of four based in Quadra Village. We survey "
                    "your home or business, quote the equipment and labour line by line, "
                    "install the system and show you how to use it before we leave. Every "
                    "install has a two-year parts warranty, and we offer remote viewing and a "
                    "yearly maintenance plan that includes a system check."
                ),
                "address": "2860 Quadra Street, Victoria, BC V8T 4E7",
                "phone": "+1 250-555-0198",
                "email": "hello@northlight.example",
                "website": "https://northlight.example",
                "neighbourhood": "Quadra Village",
                "public_staff_ids": [BOSS, LIAM, AVA],
            }
        )
        ctx.add(
            Business(
                id=NORTHLIGHT,
                name="Northlight Security",
                slug="northlight",
                timezone="America/Vancouver",
                **asdict(LEGAL_ADDRESSES[NORTHLIGHT]),
                gst_hst_number="781934625RT0001",
                pst_number="PST10427788",
                tax_registered=True,
                brand=brand.model_dump(exclude_none=True),
                booking_policy={
                    "approve_new_clients": True,
                    "lead_hours": 24,
                    "cancel_cutoff_hours": 48,
                    "reschedule_cutoff_hours": 48,
                },
                billing_email="hello@northlight.example",
                sms_number="+12505550998",
                # a fixture account, fully onboarded so its status agrees with the seeded payments
                stripe_account_id="acct_demo_northlight",
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
                trial_ends_at=founded + timedelta(days=14),
                subject="site",
                created_at=founded,
                updated_at=founded,
            ),
            File(
                id="fl_nl_logo",
                business_id=NORTHLIGHT,
                parent_type="business",
                parent_id=NORTHLIGHT,
                purpose="logo",
                s3_key=f"{NORTHLIGHT}/demo/nl_logo.png",
                content_type="image/png",
                size=(ASSETS / "nl_logo.png").stat().st_size,
                created_at=founded,
                updated_at=founded,
            ),
        )
        people = (
            (NORTHLIGHT_OWNER, BOSS, "owner", "Erik Lindqvist", "+12505550194"),
            ("us_nl_office", OFFICE, "office", "Naomi Clarke", "+12505550195"),
            ("us_nl_liam", LIAM, "liam", "Liam Doucette", "+12505550196"),
            ("us_nl_ava", AVA, "ava", "Ava Reyes", "+12505550197"),
        )
        for user_id, _staff, login, name, phone in people:
            email = f"{login}@northlight.example"
            ctx.add(
                User(
                    id=user_id,
                    identity_id=placeholder_identity(email),
                    email=email,
                    name=name,
                    phone=phone,
                    created_at=founded,
                    updated_at=founded,
                )
            )
        ctx.add(
            Staff(
                id=BOSS,
                business_id=NORTHLIGHT,
                user_id=NORTHLIGHT_OWNER,
                role="owner",
                payee=False,
                title="Owner, surveys and commercial installs",
                color="#1F2F4A",
                status="active",
                bookable_online=True,
            ),
            Staff(
                id=OFFICE,
                business_id=NORTHLIGHT,
                user_id="us_nl_office",
                role="admin",
                payee=False,
                title="Office manager",
                color="#6B7280",
                status="active",
                bookable_online=False,
            ),
            Staff(
                id=LIAM,
                business_id=NORTHLIGHT,
                user_id="us_nl_liam",
                role="staff",
                payee=True,
                rate_type="percent",
                rate_bps=4000,
                title="Installer",
                color="#2E7A5A",
                status="active",
                bookable_online=True,
            ),
            Staff(
                id=AVA,
                business_id=NORTHLIGHT,
                user_id="us_nl_ava",
                role="staff",
                payee=True,
                rate_type="hourly",
                rate_cents=3200,
                title="Installer",
                color="#A0703A",
                status="active",
                bookable_online=True,
            ),
        )
        for staff_id, days in HOURS.items():
            for weekday, (start, end) in days.items():
                ctx.add(
                    Hours(
                        id=f"av_{staff_id}_{weekday}",
                        business_id=NORTHLIGHT,
                        staff_id=staff_id,
                        basis="recurring",
                        weekday=weekday,
                        start_time=start,
                        end_time=end,
                        available=True,
                    )
                )
        for row in ctx.rows:
            if isinstance(row, TimestampMixin):
                row.created_at = row.created_at or founded
                row.updated_at = row.updated_at or founded

    def catalog(self) -> None:
        opened = self.at(-300)
        installs = [HOME, SHOP]
        for item_id, kind, name, price, minutes, category, description in ITEMS:
            stock = STOCK.get(item_id)
            item = Item(
                id=item_id,
                business_id=NORTHLIGHT,
                created_by=NORTHLIGHT_OWNER,
                kind=kind,
                name=name,
                description=description,
                price_cents=price,
                currency="CAD",
                tax_class="standard" if kind == "product" else "federal_only",
                duration_min=minutes,
                capacity=1 if kind == "service" else None,
                category=category,
                color=COLORS.get(item_id, "#5E7391"),
                online_bookable=item_id in {SURVEY, CALL, CHECK},
                sell_online=False,
                addon=kind == "product",
                addon_for=installs if kind == "product" else [],
                buffer_before_min=0,
                buffer_after_min=TRAVEL_MIN if kind == "service" else 0,
                deposit_type="percent" if item_id in {HOME, SHOP} else "none",
                deposit_value=25 if item_id in {HOME, SHOP} else None,
                interval=1 if kind == "subscription" else None,
                frequency=("year" if item_id == MAINTENANCE else "month")
                if kind == "subscription"
                else None,
                sku=stock[3] if stock else ("NL-CAT6-RUN" if item_id == CABLE else None),
                cost_cents=stock[2] if stock else (1800 if item_id == CABLE else None),
                track_stock=stock is not None,
                stock_on_hand=stock[0] if stock else None,
                low_stock_at=stock[1] if stock else None,
                active=True,
                created_at=opened,
                updated_at=opened,
            )
            self.items[item_id] = item
            self.ctx.add(item)

    def documents(self) -> None:
        ctx = self.ctx
        created = self.at(-290)
        ctx.add(
            Form(
                id=SURVEY_FORM,
                business_id=NORTHLIGHT,
                name="Site survey",
                require_signature=False,
                active=True,
                send_on="booking",
                created_at=created,
                updated_at=created,
            ),
            Form(
                id=HANDOVER_FORM,
                business_id=NORTHLIGHT,
                name="Installation handover",
                require_signature=True,
                active=True,
                send_on="manual",
                created_at=created,
                updated_at=created,
            ),
            Contract(
                id=AGREEMENT,
                business_id=NORTHLIGHT,
                name="Installation and service agreement",
                version=1,
                active=True,
                body=AGREEMENT_BODY,
                created_at=created,
                updated_at=created,
            ),
            Contract(
                id=NOTICE,
                business_id=NORTHLIGHT,
                name="Video surveillance notice",
                version=1,
                active=True,
                body=NOTICE_BODY,
                created_at=created,
                updated_at=created,
            ),
        )
        for position, (name, kind, label, required, options) in enumerate(SURVEY_FIELDS):
            ctx.add(
                FormField(
                    id=f"ff_nl_{name}",
                    business_id=NORTHLIGHT,
                    form_id=SURVEY_FORM,
                    name=name,
                    input=kind,
                    label=label,
                    required=required,
                    options=list(options),
                    position=position,
                    created_at=created,
                    updated_at=created,
                )
            )
        for position, (name, kind, label, required) in enumerate(HANDOVER_FIELDS):
            ctx.add(
                FormField(
                    id=f"ff_nl_handover_{name}",
                    business_id=NORTHLIGHT,
                    form_id=HANDOVER_FORM,
                    name=name,
                    input=kind,
                    label=label,
                    required=required,
                    options=[],
                    position=position,
                    created_at=created,
                    updated_at=created,
                )
            )

    def households(self) -> None:
        for home in (*HOMEOWNERS, *(_generated_household(i) for i in range(GENERATED))):
            self.client(home, tags=[])
        for shop in BUSINESSES:
            self.client(shop, tags=["commercial"])
        self.ctx.add(
            Subject(
                id="sj_nl_islandstorage_saanich",
                business_id=NORTHLIGHT,
                client_id="cl_nl_islandstorage",
                name=STORAGE_SAANICH.name,
                attributes=_site_attributes(STORAGE_SAANICH),
            )
        )
        self.ctx.get(Subject, "sj_nl_islandstorage").name = "Langford facility"

    def client(self, home: Household, *, tags: list[str]) -> None:
        name = home.address.split(",")[0]
        self.ctx.add(
            Client(
                id=f"cl_nl_{home.key}",
                business_id=NORTHLIGHT,
                created_by=NORTHLIGHT_OWNER,
                name=home.name,
                email=home.email,
                phone=home.phone,
                tags=tags,
                status="active",
                preferred_channel="email" if tags else "sms",
                custom_fields={"source": "referral" if len(home.key) % 3 == 0 else "google"},
            ),
            Subject(
                id=f"sj_nl_{home.key}",
                business_id=NORTHLIGHT,
                client_id=f"cl_nl_{home.key}",
                name=name,
                attributes=_site_attributes(home),
            ),
        )

    def joined(self, key: str, when: datetime) -> None:
        """Clients and their sites date from their first contact."""
        client = self.ctx.get(Client, f"cl_nl_{key}")
        client.created_at = min(client.created_at or when, when)
        client.updated_at = max(client.updated_at or when, when)
        for site in self.ctx.all(Subject):
            if site.client_id == client.id:
                site.created_at = min(site.created_at or when, when)
                site.updated_at = max(site.updated_at or when, when)

    def hours_on(self, staff: str, day: date) -> tuple[time, time] | None:
        return HOURS.get(staff, {}).get(day.weekday())

    def free(self, staff: str, site: str | None, start: datetime, end: datetime) -> bool:
        before, after = 0, TRAVEL_MIN
        return not any(
            (other == staff or (site is not None and other_site == site))
            and start - timedelta(minutes=before) < other_end + timedelta(minutes=other_after)
            and other_start - timedelta(minutes=other_before) < end + timedelta(minutes=after)
            for other, other_site, other_start, other_end, other_before, other_after in self.busy
        )

    def place(
        self,
        staff: str,
        item_id: str,
        day: int,
        site: str | None,
        *,
        past: bool,
        not_before: datetime | None = None,
        forward: bool = False,
    ) -> datetime | None:
        minutes = self.items[item_id].duration_min or 60
        step = -1 if past and not forward else 1
        for offset in range(60):
            current = day + step * offset
            if (past and current >= 0) or (not past and current <= 0):
                continue
            local = self.at(current).astimezone(BUSINESS_TIMEZONE)
            window = self.hours_on(staff, local.date())
            if window is None:
                continue
            starts = [
                local.replace(hour=h, minute=m)
                for h in range(window[0].hour, window[1].hour)
                for m in (0, 30)
            ]
            for start_local in starts:
                start = start_local.astimezone(UTC)
                end = start + timedelta(minutes=minutes)
                if end.astimezone(BUSINESS_TIMEZONE).time() > window[1] or (
                    end.astimezone(BUSINESS_TIMEZONE).date() != local.date()
                ):
                    break
                if start_local.time() < window[0]:
                    continue
                if not_before is not None and start < not_before:
                    continue
                if past and end >= self.now - timedelta(hours=1):
                    continue
                if not past and start <= self.now + timedelta(hours=1):
                    continue
                if self.free(staff, site, start, end):
                    return start
        return None

    def book(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        start: datetime,
        status: BookingStatus,
        created: datetime,
        *,
        site: str | None = None,
        source: Literal["online", "manual"] = "manual",
        price: int | None = None,
    ) -> Booking:
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        site_id = site or f"sj_nl_{client_key}"
        slot = Slot(
            id=f"ses_nl_{key}",
            business_id=NORTHLIGHT,
            item_id=item_id,
            staff_id=staff,
            starts_at=start,
            ends_at=end,
            capacity=1,
            status="completed"
            if status in {"completed", "no_show"}
            else "canceled"
            if status == "canceled"
            else "scheduled",
            created_at=created,
            updated_at=min(end, self.now),
        )
        deposit = deposit_cents(item) if price is None else 0
        booking = Booking(
            id=f"bk_nl_{key}",
            business_id=NORTHLIGHT,
            slot_id=slot.id,
            starts_at=start,
            staff_id=staff,
            client_id=f"cl_nl_{client_key}",
            subject_id=site_id,
            status=status,
            source=source,
            manage_token=f"manage_bk_nl_{key}" if source == "online" else None,
            price_cents=item.price_cents if price is None else price,
            deposit_amount_cents=deposit,
            deposit_status="pending" if deposit and status in {"pending", "confirmed"} else "none",
            confirmed_at=created + timedelta(hours=1)
            if status in {"confirmed", "completed", "no_show"}
            else None,
            completed_at=end if status == "completed" else None,
            canceled_at=min(start - timedelta(days=1), self.now - timedelta(hours=3))
            if status == "canceled"
            else None,
            created_at=created,
            updated_at=min(end, self.now),
        )
        self.ctx.add(slot, booking)
        if status != "canceled":
            self.busy.append((staff, site_id, start, end, 0, TRAVEL_MIN))
        self.joined(client_key, created - timedelta(hours=2))
        return booking

    def payment(
        self,
        client_key: str,
        paid_at: datetime,
        method: Literal["card", "etransfer", "cheque"],
        *,
        kind: Literal["payment", "deposit"] = "payment",
        invoice_id: str | None = None,
        booking_id: str | None = None,
        order_id: str | None = None,
        size: Literal["deposit", "balance", "total"] = "total",
    ) -> Payment:
        self.payment_number += 1
        number = self.payment_number
        payment = Payment(
            id=f"pay_nl_{number:04}",
            business_id=NORTHLIGHT,
            client_id=f"cl_nl_{client_key}",
            kind=kind,
            invoice_id=invoice_id,
            booking_id=booking_id,
            order_id=order_id,
            amount_cents=0,
            currency="CAD",
            method=method,
            provider="stripe" if method == "card" else "manual",
            provider_ref=f"pi_demo_nl_{number:04}" if method == "card" else None,
            reference=f"CA{number:04}NLET"
            if method == "etransfer"
            else f"Cheque {3100 + number}"
            if method == "cheque"
            else None,
            status="succeeded",
            paid_at=paid_at,
            created_at=paid_at - timedelta(minutes=5),
            updated_at=paid_at,
        )
        self.ctx.add(payment)
        self.sized.append((payment, size))
        return payment

    def lines(
        self,
        parent: Literal["invoice", "estimate", "order"],
        parent_id: str,
        quote: Quote,
        created: datetime,
        *,
        booking: Booking | None = None,
        optional: tuple[tuple[str | None, int, str, int], ...] = (),
    ) -> None:
        labour = self.items[quote.labour]
        specs: list[tuple[str | None, int, str, int, bool]] = [
            (
                labour.id,
                1,
                labour.name,
                booking.price_cents if booking else labour.price_cents,
                False,
            ),
            *(
                (part, qty, self.items[part].name, self.items[part].price_cents, False)
                for part, qty in quote.parts
            ),
            *((item_id, qty, name, price, True) for item_id, qty, name, price in optional),
        ]
        for position, (item_id, qty, name, price, extra) in enumerate(specs):
            self.ctx.add(
                Line(
                    id=f"ln_{parent_id}_{position}",
                    business_id=NORTHLIGHT,
                    invoice_id=parent_id if parent == "invoice" else None,
                    estimate_id=parent_id if parent == "estimate" else None,
                    order_id=parent_id if parent == "order" else None,
                    item_id=item_id,
                    booking_id=booking.id if booking is not None and position == 0 else None,
                    staff_id=booking.staff_id if booking is not None and position == 0 else None,
                    description=name,
                    quantity=qty,
                    unit_amount_cents=price,
                    amount_cents=price * qty,
                    tax_class=self.items[item_id].tax_class if item_id else "standard",
                    optional=extra,
                    selected=False,
                    position=position,
                    created_at=created,
                    updated_at=created,
                )
            )

    def estimate(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        created: datetime,
        *,
        status: Literal["draft", "sent", "accepted", "declined"],
        decided: datetime | None = None,
        note: str | None = None,
        optional: tuple[tuple[str | None, int, str, int], ...] = (),
    ) -> Estimate:
        self.estimate_number += 1
        estimate = Estimate(
            id=f"est_nl_{key}",
            business_id=NORTHLIGHT,
            client_id=f"cl_nl_{client_key}",
            number=self.estimate_number,
            status=status,
            valid_until=(created + timedelta(days=30)).astimezone(BUSINESS_TIMEZONE).date(),
            accepted_at=decided if status == "accepted" else None,
            declined_at=decided if status == "declined" else None,
            notes=note,
            view_token=None if status == "draft" else f"demo_estimate_est_nl_{key}",
            created_at=created,
            updated_at=decided or created,
        )
        self.ctx.add(estimate)
        self.lines("estimate", estimate.id, quote, created, optional=optional)
        return estimate

    def sign(
        self, key: str, client_key: str, contract_id: str, signed: datetime, site: str
    ) -> None:
        client = self.ctx.get(Client, f"cl_nl_{client_key}")
        body = AGREEMENT_BODY if contract_id == AGREEMENT else NOTICE_BODY
        self.ctx.add(
            Signature(
                id=f"sig_nl_{key}",
                business_id=NORTHLIGHT,
                contract_id=contract_id,
                client_id=client.id,
                parent_type="subject",
                parent_id=site,
                token=f"demo_signature_nl_{key}",
                status="signed",
                signed_at=signed,
                signed_body=body,
                contract_version=1,
                signer_name=client.name,
                method="typed",
                ip=f"192.0.2.{10 + len(key) * 3 % 200}",
                opened_at=signed - timedelta(minutes=12),
                created_at=signed - timedelta(minutes=30),
                updated_at=signed,
            )
        )

    def invoice(
        self, key: str, client_key: str, issued: datetime, created: datetime, note: str
    ) -> Invoice:
        self.invoice_number += 1
        invoice = Invoice(
            id=f"inv_nl_{key}",
            business_id=NORTHLIGHT,
            client_id=f"cl_nl_{client_key}",
            number=self.invoice_number,
            status="sent",
            currency="CAD",
            issued_at=issued,
            due_at=issued + timedelta(days=14),
            notes=note,
            pay_token=f"demo_pay_inv_nl_{key}",
            created_at=created,
            updated_at=issued,
        )
        self.ctx.add(invoice)
        return invoice

    def settle(self, invoice: Invoice, client_key: str, settle: Settle) -> None:
        issued = invoice.issued_at or self.now
        paid = {
            "card": issued + timedelta(hours=3),
            "etransfer": (issued + timedelta(days=1)).replace(minute=12),
            "cheque": issued + timedelta(days=4),
        }
        if settle in paid and paid[settle] < self.now - timedelta(hours=1):
            method: Literal["card", "etransfer", "cheque"] = (
                "card" if settle == "card" else "etransfer" if settle == "etransfer" else "cheque"
            )
            self.payment(client_key, paid[method], method, invoice_id=invoice.id, size="balance")
            return
        due = invoice.due_at or issued
        if settle == "overdue" and due + timedelta(days=1) < self.now:
            invoice.overdue_notified_at = due + timedelta(days=1)

    def equip(
        self,
        site_id: str,
        quote: Quote,
        installed: datetime,
        spots: tuple[str, ...],
        *,
        warranty_days: int = WARRANTY_DAYS,
    ) -> None:
        site = self.ctx.get(Subject, site_id)
        recorder = str(site.attributes.get("recorder_location") or "Network cabinet")
        day = installed.astimezone(BUSINESS_TIMEZONE).date()
        equipment = list(SiteAttributes.model_validate(site.attributes).equipment or [])
        cameras = len([e for e in equipment if e.location in spots])
        for part, qty in quote.parts:
            prefix = EQUIPMENT_PREFIX.get(part)
            if prefix is None:
                continue
            for _ in range(qty):
                self.serial += 1
                if part in {NVR8, NVR16, SWITCH}:
                    location = recorder
                elif part == DOORBELL:
                    location = "Front door"
                else:
                    location = spots[cameras % len(spots)]
                    cameras += 1
                equipment.append(
                    Equipment(
                        model=self.items[part].name,
                        serial=f"{prefix}-{day:%y%m}-{self.serial:05}",
                        location=location,
                        installed_on=day,
                        warranty_until=day + timedelta(days=warranty_days),
                    )
                )
        site.attributes = {
            **site.attributes,
            "equipment": [e.model_dump(mode="json", exclude_none=True) for e in equipment],
        }

    def line(self, invoice_id: str, item_id: str, created: datetime, position: int = 0) -> None:
        item = self.items[item_id]
        self.ctx.add(
            Line(
                id=f"ln_{invoice_id}_{position}",
                business_id=NORTHLIGHT,
                invoice_id=invoice_id,
                item_id=item.id,
                description=item.name,
                quantity=1,
                unit_amount_cents=item.price_cents,
                amount_cents=item.price_cents,
                tax_class=item.tax_class,
                position=position,
                created_at=created,
                updated_at=created,
            )
        )

    def addons(self, booking: Booking, quote: Quote) -> None:
        for index, (part, qty) in enumerate(quote.parts):
            item = self.items[part]
            self.ctx.add(
                Addon(
                    id=f"bka_{booking.id}_{index}",
                    business_id=NORTHLIGHT,
                    booking_id=booking.id,
                    staff_id=booking.staff_id,
                    item_id=item.id,
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                    created_at=booking.created_at,
                    updated_at=booking.created_at,
                )
            )

    def survey(
        self,
        key: str,
        client_key: str,
        day: int,
        *,
        staff: str = BOSS,
        status: BookingStatus = "completed",
        site: str | None = None,
        online: bool = False,
        lead_days: int = 6,
    ) -> Booking | None:
        site_id = site or f"sj_nl_{client_key}"
        past = status in {"completed", "no_show"}
        start = self.place(staff, SURVEY, day, site_id, past=past)
        if start is None:
            return None
        created = min(start - timedelta(days=lead_days), self.now - timedelta(hours=6))
        return self.book(
            f"{key}_survey",
            client_key,
            SURVEY,
            staff,
            start,
            status,
            created,
            site=site_id,
            source="online" if online else "manual",
        )

    def quoted(
        self, key: str, client_key: str, survey: Booking, quote: Quote, *, days: float = 2.1
    ) -> tuple[Estimate, datetime]:
        assert survey.completed_at is not None
        sent = survey.completed_at + timedelta(hours=20)
        accepted = sent + timedelta(days=days)
        estimate = self.estimate(
            key,
            client_key,
            quote,
            sent,
            status="accepted",
            decided=accepted,
            note="Equipment and labour as discussed on the survey.",
        )
        self.sign(
            key, client_key, AGREEMENT, accepted + timedelta(minutes=20), survey.subject_id or ""
        )
        return estimate, accepted + timedelta(minutes=40)

    def install(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        *,
        survey_day: int,
        install_day: int,
        installer: str,
        settle: Settle,
        surveyor: str = BOSS,
        site: str | None = None,
        spots: tuple[str, ...] = CAMERA_SPOTS,
        handover: bool = True,
        online: bool = False,
    ) -> Booking | None:
        site_id = site or f"sj_nl_{client_key}"
        survey = self.survey(
            key, client_key, survey_day, staff=surveyor, site=site_id, online=online
        )
        if survey is None:
            return None
        estimate, booked = self.quoted(key, client_key, survey, quote)
        earliest = booked + timedelta(days=2)
        start = self.place(
            installer, quote.labour, install_day, site_id, past=True, not_before=earliest
        ) or self.place(
            installer,
            quote.labour,
            install_day,
            site_id,
            past=True,
            not_before=earliest,
            forward=True,
        )
        if start is None:
            return None
        booking = self.book(
            key, client_key, quote.labour, installer, start, "completed", booked, site=site_id
        )
        assert booking.completed_at is not None
        if booking.deposit_amount_cents:
            self.payment(
                client_key,
                booked + timedelta(minutes=10),
                "card",
                kind="deposit",
                booking_id=booking.id,
                size="deposit",
            )
            booking.deposit_status = "collected"
        address = self.ctx.get(Subject, site_id).attributes.get("address", "")
        invoice = self.invoice(
            key,
            client_key,
            booking.completed_at + timedelta(minutes=30),
            booked,
            f"Install at {address}. Parts carry a two-year warranty from the install date.",
        )
        booking.invoice_id = estimate.converted_invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booked, booking=booking)
        self.settle(invoice, client_key, settle)
        self.equip(site_id, quote, start, spots)
        if handover:
            self.handover(key, booking, quote)
        return booking

    def visit(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        day: int,
        *,
        settle: Settle | None = "card",
        site: str | None = None,
        price: int | None = None,
        note: str | None = None,
        status: BookingStatus | None = None,
    ) -> Booking | None:
        past = day < 0
        site_id = site or f"sj_nl_{client_key}"
        start = self.place(staff, item_id, day, site_id, past=past)
        if start is None:
            return None
        created = min(start - timedelta(days=5), self.now - timedelta(hours=5))
        booking = self.book(
            key,
            client_key,
            item_id,
            staff,
            start,
            status or ("completed" if past else "confirmed"),
            created,
            site=site_id,
            price=price,
        )
        if note:
            self.note(booking.id, "booking", note, created)
        if past and settle is not None and booking.price_cents and booking.completed_at:
            invoice = self.invoice(
                key, client_key, booking.completed_at + timedelta(minutes=20), created, note or ""
            )
            address = self.ctx.get(Subject, site_id).attributes.get("address", "")
            invoice.notes = f"{self.items[item_id].name} at {address}."
            booking.invoice_id = invoice.id
            self.ctx.add(
                Line(
                    id=f"ln_{invoice.id}_0",
                    business_id=NORTHLIGHT,
                    invoice_id=invoice.id,
                    item_id=item_id,
                    booking_id=booking.id,
                    staff_id=staff,
                    description=self.items[item_id].name,
                    quantity=1,
                    unit_amount_cents=booking.price_cents,
                    amount_cents=booking.price_cents,
                    tax_class="federal_only",
                    position=0,
                    created_at=created,
                    updated_at=created,
                )
            )
            self.settle(invoice, client_key, settle)
        return booking

    def note(
        self,
        parent_id: str,
        parent: Literal["client", "subject", "booking"],
        body: str,
        when: datetime,
    ) -> None:
        count = len([n for n in self.ctx.all(Note) if n.parent_id == parent_id])
        self.ctx.add(
            Note(
                id=f"nt_{parent_id}_{count}",
                business_id=NORTHLIGHT,
                created_by=NORTHLIGHT_OWNER,
                parent_type=parent,
                parent_id=parent_id,
                body=body,
                created_at=when,
                updated_at=when,
            )
        )

    def handover(self, key: str, booking: Booking, quote: Quote) -> None:
        slot = self.ctx.get(Slot, booking.slot_id)
        client = self.ctx.get(Client, booking.client_id)
        site = self.ctx.get(Subject, booking.subject_id or "")
        cameras = sum(qty for part, qty in quote.parts if part in {TURRET, BULLET, DOORBELL, PTZ})
        day = slot.starts_at.astimezone(BUSINESS_TIMEZONE).date()
        recorder = site.attributes.get("recorder_location")
        locations = [
            f"{e.model} ({e.location})"
            for e in SiteAttributes.model_validate(site.attributes).equipment or []
            if e.installed_on == day and e.location != recorder
        ]
        submitted = slot.ends_at - timedelta(minutes=10)
        self.ctx.add(
            FormResponse(
                id=f"fr_nl_handover_{key}",
                business_id=NORTHLIGHT,
                form_id=HANDOVER_FORM,
                client_id=client.id,
                parent_type="booking",
                parent_id=booking.id,
                status="submitted",
                token=f"demo_handover_nl_{key}",
                opened_at=submitted - timedelta(minutes=8),
                submitted_at=submitted,
                answers={
                    "cameras_installed": cameras,
                    "camera_locations": "; ".join(locations),
                    "recorder_location": str(recorder or "Network cabinet"),
                    "app_setup": True,
                    "retention_explained": True,
                },
                signature={"name": client.name, "strokes": None, "ip": "192.0.2.80"},
                created_at=submitted - timedelta(minutes=20),
                updated_at=submitted,
            )
        )

    def card(self, client_key: str, when: datetime, brand: str, last4: str) -> PaymentMethod:
        found = next(
            (m for m in self.ctx.all(PaymentMethod) if m.id == f"pm_nl_{client_key}"), None
        )
        if found is not None:
            return found
        method = PaymentMethod(
            id=f"pm_nl_{client_key}",
            business_id=NORTHLIGHT,
            client_id=f"cl_nl_{client_key}",
            method="card",
            brand=brand,
            last4=last4,
            exp_month=1 + len(client_key) % 12,
            exp_year=2028 + len(client_key) % 3,
            holder_name=self.ctx.get(Client, f"cl_nl_{client_key}").name,
            provider_ref=f"pm_demo_nl_{client_key}",
            preferred=True,
            mandate_status="none",
            created_at=when,
            updated_at=when,
        )
        self.ctx.add(method)
        return method

    def subscribe(self, client_key: str, item_id: str, start: datetime) -> Subscription:
        """A plan billed by card on each period, recorded as a paid invoice the way renewals are."""
        brands = (("Visa", "4242"), ("Mastercard", "4444"), ("Visa", "1881"), ("Amex", "8431"))
        brand, last4 = brands[len(client_key) % len(brands)]
        method = self.card(client_key, start - timedelta(minutes=30), brand, last4)
        yearly = item_id == MAINTENANCE
        first = start.astimezone(BUSINESS_TIMEZONE).date()
        period = 0
        while True:
            day = _add_months(first, 12 * period if yearly else period)
            issued = datetime.combine(day, time(10, 0), BUSINESS_TIMEZONE).astimezone(UTC)
            if issued >= self.now - timedelta(hours=1):
                break
            if period == 0 and issued < start:
                issued = start + timedelta(minutes=5)
            following = _add_months(first, 12 * (period + 1) if yearly else period + 1)
            key = f"{'plan' if yearly else 'remote'}_{client_key}_{period:02}"
            invoice = self.invoice(
                key,
                client_key,
                issued,
                issued,
                f"{self.items[item_id].name}, {day.isoformat()} to {following.isoformat()}.",
            )
            self.line(invoice.id, item_id, issued)
            self.payment(client_key, issued + timedelta(minutes=2), "card", invoice_id=invoice.id)
            period += 1
        end = _add_months(first, 12 * period if yearly else period)
        subscription = Subscription(
            id=f"sub_nl_{'plan' if yearly else 'remote'}_{client_key}",
            business_id=NORTHLIGHT,
            client_id=f"cl_nl_{client_key}",
            item_id=item_id,
            status="active",
            current_period_end=datetime.combine(end, time(10, 0), BUSINESS_TIMEZONE).astimezone(
                UTC
            ),
            payment_method_id=method.id,
            provider_ref=f"sub_demo_nl_{'plan' if yearly else 'remote'}_{client_key}",
            created_at=start,
            updated_at=start,
        )
        self.ctx.add(subscription)
        return subscription

    def earlier_system(self, client_key: str, quote: Quote, days_ago: int) -> None:
        """Equipment installed before the seeded history, with the client dating from then."""
        when = self.at(-days_ago, 11)
        self.joined(client_key, when - timedelta(days=20))
        self.equip(f"sj_nl_{client_key}", quote, when, CAMERA_SPOTS)

    def today_jobs(self) -> tuple[Booking, Booking]:
        owen_quote = Quote(HOME, ((TURRET, 4), (DOORBELL, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        meilin_quote = Quote(HOME, ((TURRET, 3), (BULLET, 1), (NVR8, 1), (CABLE, 4), (JBOX, 3)))
        local = self.now.astimezone(BUSINESS_TIMEZONE)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        liam_start = (floor - timedelta(minutes=60)).astimezone(UTC)
        ava_start = (floor + timedelta(minutes=45)).astimezone(UTC)
        window = self.hours_on(LIAM, local.date())
        four = timedelta(hours=4)
        today = window is not None and all(
            start.astimezone(BUSINESS_TIMEZONE).time() >= window[0]
            and (start + four).astimezone(BUSINESS_TIMEZONE).time() <= window[1]
            and (start + four).astimezone(BUSINESS_TIMEZONE).date() == local.date()
            for start in (liam_start, ava_start)
        )
        jobs: list[Booking] = []
        for key, staff, quote, start, survey_day in (
            ("owen", LIAM, owen_quote, liam_start, -24),
            ("meilin", AVA, meilin_quote, ava_start, -21),
        ):
            survey = self.survey(key, key, survey_day)
            assert survey is not None
            _, booked = self.quoted(key, key, survey, quote)
            if not today:
                found = self.place(staff, HOME, 1, f"sj_nl_{key}", past=False)
                assert found is not None
                start = found
            booking = self.book(key, key, HOME, staff, start, "confirmed", booked)
            self.addons(booking, quote)
            self.payment(
                key,
                booked + timedelta(minutes=10),
                "card",
                kind="deposit",
                booking_id=booking.id,
                size="deposit",
            )
            booking.deposit_status = "collected"
            jobs.append(booking)
        owen, meilin = jobs
        if today:
            owen.departed_at = owen.starts_at - timedelta(minutes=25)
            owen.checked_in_at = owen.starts_at + timedelta(minutes=4)
            meilin.departed_at = self.now - timedelta(minutes=8)
        self.note(
            owen.id,
            "booking",
            "Side gate code 4471. Recorder goes on the garage shelf beside the panel. Owen wants "
            "the doorbell wired to the existing chime.",
            owen.created_at,
        )
        self.note(
            meilin.id,
            "booking",
            "Gate code 2208. Juniper (dog) is in the back yard, so use the front door and keep "
            "the side gate shut. Bullet camera goes over the garage facing the lane.",
            meilin.created_at,
        )
        return owen, meilin

    def storyline(self) -> None:
        ctx = self.ctx
        # a new lead: an online survey waiting for approval and a survey form with photos
        harper = self.survey("harper", "harper", 3, status="pending", online=True, lead_days=2)
        assert harper is not None
        self.survey_answers("harper", harper, photos=True)
        # survey done, estimate sent with optional extras
        rajesh = self.survey("rajesh", "rajesh", -6)
        assert rajesh is not None and rajesh.completed_at is not None
        self.estimate(
            "rajesh",
            "rajesh",
            Quote(HOME, ((TURRET, 4), (NVR8, 1), (CABLE, 4), (JBOX, 4))),
            rajesh.completed_at + timedelta(hours=18),
            status="sent",
            note="Four cameras covering the front, driveway, back yard and side path. The two "
            "extra cameras and the larger drive are optional.",
            optional=(
                (BULLET, 2, "4K bullet camera, back lane and carport", 27900),
                (None, 1, "Upgrade to a 4 TB drive (about 60 days of recording)", 14900),
            ),
        )
        sent = rajesh.completed_at + timedelta(hours=18, minutes=5)
        ctx.add(
            Signature(
                id="sig_nl_rajesh",
                business_id=NORTHLIGHT,
                contract_id=AGREEMENT,
                client_id="cl_nl_rajesh",
                parent_type="subject",
                parent_id="sj_nl_rajesh",
                token="demo_signature_nl_rajesh",
                status="pending",
                opened_at=min(sent + timedelta(hours=5), self.now - timedelta(hours=1)),
                created_at=sent,
                updated_at=sent,
            )
        )
        # accepted with a signed agreement and the install booked, deposit paid
        claire_quote = Quote(HOME, ((TURRET, 4), (BULLET, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        claire_survey = self.survey("claire", "claire", -16)
        assert claire_survey is not None
        _, booked = self.quoted("claire", "claire", claire_survey, claire_quote)
        start = self.place(LIAM, HOME, 6, "sj_nl_claire", past=False)
        assert start is not None
        claire = self.book("claire", "claire", HOME, LIAM, start, "confirmed", booked)
        self.addons(claire, claire_quote)
        self.payment(
            "claire",
            booked + timedelta(minutes=10),
            "card",
            kind="deposit",
            booking_id=claire.id,
            size="deposit",
        )
        claire.deposit_status = "collected"
        # accepted and waiting to be booked, for Book the install
        ruth_quote = Quote(HOME, ((TURRET, 2), (DOORBELL, 1), (NVR8, 1), (CABLE, 3), (JBOX, 2)))
        ruth_survey = self.survey("ruth", "ruth", -9)
        assert ruth_survey is not None
        self.quoted("ruth", "ruth", ruth_survey, ruth_quote, days=1.2)
        self.today_jobs()
        self.tap_to_pay()
        # a warranty call on a camera whose warranty is about to end, plus last spring's additions
        self.earlier_system("fiona", Quote(HOME, ((TURRET, 2), (NVR8, 1))), WARRANTY_DAYS - 45)
        self.install(
            "fiona",
            "fiona",
            Quote(HOME, ((DOORBELL, 1), (TURRET, 2), (CABLE, 3), (JBOX, 2))),
            survey_day=-198,
            install_day=-186,
            installer=LIAM,
            settle="card",
        )
        driveway = next(
            e
            for e in SiteAttributes.model_validate(
                ctx.get(Subject, "sj_nl_fiona").attributes
            ).equipment
            or []
            if e.location == "Driveway"
        )
        self.visit(
            "fiona_warranty",
            "fiona",
            CALL,
            AVA,
            2,
            price=0,
            note=f"Warranty: the driveway camera ({driveway.serial}) drops offline at night. "
            f"Warranty runs to {driveway.warranty_until}. Bring a spare turret camera.",
        )
        # a declined estimate and a cancelled survey
        gordon = self.survey("gordon", "gordon", -21)
        assert gordon is not None and gordon.completed_at is not None
        declined = self.estimate(
            "gordon",
            "gordon",
            Quote(HOME, ((TURRET, 4), (BULLET, 2), (NVR16, 1), (SWITCH, 1), (CABLE, 6), (JBOX, 4))),
            gordon.completed_at + timedelta(hours=20),
            status="declined",
            decided=gordon.completed_at + timedelta(days=6),
            note="Six cameras and a 16-channel recorder so the shop out back can be added later.",
        )
        declined.decline_reason = (
            "We're going with a video doorbell only for now and will look at the full system "
            "next year."
        )
        self.survey("natalie", "natalie", 4, status="canceled")
        self.note(
            "cl_nl_natalie",
            "client",
            "Cancelled the survey: her strata needs to approve cameras on the building first. "
            "Follow up in November.",
            self.now - timedelta(hours=4),
        )
        self.survey("victor", "victor", -12, status="no_show")
        jasmine = self.survey("jasmine", "jasmine", -1)
        assert jasmine is not None and jasmine.completed_at is not None
        self.estimate(
            "jasmine",
            "jasmine",
            Quote(HOME, ((TURRET, 3), (DOORBELL, 1), (NVR8, 1), (CABLE, 4), (JBOX, 3))),
            min(jasmine.completed_at + timedelta(hours=2), self.now - timedelta(minutes=30)),
            status="draft",
            note="Draft from yesterday's survey.",
        )
        simon_quote = Quote(
            HOME, ((TURRET, 3), (BULLET, 1), (DOORBELL, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4))
        )
        simon_survey = self.survey("simon", "simon", -18)
        assert simon_survey is not None
        _, booked = self.quoted("simon", "simon", simon_survey, simon_quote)
        start = self.place(AVA, HOME, 14, "sj_nl_simon", past=False)
        assert start is not None
        self.addons(self.book("simon", "simon", HOME, AVA, start, "confirmed", booked), simon_quote)
        diane = self.survey("diane", "diane", 5, online=True, status="confirmed", lead_days=4)
        assert diane is not None
        self.survey_draft("diane", diane)

    def tap_to_pay(self) -> None:
        quote = Quote(HOME, ((TURRET, 4), (DOORBELL, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        survey = self.survey("sarah", "sarah", -30, online=True)
        assert survey is not None
        _, booked = self.quoted("sarah", "sarah", survey, quote)
        start = self.place(LIAM, HOME, -9, "sj_nl_sarah", past=True)
        assert start is not None
        booking = self.book("sarah", "sarah", HOME, LIAM, start, "completed", booked)
        assert booking.completed_at is not None
        self.payment(
            "sarah",
            booked + timedelta(minutes=10),
            "card",
            kind="deposit",
            booking_id=booking.id,
            size="deposit",
        )
        paid = booking.completed_at + timedelta(minutes=15)
        order = Order(
            id="ord_nl_sarah",
            business_id=NORTHLIGHT,
            number=1,
            client_id="cl_nl_sarah",
            staff_id=LIAM,
            status="open",
            currency="CAD",
            source="pos",
            paid_at=paid,
            receipt_token="demo_receipt_ord_nl_sarah",
            receipt_channel="email",
            receipt_sent_at=paid + timedelta(minutes=1),
            created_at=booked,
            updated_at=paid,
        )
        self.ctx.add(order)
        self.lines("order", order.id, quote, booked, booking=booking)
        booking.order_id, booking.charged_at, booking.deposit_status = order.id, paid, "applied"
        self.payment("sarah", paid, "card", order_id=order.id, size="balance")
        self.equip("sj_nl_sarah", quote, start, CAMERA_SPOTS)
        self.handover("sarah", booking, quote)
        for index, (asset, caption) in enumerate(
            (
                ("nl_photo_before.png", "before"),
                ("nl_photo_after.png", "after"),
                ("nl_photo_recorder.png", "recorder"),
            )
        ):
            when = start + timedelta(minutes=10 if caption == "before" else 200 + index * 5)
            self.ctx.add(
                File(
                    id=f"fl_nl_sarah_{caption}",
                    business_id=NORTHLIGHT,
                    parent_type="booking",
                    parent_id=booking.id,
                    purpose="photo",
                    s3_key=f"{NORTHLIGHT}/demo/{asset}",
                    content_type="image/png",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=when,
                    updated_at=when,
                )
            )
        self.subscribe("sarah", REMOTE, booking.completed_at)

    def survey_draft(self, key: str, booking: Booking) -> None:
        """The survey form sent with a first booking, not yet filled in."""
        sent = booking.created_at + timedelta(minutes=5)
        self.ctx.add(
            FormResponse(
                id=f"fr_nl_survey_{key}",
                business_id=NORTHLIGHT,
                form_id=SURVEY_FORM,
                client_id=booking.client_id,
                parent_type="booking",
                parent_id=booking.id,
                status="draft",
                token=f"demo_survey_nl_{key}",
                answers={},
                created_at=sent,
                updated_at=sent,
            )
        )

    def survey_answers(self, key: str, booking: Booking, *, photos: bool) -> None:
        site = self.ctx.get(Subject, booking.subject_id or "")
        submitted = min(booking.created_at + timedelta(hours=20), self.now - timedelta(hours=2))
        response_id = f"fr_nl_survey_{key}"
        answers: dict[str, object] = {
            "building_type": str(site.attributes.get("building", "house")).capitalize(),
            "entrances": 3,
            "existing_wiring": "Not sure",
            "internet": str(site.attributes.get("internet") or "Telus fibre"),
            "goals": "The front door and driveway, and the side gate where parcels get left.",
        }
        if photos:
            for field, asset in (
                ("photo_front", "nl_survey_front.png"),
                ("photo_side", "nl_survey_side.png"),
            ):
                file_id = f"fl_nl_{key}_{field}"
                self.ctx.add(
                    File(
                        id=file_id,
                        business_id=NORTHLIGHT,
                        parent_type="form_response",
                        parent_id=response_id,
                        purpose="attachment",
                        s3_key=f"{NORTHLIGHT}/demo/{asset}",
                        content_type="image/png",
                        size=(ASSETS / asset).stat().st_size,
                        created_at=submitted - timedelta(minutes=6),
                        updated_at=submitted - timedelta(minutes=5),
                    )
                )
                answers[field] = file_id
        self.ctx.add(
            FormResponse(
                id=response_id,
                business_id=NORTHLIGHT,
                form_id=SURVEY_FORM,
                client_id=booking.client_id,
                parent_type="booking",
                parent_id=booking.id,
                status="submitted",
                token=f"demo_survey_nl_{key}",
                opened_at=submitted - timedelta(minutes=15),
                submitted_at=submitted,
                answers=answers,
                created_at=booking.created_at + timedelta(minutes=5),
                updated_at=submitted,
            )
        )

    def history(self) -> None:
        named: tuple[tuple[str, Quote, int, int, str, Settle], ...] = (
            ("tariq", HOME_QUOTES[0], -150, -138, LIAM, "card"),
            ("ingrid", HOME_QUOTES[3], -200, -188, AVA, "etransfer"),
            ("marco", HOME_QUOTES[1], -95, -84, LIAM, "card"),
            ("peter", HOME_QUOTES[2], -222, -210, AVA, "cheque"),
            ("rebecca", HOME_QUOTES[1], -122, -110, AVA, "etransfer"),
            ("colin", HOME_QUOTES[4], -14, -3, AVA, "open"),
            ("graham", HOME_QUOTES[3], -232, -219, LIAM, "cheque"),
            ("nora", HOME_QUOTES[0], -81, -70, LIAM, "card"),
            ("emily", HOME_QUOTES[2], -190, -178, AVA, "card"),
            ("kevin", HOME_QUOTES[0], -82, -71, AVA, "card"),
            ("patrick", HOME_QUOTES[1], -252, -240, LIAM, "card"),
        )
        for key, quote, survey_day, install_day, installer, settle in named:
            self.install(
                key,
                key,
                quote,
                survey_day=survey_day,
                install_day=install_day,
                installer=installer,
                settle=settle,
            )
        self.visit(
            "hana_doorbell",
            "hana",
            CALL,
            AVA,
            -60,
            price=self.items[CALL].price_cents,
            note="Doorbell swap on the strata's existing chime wiring.",
        )
        self.parts_on("hana_doorbell", Quote(CALL, ((DOORBELL, 1),)))
        self.visit(
            "peter_angle",
            "peter",
            CALL,
            LIAM,
            -40,
            note="Back yard camera angle moved after the new fence went in.",
        )
        commercial: tuple[tuple[str, str, Quote, int, int, Settle], ...] = (
            (
                "islandstorage",
                "sj_nl_islandstorage",
                Quote(
                    SHOP,
                    (
                        (PTZ, 1),
                        (BULLET, 4),
                        (TURRET, 4),
                        (NVR16, 1),
                        (SWITCH, 1),
                        (CABLE, 10),
                        (JBOX, 8),
                    ),
                ),
                -178,
                -165,
                "etransfer",
            ),
            (
                "islandstorage_saanich",
                "sj_nl_islandstorage_saanich",
                Quote(SHOP, ((BULLET, 3), (TURRET, 3), (NVR8, 1), (CABLE, 6), (JBOX, 6))),
                -72,
                -58,
                "overdue",
            ),
            (
                "cookdental",
                "sj_nl_cookdental",
                Quote(SHOP, ((TURRET, 6), (NVR8, 1), (SWITCH, 1), (CABLE, 6), (JBOX, 6))),
                -236,
                -222,
                "card",
            ),
            (
                "harbourbikes",
                "sj_nl_harbourbikes",
                Quote(SHOP, ((TURRET, 4), (BULLET, 2), (NVR8, 1), (CABLE, 6), (JBOX, 4))),
                -112,
                -98,
                "card",
            ),
            (
                "gorgeauto",
                "sj_nl_gorgeauto",
                Quote(SHOP, ((BULLET, 4), (TURRET, 2), (NVR8, 1), (CABLE, 6), (JBOX, 6))),
                -43,
                -29,
                "etransfer",
            ),
        )
        for key, site, quote, survey_day, install_day, settle in commercial:
            client_key = key.removesuffix("_saanich")
            booking = self.install(
                key,
                client_key,
                quote,
                survey_day=survey_day,
                install_day=install_day,
                installer=BOSS,
                settle=settle,
                site=site,
                spots=SHOP_SPOTS,
            )
            assert booking is not None
            if key == client_key:
                self.sign(
                    f"{key}_notice",
                    client_key,
                    NOTICE,
                    booking.created_at + timedelta(hours=2),
                    site,
                )
        for index in range(BOOKED.stop, GENERATED):
            key = f"home_{index:02}"
            survey_day = -262 + (index - BOOKED.stop) * 5 + self.rng.randint(0, 3)
            install_day = min(survey_day + self.rng.randint(8, 15), -2)
            booking = self.install(
                key,
                key,
                HOME_QUOTES[index % len(HOME_QUOTES)],
                survey_day=survey_day,
                install_day=install_day,
                installer=LIAM if index % 2 else AVA,
                surveyor=AVA if index % 4 == 0 else BOSS,
                settle=SETTLEMENTS[index % len(SETTLEMENTS)],
                online=index % 3 == 0,
            )
            if booking is None or booking.completed_at is None:
                continue
            installed = booking.completed_at
            if index % 4 == 1:
                self.subscribe(key, REMOTE, installed)
            if index % 9 == 4:
                self.subscribe(key, MAINTENANCE, installed + timedelta(days=1))
            if index % 6 == 5:
                day = int((installed - self.now).days) + 45
                if day < -2:
                    self.visit(
                        f"{key}_call",
                        key,
                        CALL,
                        AVA if index % 2 else LIAM,
                        day,
                        note="Camera picture went blurry after rain; resealed the lens cover.",
                    )

    def parts_on(self, key: str, quote: Quote) -> None:
        booking = self.ctx.get(Booking, f"bk_nl_{key}")
        if booking.invoice_id is None:
            return
        for position, (part, qty) in enumerate(quote.parts, start=1):
            item = self.items[part]
            self.ctx.add(
                Line(
                    id=f"ln_{booking.invoice_id}_{position}",
                    business_id=NORTHLIGHT,
                    invoice_id=booking.invoice_id,
                    item_id=item.id,
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                    amount_cents=item.price_cents * qty,
                    tax_class=item.tax_class,
                    position=position,
                    created_at=booking.created_at,
                    updated_at=booking.created_at,
                )
            )
        self.equip(booking.subject_id or "", quote, booking.starts_at, CAMERA_SPOTS)

    def upcoming(self) -> None:
        for offset, index in enumerate(LEADS):
            key = f"home_{index:02}"
            lead = self.survey(
                key,
                key,
                2 + offset * 4,
                staff=AVA if offset % 2 else BOSS,
                status="confirmed",
                online=True,
                lead_days=3 + offset,
            )
            assert lead is not None
            self.survey_draft(key, lead)
        for offset, index in enumerate(QUOTED):
            key = f"home_{index:02}"
            survey = self.survey(key, key, -8 + offset * 2)
            assert survey is not None and survey.completed_at is not None
            self.estimate(
                key,
                key,
                HOME_QUOTES[index % len(HOME_QUOTES)],
                survey.completed_at + timedelta(hours=20),
                status="sent",
                note="Equipment and labour as discussed on the survey.",
            )
        for offset, index in enumerate(BOOKED):
            key = f"home_{index:02}"
            quote = HOME_QUOTES[index % len(HOME_QUOTES)]
            survey = self.survey(key, key, -20 + offset * 3)
            assert survey is not None
            _, booked = self.quoted(key, key, survey, quote)
            staff = LIAM if offset % 2 else AVA
            start = self.place(staff, HOME, 3 + offset * 7, f"sj_nl_{key}", past=False)
            assert start is not None
            booking = self.book(key, key, HOME, staff, start, "confirmed", booked)
            self.addons(booking, quote)
            if offset != 2:
                self.payment(
                    key,
                    booked + timedelta(minutes=10),
                    "card",
                    kind="deposit",
                    booking_id=booking.id,
                    size="deposit",
                )
                booking.deposit_status = "collected"
        self.visit(
            "patrick_carport",
            "patrick",
            CALL,
            LIAM,
            6,
            note="Move the driveway camera so it covers the new carport.",
        )
        self.visit(
            "islandstorage_gate",
            "islandstorage",
            CALL,
            BOSS,
            10,
            site="sj_nl_islandstorage_saanich",
            note="Adjust the gate camera so plates are readable at night.",
        )

    def plans(self) -> None:
        # maintenance plans bought with systems installed a year ago, now due to renew
        for key, quote, days_ago in (
            ("joan", HOME_QUOTES[3], 361),
            ("arjun", HOME_QUOTES[0], 356),
            ("louise", HOME_QUOTES[4], 353),
            ("aisha", HOME_QUOTES[1], 340),
        ):
            self.earlier_system(key, quote, days_ago)
            self.subscribe(key, MAINTENANCE, self.at(-days_ago, 15))
        for key, staff, day in (("aisha", AVA, 8), ("joan", AVA, 13)):
            self.visit(
                f"{key}_check",
                key,
                CHECK,
                staff,
                day,
                price=0,
                note="Included in the maintenance plan.",
            )
        for key in ("tariq", "emily", "harbourbikes", "cookdental"):
            booking = self.ctx.get(Booking, f"bk_nl_{key}")
            if booking.completed_at is not None:
                self.subscribe(key, REMOTE, booking.completed_at)
        dental = self.ctx.get(Booking, "bk_nl_cookdental")
        if dental.completed_at is not None:
            self.subscribe("cookdental", MAINTENANCE, dental.completed_at + timedelta(days=1))

    def engagement(self) -> None:
        ctx = self.ctx
        for index, client in enumerate(sorted(ctx.all(Client), key=lambda c: c.id)):
            online = any(b.source == "online" for b in ctx.all(Booking) if b.client_id == client.id)
            for channel, wanted in (("email", index % 5 != 4), ("sms", index % 3 != 2)):
                if not wanted:
                    continue
                ctx.add(
                    Consent(
                        id=f"cns_{client.id}_{channel}",
                        business_id=NORTHLIGHT,
                        client_id=client.id,
                        channel=channel,
                        status="granted",
                        source="online_booking" if online else "in_person",
                        recorded_by=None if online else NORTHLIGHT_OWNER,
                        created_at=client.created_at,
                        updated_at=client.created_at,
                    )
                )
        withdrawn = self.now - timedelta(days=20)
        ctx.add(
            Consent(
                id="cns_cl_nl_kevin_email_withdrawn",
                business_id=NORTHLIGHT,
                client_id="cl_nl_kevin",
                channel="email",
                status="withdrawn",
                source="unsubscribe",
                created_at=withdrawn,
                updated_at=withdrawn,
            )
        )
        self.broadcast()
        self.conversations()
        self.review_requests()

    def thread(self, client_key: str, channel: Literal["sms", "email"], when: datetime) -> Thread:
        thread_id = f"th_nl_{client_key}_{channel}"
        found = next((t for t in self.ctx.all(Thread) if t.id == thread_id), None)
        if found is None:
            found = Thread(
                id=thread_id,
                business_id=NORTHLIGHT,
                client_id=f"cl_nl_{client_key}",
                channel=channel,
                status="open",
                created_at=when,
                updated_at=when,
            )
            self.ctx.add(found)
        found.created_at = min(found.created_at, when)
        found.updated_at = max(found.updated_at, when)
        return found

    def say(
        self,
        thread: Thread,
        body: str,
        when: datetime,
        *,
        sender: str | None = "us_nl_office",
        broadcast_id: str | None = None,
    ) -> None:
        index = len([m for m in self.ctx.all(Message) if m.thread_id == thread.id])
        incoming = sender is None
        self.ctx.add(
            Message(
                id=f"msg_{thread.id}_{index}",
                business_id=NORTHLIGHT,
                thread_id=thread.id,
                direction="in" if incoming else "out",
                channel=thread.channel,
                sent_by=sender,
                body=body,
                status="read" if incoming else "delivered",
                broadcast_id=broadcast_id,
                created_at=when,
                updated_at=when,
            )
        )
        thread.created_at = min(thread.created_at, when)
        thread.updated_at = max(thread.updated_at, when)

    def broadcast(self) -> None:
        ctx = self.ctx
        when = self.at(-185, 10)
        body = (
            "Spring is a good time to check your cameras. Wipe each lens with a soft cloth, trim "
            "plants that block a view, and open the app to confirm every camera shows a live "
            "picture. If a camera is offline or the picture looks wrong, reply to this email or "
            "book a service call online."
        )
        candidates = [c for c in ctx.all(Client) if c.created_at <= when and c.email]
        recipients: list[Client] = []
        for client in candidates:
            history = [
                c
                for c in ctx.all(Consent)
                if c.client_id == client.id and c.channel == "email" and c.created_at <= when
            ]
            consent = max(history, key=lambda c: (c.created_at, c.id), default=None)
            if allows_marketing(consent, when):
                recipients.append(client)
        ctx.add(
            Broadcast(
                id="bro_nl_spring",
                business_id=NORTHLIGHT,
                created_by=NORTHLIGHT_OWNER,
                name="Spring camera check",
                channel="email",
                body=body,
                audience={"all": True},
                status="sent",
                scheduled_at=when,
                recipient_count=len(recipients),
                excluded_count=len(candidates) - len(recipients),
                created_at=when - timedelta(days=1),
                updated_at=when,
            )
        )
        for index, client in enumerate(sorted(recipients, key=lambda c: c.id)):
            thread = self.thread(client.id.removeprefix("cl_nl_"), "email", when)
            self.say(
                thread,
                body,
                when + timedelta(seconds=index),
                sender=NORTHLIGHT_OWNER,
                broadcast_id="bro_nl_spring",
            )

    def conversations(self) -> None:
        ctx = self.ctx
        when = self.now - timedelta(hours=3)
        thread = self.thread("harper", "email", when)
        self.say(
            thread,
            "Hi, I booked a survey online. Do I need to be home for the whole visit? I also "
            "uploaded photos of the front and the side gate.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Harper. The survey takes about 45 minutes and we need someone home to walk "
            "the outside with us. The photos help, thank you. We'll confirm the time shortly.",
            when + timedelta(minutes=25),
        )
        rajesh = ctx.get(Estimate, "est_nl_rajesh")
        when = rajesh.created_at + timedelta(minutes=10)
        thread = self.thread("rajesh", "email", when)
        self.say(
            thread,
            "Hi Rajesh, your estimate is ready. The two extra cameras and the larger drive are "
            "optional, so you can add them or leave them out when you accept.",
            when,
            sender=NORTHLIGHT_OWNER,
        )
        self.say(
            thread,
            "Thanks. If we skip the extra cameras now, can they be added later?",
            min(when + timedelta(hours=5), self.now - timedelta(minutes=40)),
            sender=None,
        )
        self.say(
            thread,
            "Yes. The recorder has room for eight cameras, so we can add them on a service call.",
            min(when + timedelta(hours=6), self.now - timedelta(minutes=20)),
            sender=NORTHLIGHT_OWNER,
        )
        for key, staff_name, inbound in (
            (
                "owen",
                "Liam",
                "The side gate code is 4471. I'll leave the garage open for the recorder.",
            ),
            (
                "meilin",
                "Ava",
                "Thanks. Juniper will be in the back yard, so please use the front door. The gate "
                "code is 2208.",
            ),
        ):
            booking = ctx.get(Booking, f"bk_nl_{key}")
            when = min(booking.starts_at - timedelta(hours=20), self.now - timedelta(hours=2))
            local = booking.starts_at.astimezone(BUSINESS_TIMEZONE)
            thread = self.thread(key, "sms", when)
            self.say(
                thread,
                f"Hi {ctx.get(Client, booking.client_id).name.split()[0]}, {staff_name} from "
                f"Northlight is booked for your install on {local:%A, %B} {local.day} at "
                f"{local:%I:%M %p}. Reply here if anything has changed.".replace(" 0", " "),
                when,
            )
            self.say(thread, inbound, when + timedelta(minutes=30), sender=None)
        saanich = ctx.get(Invoice, "inv_nl_islandstorage_saanich")
        if saanich.overdue_notified_at is not None:
            when = saanich.overdue_notified_at + timedelta(hours=3)
            thread = self.thread("islandstorage", "email", when)
            self.say(
                thread,
                f"Hello, invoice {saanich.number} for the Saanich install is past due. You can pay "
                "by card from the link in the invoice email, or by e-Transfer to "
                "hello@northlight.example.",
                when,
            )
            self.say(
                thread,
                "Thanks for the reminder. Our bookkeeper is back on Monday and will send it then.",
                when + timedelta(hours=4),
                sender=None,
            )
        call = ctx.get(Booking, "bk_nl_fiona_warranty")
        when = min(call.created_at + timedelta(minutes=5), self.now - timedelta(hours=1))
        thread = self.thread("fiona", "sms", when - timedelta(hours=1))
        self.say(
            thread,
            "Hi, the camera over the driveway keeps going offline at night. Is it still under "
            "warranty?",
            when - timedelta(hours=1),
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Fiona. Yes, it's under warranty. Ava will come by to check the connection "
            "and replace the camera if needed. There's no charge for the visit.",
            when,
        )
        kevin = ctx.get(Booking, "bk_nl_kevin")
        when = kevin.starts_at + timedelta(minutes=50)
        thread = self.thread("kevin", "sms", when)
        self.say(thread, "Is someone still coming today? We were told 9 to 10.", when, sender=None)
        self.say(
            thread,
            "Sorry, Kevin. Ava's earlier job ran long. She's on her way now and should be there "
            "within the hour.",
            when + timedelta(minutes=6),
        )

    def review_requests(self) -> None:
        ctx = self.ctx
        keys = [
            "sarah",
            "ingrid",
            "marco",
            "rebecca",
            "nora",
            "kevin",
            "gorgeauto",
            "harbourbikes",
            "tariq",
            "colin",
            *(
                f"home_{index:02}"
                for index in range(BOOKED.stop, GENERATED, 5)
                if any(b.id == f"bk_nl_home_{index:02}" for b in ctx.all(Booking))
            ),
        ]
        for key in keys:
            booking = ctx.get(Booking, f"bk_nl_{key}")
            if booking.completed_at is None:
                continue
            requested = booking.completed_at + timedelta(hours=2)
            ctx.add(
                ReviewRequest(
                    id=f"rr_nl_{key}",
                    business_id=NORTHLIGHT,
                    client_id=booking.client_id,
                    booking_id=booking.id,
                    requested_at=requested,
                    created_at=requested,
                    updated_at=requested,
                )
            )

    def finish(self) -> None:
        ctx = self.ctx
        price_documents(ctx)
        parents: dict[str, Invoice | Order] = {
            **{i.id: i for i in ctx.all(Invoice)},
            **{o.id: o for o in ctx.all(Order)},
        }
        bookings = ctx.all(Booking)
        for payment, size in self.sized:
            if size == "deposit":
                payment.amount_cents = ctx.get(
                    Booking, payment.booking_id or ""
                ).deposit_amount_cents
                continue
            parent = parents[payment.invoice_id or payment.order_id or ""]
            held = sum(
                b.deposit_amount_cents
                for b in bookings
                if parent.id in {b.invoice_id, b.order_id} and b.deposit_status != "pending"
            )
            payment.amount_cents = parent.total_cents - (held if size == "balance" else 0)
        self.stock(parents)
        forms = {form.id: form for form in ctx.all(Form)}
        for response in ctx.all(FormResponse):
            response.definition = form_definition(
                forms[response.form_id],
                [f for f in ctx.all(FormField) if f.form_id == response.form_id],
                "reconstructed",
            )
        for file in ctx.all(File):
            file.uploaded_at = file.updated_at or file.created_at
        for row in ctx.rows:
            if isinstance(row, TimestampMixin):
                row.created_at = row.created_at or self.at(-300)
                row.updated_at = row.updated_at or row.created_at
        align_timestamps(ctx)
        ctx.add(
            Audit(
                id="aud_nl_demo_seed",
                business_id=NORTHLIGHT,
                performed_by=NORTHLIGHT_OWNER,
                action="demo.seed",
                entity_type="business",
                entity_id=NORTHLIGHT,
                changes={"as_of": self.now.isoformat()},
                created_at=self.now,
            )
        )

    def stock(self, parents: dict[str, Invoice | Order]) -> None:
        ctx = self.ctx
        paid = {
            p.invoice_id or p.order_id: p.paid_at
            for p in ctx.all(Payment)
            if p.kind == "payment" and (p.invoice_id or p.order_id) and p.paid_at
        }
        sold: dict[str, int] = {}
        for line in ctx.all(Line):
            parent_id = line.invoice_id or line.order_id
            if parent_id is None or parent_id not in paid or line.item_id not in STOCK:
                continue
            when = paid[parent_id]
            assert when is not None and parent_id in parents
            sold[line.item_id] = sold.get(line.item_id, 0) + int(line.quantity)
            ctx.add(
                StockMovement(
                    id=f"sm_sale_{line.id}",
                    business_id=NORTHLIGHT,
                    item_id=line.item_id,
                    line_id=line.id,
                    reason="sale",
                    quantity=-int(line.quantity),
                    created_by=NORTHLIGHT_OWNER,
                    created_at=when,
                    updated_at=when,
                )
            )
        for item_id, (on_hand, _low, cost, _sku) in STOCK.items():
            needed = on_hand + sold.get(item_id, 0)
            deliveries = (-300, -240, -180, -120, -60, -20)
            share = needed // len(deliveries)
            for index, day in enumerate(deliveries):
                quantity = share if index < len(deliveries) - 1 else needed - share * index
                if quantity <= 0:
                    continue
                when = self.at(day, 8)
                ctx.add(
                    StockMovement(
                        id=f"mv_{item_id}_{index}",
                        business_id=NORTHLIGHT,
                        item_id=item_id,
                        reason="restock",
                        quantity=quantity,
                        unit_cost_cents=cost,
                        note="Opening count" if index == 0 else "Supplier delivery",
                        created_by=NORTHLIGHT_OWNER,
                        created_at=when,
                        updated_at=when,
                    )
                )
            self.items[item_id].stock_on_hand = on_hand


def build_northlight(now: datetime) -> DemoContext:
    ctx = DemoContext(now, NORTHLIGHT, NORTHLIGHT_OWNER)
    Northlight(ctx).build()
    errors = validate_graph(ctx) + chronology_errors(ctx)
    if errors:
        raise ValueError("Invalid Northlight demo graph: " + "; ".join(errors[:20]))
    return ctx


async def seed_northlight_finance(db: AsyncSession, ctx: DemoContext) -> None:
    await post_invoices(db, ctx)
    await post_payments(db, ctx)
    for booking in sorted(ctx.all(Booking), key=lambda b: b.completed_at or ctx.now):
        if booking.deposit_status == "collected" and booking.invoice_id:
            await apply_deposit_at(db, booking, ctx.get(Invoice, booking.invoice_id))
    await seed_earnings(db, ctx)
    await seed_payouts(db, ctx, first_day=-266, failed_day=None)
