"""Northlight Security: a four-person camera installer in Victoria, built on the demo engine."""

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta

from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import Item, ItemKind
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import Signature
from clientbridge.models.platform import File
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
from clientbridge.schemas.subjects import Building, Equipment, SiteAttributes
from scripts.demo_context import demo_business
from scripts.demo_engine import ASSETS, Demo, Quote
from scripts.demo_spec import (
    BusinessSpec,
    ContractSpec,
    DocField,
    FormSpec,
    Offering,
    Person,
    Settle,
    Stage,
    Stock,
)

NORTHLIGHT = "bz_northlight"
NORTHLIGHT_OWNER = "us_nl_owner"

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
PLAN_AGREEMENT = "con_nl_maintenance"

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
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
# the agreement's version 2 took effect this many days ago; earlier clients signed version 1
AGREEMENT_REVISED = 120
AGREEMENT_V1 = (
    "Northlight Security will supply and install the equipment listed on your accepted "
    "estimate at the site named on it. A 25% deposit on the labour is due when you book the "
    "install and is applied to the final invoice. Equipment stays ours until the invoice is "
    "paid in full. Cameras, recorders and doorbells carry a two-year parts warranty from the "
    "install date, and our labour is covered for one year. The warranty does not cover damage "
    "from storms, power surges or changes made by others. You can move or cancel the install "
    "at no charge up to 48 hours before it starts."
)
AGREEMENT_BODY = "\n\n".join(
    (
        "This agreement covers the camera system Northlight Security installs at the site named "
        "on your accepted estimate. It is demo text for a fictional business, not legal advice.",
        "Scope of work\nWe supply and install the equipment and labour listed on the accepted "
        "estimate, set up the recorder and the viewing app, and show you how to use them. Work "
        "that isn't on the estimate, such as patching drywall, trenching or electrical work "
        "that needs a licensed electrician, is quoted separately before we do it.",
        "Equipment ownership\nThe equipment stays the property of Northlight Security until the "
        "final invoice is paid in full. After that it's yours, along with the recorder's admin "
        "password, which we hand over at the end of the install.",
        "Warranty\nCameras, recorders and doorbells carry a two-year parts warranty from the "
        "install date, and our labour is covered for one year. The warranty doesn't cover "
        "damage from storms, power surges, pests or changes made by someone else.",
        "Access to the property\nYou agree to give our installers safe access to the areas on "
        "the estimate, including the attic or crawl space where cable runs. Please tell us "
        "about pets, alarms and gate codes before the day. If we can't get in at the booked "
        "time, a return visit is charged at the service call rate.",
        "Privacy and recording\nYou decide where the cameras point, and we'll aim them at your "
        "own property. In British Columbia, a business that records customers or staff must "
        "follow the Personal Information Protection Act, which includes posting notice and "
        "limiting who can view footage. Cameras record video only; we don't enable audio, "
        "because recording conversations you aren't part of can be an offence under the "
        "Criminal Code.",
        "Payment schedule and deposit\nA deposit of 25% of the labour is due when you book "
        "the install and is applied to the final invoice. The rest is due within 14 days of "
        "the install by card, e-Transfer or cheque.",
        "Cancellation\nYou can move or cancel the install at no charge up to 48 hours before it "
        "starts. After that, the deposit covers the time we set aside, and special-order "
        "equipment can be returned only if the supplier accepts it.",
        "Liability\nA camera system records events; it doesn't prevent them, and it isn't a "
        "monitored alarm. We aren't responsible for losses from theft, break-ins or a "
        "recording that wasn't captured. Our liability for our own work is limited to the "
        "amount you paid us for it.",
    )
)
NOTICE_BODY = "\n\n".join(
    (
        "This notice covers the cameras Northlight Security installs at your business, and "
        "what you agree to do as the business that operates them. It is demo text for a "
        "fictional business, not legal advice.",
        "Signs\nYou'll post the signs we provide at each public entrance and in staff areas "
        "with cameras. Each sign says that the area is recorded, why, and who to contact with "
        "questions.",
        "Where cameras point\nCameras won't point into washrooms, change rooms or neighbouring "
        "private property. Cameras over a till or a safe show the counter, not keypads or "
        "screens.",
        "Purpose\nThe system is for the safety of staff and customers and the security of the "
        "premises. Under BC's Personal Information Protection Act, footage should be used only "
        "for that purpose, and staff should be told about the cameras before they're recorded.",
        "Retention\nRecordings are kept for 30 days and then overwritten, unless you save a "
        "clip for an incident. Saved clips should be deleted once the incident is resolved.",
        "Access to footage\nOnly the people you name can view footage. You're responsible for "
        "answering requests for footage from staff, customers or police, and for keeping a note "
        "of what you shared and with whom.",
        "Changes\nTell us if any of this changes, such as new staff areas or a different "
        "retention period, so we can update the recorder settings and the signs.",
    )
)
MAINTENANCE_BODY = "\n\n".join(
    (
        "This agreement covers the yearly maintenance plan for the camera system Northlight "
        "Security installed at your site. It is demo text for a fictional business, not legal "
        "advice.",
        "What's included\nOne system check visit each year: we clean every camera, check the "
        "angles and the night picture, test the recorder's drive, update the firmware and "
        "confirm recordings are kept for the period you chose.",
        "Repairs\nParts still under warranty are replaced at no charge. Labour on plan repairs "
        "is included; parts out of warranty are quoted before we replace them.",
        "Response times\nWe aim to call back within one business day and visit within three "
        "business days for a camera or recorder that has stopped working.",
        "Price and renewal\nThe plan is billed yearly to the card on file and renews on the "
        "same date each year. We'll email you 30 days before a renewal, and a change in price "
        "applies only from the next renewal.",
        "Cancelling\nYou can cancel at any time before the renewal date. A plan year that has "
        "started isn't refunded once its system check has been done.",
    )
)
SURVEY_FIELDS: tuple[DocField, ...] = (
    ("site_address", "address", "Site address", None, True, ()),
    ("site_contact", "text", "Who will meet us on site?", None, True, ()),
    ("site_phone", "phone", "Their phone number", None, True, ()),
    (
        "building_type",
        "select",
        "Building type",
        None,
        True,
        ("House", "Townhouse", "Apartment", "Retail", "Office", "Warehouse"),
    ),
    (
        "ownership",
        "select",
        "Do you own the building?",
        "Renters and strata owners usually need written permission to mount cameras outside.",
        True,
        (
            "I own it",
            "I rent, and the owner has agreed",
            "I rent, and still need to ask",
            "Strata or property manager approval needed",
        ),
    ),
    ("storeys", "number", "Storeys above ground", None, False, ()),
    ("entrances", "number", "How many doors lead outside?", None, True, ()),
    (
        "coverage",
        "multiselect",
        "What should the cameras cover?",
        None,
        True,
        (
            "Front door",
            "Driveway or parking",
            "Back yard",
            "Side path or gate",
            "Garage",
            "Shop floor or till",
            "Loading door",
        ),
    ),
    (
        "existing_wiring",
        "select",
        "Existing wiring",
        None,
        False,
        ("None", "Cable from an old system", "Network cable in most rooms", "Not sure"),
    ),
    (
        "internet",
        "text",
        "Internet provider and where the modem is",
        "The recorder connects to your modem for remote viewing.",
        False,
        (),
    ),
    (
        "recorder_location",
        "text",
        "Where should the recorder go?",
        "A closet or utility room with a power outlet works best.",
        False,
        (),
    ),
    (
        "lighting",
        "select",
        "Outdoor lighting at night",
        None,
        False,
        ("Lit all night", "Motion lights", "Mostly dark"),
    ),
    (
        "access_notes",
        "longtext",
        "Pets, alarms or gate codes",
        "We use access details only on the day of the visit.",
        False,
        (),
    ),
    ("preferred_date", "date", "Earliest install date that suits you", None, False, ()),
    ("budget", "currency", "Rough budget for equipment and install", None, False, ()),
    ("goals", "longtext", "Anything else we should know?", None, False, ()),
    ("photo_front", "image", "A photo of the front of the building", None, False, ()),
    ("photo_side", "image", "A photo of the side or back entrance", None, False, ()),
)
HANDOVER_FIELDS: tuple[DocField, ...] = (
    ("install_date", "date", "Install date", None, True, ()),
    ("cameras_installed", "number", "Cameras installed", None, True, ()),
    ("camera_locations", "longtext", "Where each camera is mounted", None, False, ()),
    ("recorder_location", "text", "Where the recorder is", None, False, ()),
    (
        "storage",
        "select",
        "Recording storage",
        "The installer sets how long recordings are kept before they're overwritten.",
        True,
        ("About 14 days", "About 30 days", "About 60 days"),
    ),
    ("app_setup", "checkbox", "The viewing app is set up on my phone", None, True, ()),
    (
        "viewers",
        "text",
        "Who else can view footage?",
        "Names of anyone else with an app login.",
        False,
        (),
    ),
    (
        "retention_explained",
        "checkbox",
        "I know how long recordings are kept and how to save a clip",
        None,
        True,
        (),
    ),
    (
        "password_received",
        "checkbox",
        "I've received the recorder's admin password",
        None,
        True,
        (),
    ),
    (
        "signs_posted",
        "checkbox",
        "Recording signs are posted at each public entrance",
        "For businesses only.",
        False,
        (),
    ),
    ("rating", "rating", "How was the install?", None, False, ()),
    ("follow_up", "longtext", "Anything we need to follow up on", None, False, ()),
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


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    install = item_id in {HOME, SHOP}
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="standard" if kind == "product" else "federal_only",
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=item_id in {SURVEY, CALL, CHECK},
        addon_for=(HOME, SHOP) if kind == "product" else (),
        buffer_after_min=TRAVEL_MIN if kind == "service" else 0,
        deposit_type="percent" if install else "none",
        deposit_value=25 if install else None,
        frequency=("year" if item_id == MAINTENANCE else "month")
        if kind == "subscription"
        else None,
        sku=stock[3] if stock else ("NL-CAT6-RUN" if item_id == CABLE else None),
        cost_cents=stock[2] if stock else (1800 if item_id == CABLE else None),
        stock=Stock(stock[0], stock[1]) if stock else None,
        ref={REMOTE: "remote", MAINTENANCE: "plan"}.get(item_id),
        contract=PLAN_AGREEMENT if item_id == MAINTENANCE else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(NORTHLIGHT),
    code="nl",
    slug="northlight",
    login_domain="northlight.example",
    owner=NORTHLIGHT_OWNER,
    people=(
        Person(
            NORTHLIGHT_OWNER,
            BOSS,
            "owner",
            "Erik Lindqvist",
            "+12505550194",
            "owner",
            "Owner, surveys and commercial installs",
            "#1F2F4A",
            HOURS[BOSS],
        ),
        Person(
            "us_nl_office",
            OFFICE,
            "office",
            "Naomi Clarke",
            "+12505550195",
            "admin",
            "Office manager",
            "#6B7280",
            bookable_online=False,
        ),
        Person(
            "us_nl_liam",
            LIAM,
            "liam",
            "Liam Doucette",
            "+12505550196",
            "staff",
            "Installer",
            "#2E7A5A",
            HOURS[LIAM],
            payee=True,
            rate_type="percent",
            rate_bps=4000,
        ),
        Person(
            "us_nl_ava",
            AVA,
            "ava",
            "Ava Reyes",
            "+12505550197",
            "staff",
            "Installer",
            "#A0703A",
            HOURS[AVA],
            payee=True,
            rate_type="hourly",
            rate_cents=3200,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
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
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "cancel_cutoff_hours": 48,
        "reschedule_cutoff_hours": 48,
    },
    subject="site",
    sms_number="+12505550998",
    gst_hst_number="781934625RT0001",
    pst_number="PST10427788",
    forms=(
        FormSpec(SURVEY_FORM, "Site survey", "ff_nl_", SURVEY_FIELDS, send_on="booking"),
        FormSpec(
            HANDOVER_FORM,
            "Installation handover",
            "ff_nl_handover_",
            HANDOVER_FIELDS,
            require_signature=True,
        ),
    ),
    contracts=(
        ContractSpec(
            AGREEMENT,
            "Installation and service agreement",
            AGREEMENT_BODY,
            version=2,
            earlier_body=AGREEMENT_V1,
            revised_day=-AGREEMENT_REVISED,
        ),
        ContractSpec(NOTICE, "Video surveillance notice", NOTICE_BODY),
        ContractSpec(
            PLAN_AGREEMENT, "Maintenance plan agreement", MAINTENANCE_BODY, created_day=-370
        ),
    ),
    storyline=(
        Stage("New lead, pending survey with a survey form", "harper", ("bk_nl_harper_survey",)),
        Stage("Estimate sent with optional lines", "rajesh", ("est_nl_rajesh",)),
        Stage("Accepted estimate ready for Book the install", "ruth", ("est_nl_ruth",)),
        Stage("Install booked from its estimate, deposit paid", "claire", ("bk_nl_claire",)),
        Stage("Today's install, on site", "owen", ("bk_nl_owen",)),
        Stage("Today's install, on the way", "meilin", ("bk_nl_meilin",)),
        Stage("Installed and paid by Tap to Pay", "sarah", ("bk_nl_sarah", "ord_nl_sarah")),
        Stage("Commercial client with two sites, overdue", "islandstorage"),
        Stage("Warranty call on a camera nearing its end date", "fiona", ("bk_nl_fiona_warranty",)),
        Stage("Declined estimate", "gordon", ("est_nl_gordon",)),
        Stage("Cancelled survey", "natalie", ("bk_nl_natalie_survey",)),
    ),
    photo_clients=(
        "aisha",
        "arjun",
        "claire",
        "diane",
        "hana",
        "harper",
        "jasmine",
        "joan",
        "louise",
        "meilin",
        "owen",
        "rajesh",
        "ruth",
        "sarah",
        "simon",
        *(f"home_{n:02}" for n in range(10)),
    ),
    inbox_user="us_nl_office",
)


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


class Northlight(Demo):
    spec = SPEC

    def __init__(self, now: datetime) -> None:
        super().__init__(now)
        self.serial = 1800

    def story(self) -> None:
        self.households()
        self.storyline()
        self.history()
        self.upcoming()
        self.plans()
        self.engagement()

    def visit_note(self, item: Item, booking: Booking) -> str:
        address = self.ctx.get(Subject, booking.subject_id or "").attributes.get("address", "")
        return f"{item.name} at {address}."

    def households(self) -> None:
        for home in (*HOMEOWNERS, *(_generated_household(i) for i in range(GENERATED))):
            self.household(home, tags=[])
        for shop in BUSINESSES:
            self.household(shop, tags=["commercial"])
        self.subject(
            "islandstorage_saanich",
            "islandstorage",
            STORAGE_SAANICH.name,
            _site_attributes(STORAGE_SAANICH),
        )
        self.ctx.get(Subject, "sj_nl_islandstorage").name = "Langford facility"
        self.photos()

    def household(self, home: Household, *, tags: list[str]) -> None:
        self.client(
            home.key,
            home.name,
            home.email,
            home.phone,
            tags=tags,
            channel="email" if tags else "sms",
            fields={"source": "referral" if len(home.key) % 3 == 0 else "google"},
            subject=home.address.split(",")[0],
            attributes=_site_attributes(home),
        )

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
        day = self.local(installed).date()
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
            subject=site_id,
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
            installer, quote.service, install_day, site_id, past=True, not_before=earliest
        ) or self.place(
            installer,
            quote.service,
            install_day,
            site_id,
            past=True,
            not_before=earliest,
            forward=True,
        )
        if start is None:
            return None
        booking = self.book(
            key, client_key, quote.service, installer, start, "completed", booked, subject=site_id
        )
        assert booking.completed_at is not None
        if booking.deposit_amount_cents:
            self.deposit(booking, booked + timedelta(minutes=10))
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

    def handover(self, key: str, booking: Booking, quote: Quote) -> None:
        slot = self.ctx.get(Slot, booking.slot_id)
        client = self.ctx.get(Client, booking.client_id)
        site = self.ctx.get(Subject, booking.subject_id or "")
        cameras = sum(qty for part, qty in quote.parts if part in {TURRET, BULLET, DOORBELL, PTZ})
        day = self.local(slot.starts_at).date()
        recorder = site.attributes.get("recorder_location")
        locations = [
            f"{e.model} ({e.location})"
            for e in SiteAttributes.model_validate(site.attributes).equipment or []
            if e.installed_on == day and e.location != recorder
        ]
        submitted = slot.ends_at - timedelta(minutes=10)
        commercial = "commercial" in (client.tags or [])
        self.response(
            "handover",
            key,
            HANDOVER_FORM,
            booking,
            {
                "install_date": day.isoformat(),
                "cameras_installed": cameras,
                "camera_locations": "; ".join(locations),
                "recorder_location": str(recorder or "Network cabinet"),
                "storage": "About 30 days",
                "app_setup": True,
                "retention_explained": True,
                "password_received": True,
                **({"signs_posted": True} if commercial else {}),
                "rating": 5 if len(key) % 3 else 4,
            },
            submitted,
            opened=submitted - timedelta(minutes=8),
            created=submitted - timedelta(minutes=20),
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.80"},
        )

    def earlier_system(self, client_key: str, quote: Quote, days_ago: int) -> None:
        """Equipment installed before the seeded history, with the client dating from then."""
        when = self.at(-days_ago, 11)
        self.joined(client_key, when - timedelta(days=20))
        self.equip(f"sj_nl_{client_key}", quote, when, CAMERA_SPOTS)

    def today_jobs(self) -> tuple[Booking, Booking]:
        owen_quote = Quote(HOME, ((TURRET, 4), (DOORBELL, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        meilin_quote = Quote(HOME, ((TURRET, 3), (BULLET, 1), (NVR8, 1), (CABLE, 4), (JBOX, 3)))
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        liam_start = (floor - timedelta(minutes=60)).astimezone(UTC)
        ava_start = (floor + timedelta(minutes=45)).astimezone(UTC)
        window = self.hours_on(LIAM, local.date())
        four = timedelta(hours=4)
        today = window is not None and all(
            self.local(start).time() >= window[0]
            and self.local(start + four).time() <= window[1]
            and self.local(start + four).date() == local.date()
            for start in (liam_start, ava_start)
        )
        jobs: list[Booking] = []
        for key, staff, quote, start, survey_day in (
            ("owen", LIAM, owen_quote, liam_start, -24),
            ("meilin", AVA, meilin_quote, ava_start, -21),
        ):
            survey = self.survey(key, key, survey_day)
            assert survey is not None
            estimate, booked = self.quoted(key, key, survey, quote)
            if not today:
                found = self.place(staff, HOME, 1, f"sj_nl_{key}", past=False)
                assert found is not None
                start = found
            booking = self.book(key, key, HOME, staff, start, "confirmed", booked)
            self.addons(booking, estimate, quote)
            self.deposit(booking, booked + timedelta(minutes=10))
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
                contract_version=2,
                opened_at=min(sent + timedelta(hours=5), self.now - timedelta(hours=1)),
                created_at=sent,
                updated_at=sent,
            )
        )
        # accepted with a signed agreement and the install booked, deposit paid
        claire_quote = Quote(HOME, ((TURRET, 4), (BULLET, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        claire_survey = self.survey("claire", "claire", -16)
        assert claire_survey is not None
        estimate, booked = self.quoted("claire", "claire", claire_survey, claire_quote)
        start = self.place(LIAM, HOME, 6, "sj_nl_claire", past=False)
        assert start is not None
        claire = self.book("claire", "claire", HOME, LIAM, start, "confirmed", booked)
        self.addons(claire, estimate, claire_quote)
        self.deposit(claire, booked + timedelta(minutes=10))
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
        estimate, booked = self.quoted("simon", "simon", simon_survey, simon_quote)
        start = self.place(AVA, HOME, 14, "sj_nl_simon", past=False)
        assert start is not None
        simon = self.book("simon", "simon", HOME, AVA, start, "confirmed", booked)
        self.addons(simon, estimate, simon_quote)
        diane = self.survey("diane", "diane", 5, online=True, status="confirmed", lead_days=4)
        assert diane is not None
        self.response("survey", "diane", SURVEY_FORM, diane, {}, None)

    def tap_to_pay(self) -> None:
        quote = Quote(HOME, ((TURRET, 4), (DOORBELL, 1), (NVR8, 1), (CABLE, 5), (JBOX, 4)))
        survey = self.survey("sarah", "sarah", -30, online=True)
        assert survey is not None
        estimate, booked = self.quoted("sarah", "sarah", survey, quote)
        start = self.place(LIAM, HOME, -9, "sj_nl_sarah", past=True)
        assert start is not None
        booking = self.book("sarah", "sarah", HOME, LIAM, start, "completed", booked)
        booking.estimate_id = estimate.id
        assert booking.completed_at is not None
        self.deposit(booking, booked + timedelta(minutes=10))
        paid = booking.completed_at + timedelta(minutes=15)
        self.sale("sarah", "sarah", LIAM, quote, booking, booked, paid)
        self.equip("sj_nl_sarah", quote, start, CAMERA_SPOTS)
        self.handover("sarah", booking, quote)
        for index, (asset, caption) in enumerate(
            (
                ("nl_photo_before.jpg", "before"),
                ("nl_photo_after.jpg", "after"),
                ("nl_photo_recorder.jpg", "recorder"),
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
                    content_type="image/jpeg",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=when,
                    updated_at=when,
                )
            )
        self.subscribe("sarah", REMOTE, booking.completed_at)

    def survey_answers(self, key: str, booking: Booking, *, photos: bool) -> None:
        site = self.ctx.get(Subject, booking.subject_id or "")
        submitted = min(booking.created_at + timedelta(hours=20), self.now - timedelta(hours=2))
        response_id = f"fr_nl_survey_{key}"
        client = self.ctx.get(Client, booking.client_id)
        answers: dict[str, object] = {
            "site_address": str(site.attributes.get("address", "")),
            "site_contact": client.name,
            "site_phone": client.phone or "+12505550198",
            "building_type": str(site.attributes.get("building", "house")).capitalize(),
            "ownership": "I own it",
            "storeys": 2,
            "entrances": 3,
            "coverage": ["Front door", "Driveway or parking", "Side path or gate"],
            "existing_wiring": "Not sure",
            "internet": str(site.attributes.get("internet") or "Telus fibre"),
            "lighting": "Motion lights",
            "access_notes": "A friendly dog at home; we'll put her in the back room for the visit.",
            "preferred_date": self.local(booking.starts_at + timedelta(days=10)).date().isoformat(),
            "budget": 2500,
            "goals": "The front door and driveway, and the side gate where parcels get left.",
        }
        if photos:
            for field, asset in (
                ("photo_front", "nl_survey_front.jpg"),
                ("photo_side", "nl_survey_side.jpg"),
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
                        content_type="image/jpeg",
                        size=(ASSETS / asset).stat().st_size,
                        created_at=submitted - timedelta(minutes=6),
                        updated_at=submitted - timedelta(minutes=5),
                    )
                )
                answers[field] = file_id
        self.response("survey", key, SURVEY_FORM, booking, answers, submitted)

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
            self.line(booking.invoice_id, part, booking.created_at, position, quantity=qty)
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
            self.response("survey", key, SURVEY_FORM, lead, {}, None)
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
            estimate, booked = self.quoted(key, key, survey, quote)
            staff = LIAM if offset % 2 else AVA
            start = self.place(staff, HOME, 3 + offset * 7, f"sj_nl_{key}", past=False)
            assert start is not None
            booking = self.book(key, key, HOME, staff, start, "confirmed", booked)
            self.addons(booking, estimate, quote)
            if offset != 2:
                self.deposit(booking, booked + timedelta(minutes=10))
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
            subject="sj_nl_islandstorage_saanich",
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
        # a plan offered after the install: one still unsigned, one turned down
        self.sign("kevin_plan", "kevin", PLAN_AGREEMENT, self.at(-3, 11), None, status="pending")
        self.sign("colin_plan", "colin", PLAN_AGREEMENT, self.at(-2, 15), None, status="declined")

    def engagement(self) -> None:
        self.consents()
        self.withdraw("kevin", "email", self.now - timedelta(days=20))
        self.broadcast(
            "spring",
            "Spring camera check",
            "Spring is a good time to check your cameras. Wipe each lens with a soft cloth, trim "
            "plants that block a view, and open the app to confirm every camera shows a live "
            "picture. If a camera is offline or the picture looks wrong, reply to this email or "
            "book a service call online.",
            self.at(-185, 10),
        )
        self.conversations()
        for key in (
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
                if any(b.id == f"bk_nl_home_{index:02}" for b in self.ctx.all(Booking))
            ),
        ):
            self.review(key)

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
            local = self.local(booking.starts_at)
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


EDITION = Northlight
