"""Clearcoat Mobile Detailing: a four-person mobile car detailer in Montreal, on the demo engine."""

import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.catalog import Item, ItemKind
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit, File
from clientbridge.models.scheduling import Addon, Booking, BookingStatus
from clientbridge.schemas.subjects import VehicleAttributes, VehicleSize
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

CLEARCOAT = "bz_clearcoat"
CLEARCOAT_OWNER = "us_ct_owner"

BOSS, DANIELA, OLIVIER, ANH = "st_ct_owner", "st_ct_daniela", "st_ct_olivier", "st_ct_anh"
WASH, INTERIOR, FULL, CORRECTION, CERAMIC, FLEET = (
    "it_ct_wash",
    "it_ct_interior",
    "it_ct_full",
    "it_ct_correction",
    "it_ct_ceramic",
    "it_ct_fleet",
)
PET_HAIR, ENGINE, HEADLIGHTS, ODOUR, LARGE = (
    "it_ct_pet_hair",
    "it_ct_engine",
    "it_ct_headlights",
    "it_ct_odour",
    "it_ct_large",
)
CLUB, THREE, SPRAY, TOWELS, GIFT = (
    "it_ct_club",
    "it_ct_three",
    "it_ct_spray",
    "it_ct_towels",
    "it_ct_gift",
)
VEHICLE_FORM, WALKAROUND_FORM, FEEDBACK_FORM = (
    "frm_ct_vehicle",
    "frm_ct_walkaround",
    "frm_ct_feedback",
)
AGREEMENT, CLUB_TERMS = "con_ct_agreement", "con_ct_club"
DETAILS = (WASH, INTERIOR, FULL, CORRECTION, CERAMIC)

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        WASH,
        "service",
        "Maintenance wash",
        9500,
        90,
        "Washes",
        "A two-bucket hand wash, wheels and tires, door jambs, outside glass, and a quick "
        "vacuum and wipe-down inside. We bring water and power, so the car only needs a spot "
        "with room to open every door.",
    ),
    (
        INTERIOR,
        "service",
        "Interior detail",
        19500,
        150,
        "Details",
        "Seats, carpets and mats vacuumed and shampooed, the dash, console and door panels "
        "cleaned and protected, and the inside glass streak-free. Add pet hair removal or an "
        "odour treatment if you need them.",
    ),
    (
        FULL,
        "service",
        "Full detail",
        29500,
        240,
        "Details",
        "The interior detail and a full exterior: hand wash, iron and tar removal, clay bar, "
        "and a spray sealant that lasts about three months.",
    ),
    (
        CORRECTION,
        "service",
        "Paint correction, one stage",
        54900,
        360,
        "Paint",
        "A machine polish that takes out most swirl marks and light scratches and brings back "
        "the gloss. Done by Mathieu or Daniela, indoors or in shade. A $100 deposit holds the "
        "date.",
    ),
    (
        CERAMIC,
        "service",
        "Ceramic coating",
        119900,
        480,
        "Paint",
        "A light polish and a ceramic coating rated for three years, on the paint, wheels and "
        "glass. Quoted from photos, done by Mathieu or Daniela in a garage, and held with a 25% "
        "deposit.",
    ),
    (
        FLEET,
        "service",
        "Fleet wash visit",
        39500,
        240,
        "Fleet",
        "A visit to your yard or lot to hand wash up to five work vans or cars, with a quick "
        "vacuum of each cab. Two detailers come together. Invoiced monthly, due in 14 days.",
    ),
    (
        PET_HAIR,
        "product",
        "Pet hair removal",
        4900,
        30,
        "Add-ons",
        "Embedded hair pulled out of carpets, seats and the cargo area with rubber brushes and "
        "a pet hair stone. Adds about 30 minutes.",
    ),
    (
        ENGINE,
        "product",
        "Engine bay clean",
        5900,
        45,
        "Add-ons",
        "Degreased, rinsed at low pressure with the electrics covered, and dressed. Adds about "
        "45 minutes.",
    ),
    (
        HEADLIGHTS,
        "product",
        "Headlight restoration",
        7900,
        45,
        "Add-ons",
        "Both lenses wet-sanded, polished and sealed with a UV coat, so yellowed or cloudy "
        "headlights are clear again. Adds about 45 minutes.",
    ),
    (
        ODOUR,
        "product",
        "Odour treatment",
        8900,
        60,
        "Add-ons",
        "Steam on the seats and vents, an enzyme cleaner and an hour of ozone for smoke, pet "
        "or food smells. Adds about an hour.",
    ),
    (
        LARGE,
        "product",
        "Large vehicle (SUV, truck or van)",
        4000,
        30,
        "Add-ons",
        "For a full-size SUV, a pickup truck or a minivan, which take longer to wash and "
        "detail. Adds about 30 minutes.",
    ),
    (
        CLUB,
        "subscription",
        "Monthly wash club",
        7900,
        None,
        "Plans",
        "One maintenance wash a month at your home or office, booked on the same week each "
        "month. Cancel any time before the next charge.",
    ),
    (
        THREE,
        "package",
        "Three maintenance washes",
        23900,
        None,
        "Packages",
        "Three maintenance washes for one vehicle, to use within six months. Save $46 over "
        "booking them one at a time.",
    ),
    (
        SPRAY,
        "product",
        "Spray detailer, 500 ml",
        2200,
        None,
        "Car care",
        "The quick detailer we use between washes: mist on a cool panel and buff off with a "
        "microfibre towel to lift dust and fingerprints.",
    ),
    (
        TOWELS,
        "product",
        "Microfibre towels, pack of 6",
        2400,
        None,
        "Car care",
        "Edgeless 40 x 40 cm towels for paint and glass. Wash them on their own, without "
        "fabric softener.",
    ),
    (
        GIFT,
        "gift",
        "Gift card",
        0,
        None,
        "Gift cards",
        "A gift card for any wash, detail or add-on, emailed with your note. It doesn't expire.",
    ),
)
COLORS = {
    WASH: "#2F7FA8",
    INTERIOR: "#5B6C8F",
    FULL: "#1F4E6B",
    CORRECTION: "#8A5A2B",
    CERAMIC: "#6B3F7A",
    FLEET: "#3F7A5A",
}
# on hand today, low-stock line, unit cost, SKU
STOCK: dict[str, tuple[int, int, int, str]] = {
    SPRAY: (14, 6, 780, "CT-CARE-QD500"),
    TOWELS: (4, 5, 950, "CT-CARE-MF6"),
}
ADDONS: dict[str, tuple[tuple[str, ...], str]] = {
    PET_HAIR: ((INTERIOR, FULL), "CT-ADD-PET"),
    ENGINE: ((WASH, FULL, CORRECTION, CERAMIC), "CT-ADD-ENGINE"),
    HEADLIGHTS: ((WASH, FULL, CORRECTION, CERAMIC), "CT-ADD-LIGHTS"),
    ODOUR: ((INTERIOR, FULL), "CT-ADD-ODOUR"),
    LARGE: ((WASH, INTERIOR, FULL), "CT-ADD-LARGE"),
}
PAINT_CREW = (BOSS, DANIELA)
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {d: (time(8, 0), time(17, 0)) for d in range(5)},
    DANIELA: {d: (time(8, 0), time(17, 0)) for d in range(1, 6)},
    OLIVIER: {d: (time(8, 0), time(16, 30)) for d in range(5)},
    ANH: {d: (time(9, 0), time(17, 0)) for d in (2, 3, 4, 5, 6)},
}
TRAVEL_MIN = 30
LATE_FEE = 4000
AGREEMENT_BODY = "\n\n".join(
    (
        "This agreement covers the washes and details Clearcoat Mobile Detailing does at the "
        "address on your booking. It is demo text for a fictional business, not legal advice.",
        "Where we work\nWe need a spot with about a metre of room on every side of the car, "
        "such as a driveway, a street space, an office lot or a condo garage. In a building "
        "garage, please get the building's permission and leave us the visitor fob or code. "
        "We bring our own water, power and products.",
        "Weather\nWe don't wash outdoors in rain or below 5 °C. If the forecast turns, we'll "
        "text you to move the visit to the next dry day, or to a garage if you have one.",
        "Before we start\nWe walk around the car with you or on our own and note scratches, "
        "chips and dents on the walkaround form, with photos. Paint correction removes most "
        "swirl marks, but scratches deep enough to catch a fingernail stay.",
        "Your belongings\nPlease take valuables, child seats and anything you need out of the "
        "car. We bag loose items and leave them on the passenger seat.",
        "Moving or cancelling\nYou can move or cancel a visit at no charge up to 24 hours "
        "before it starts. A later cancellation, or a visit where the car isn't there, carries "
        "a $40 fee for the time we set aside.",
        "Payment\nWe charge the card on file when we finish, or you can pay by Tap to Pay on "
        "the detailer's phone or by e-Transfer within 7 days. Fleet visits are invoiced and due "
        "in 14 days. Tips are optional and go in full to your detailer.",
    )
)
CLUB_BODY = "\n\n".join(
    (
        "These terms cover the Monthly wash club from Clearcoat Mobile Detailing. They are demo "
        "text for a fictional business, not legal advice.",
        "What's included\nOne maintenance wash a month for the vehicle named on your plan, at "
        "your home or office. We book it on the same week each month and text you the day "
        "before.",
        "Charges\nThe plan is charged on the same date each month to the card on file, with "
        "GST and QST. The first charge is on the day you join.",
        "Missed washes\nA wash we move for weather is made up within the month. Washes don't "
        "carry over to the next month.",
        "Cancelling\nYou can cancel any time before the next charge. The month you've paid for "
        "still includes its wash.",
    )
)
VEHICLE_FIELDS: tuple[DocField, ...] = (
    ("vehicle", "text", "Year, make and model", None, True, ()),
    ("colour", "text", "Colour", None, False, ()),
    (
        "size",
        "select",
        "Size",
        None,
        True,
        ("Compact or small car", "Sedan", "SUV or crossover", "Pickup truck", "Van or minivan"),
    ),
    ("address", "address", "Where will the car be parked?", None, True, ()),
    (
        "parking",
        "select",
        "Type of spot",
        None,
        True,
        ("Driveway", "Street", "Underground or indoor garage", "Outdoor lot at work"),
    ),
    (
        "parking_details",
        "longtext",
        "Parking details",
        "Stall number, visitor fob, gate code or where to find the car. We use them only on the "
        "day of the visit.",
        False,
        (),
    ),
    (
        "concerns",
        "multiselect",
        "Anything we should know?",
        None,
        False,
        (
            "Pet hair",
            "Stains on the seats",
            "Smells",
            "Swirl marks or scratches",
            "Road salt",
            "Cloudy headlights",
        ),
    ),
    ("notes", "longtext", "Other notes", None, False, ()),
    ("photo_interior", "image", "A photo of the inside", None, False, ()),
    ("photo_paint", "image", "A photo of the paint", None, False, ()),
)
WALKAROUND_FIELDS: tuple[DocField, ...] = (
    ("visit_date", "date", "Visit date", None, True, ()),
    (
        "existing",
        "multiselect",
        "Existing damage noted",
        None,
        False,
        (
            "Scratches",
            "Stone chips",
            "Dents",
            "Curb rash on wheels",
            "Cracked windshield",
            "Worn or torn upholstery",
        ),
    ),
    ("details", "longtext", "Where, and anything else", None, False, ()),
    ("valuables", "checkbox", "Valuables and child seats are out of the car", None, True, ()),
    ("key", "text", "Where the key is", None, False, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your detail?", None, True, ()),
    (
        "highlights",
        "multiselect",
        "What went well?",
        None,
        False,
        ("Paint and wheels", "Interior", "Glass", "On time", "Communication", "Care with the car"),
    ),
    ("comments", "longtext", "Anything we could do better?", None, False, ()),
    ("follow_up", "checkbox", "You can contact me about this", None, False, ()),
)


@dataclass(frozen=True)
class Car:
    year: int
    make: str
    model: str
    colour: str
    plate: str
    size: VehicleSize
    address: str
    parking: str
    notes: str | None = None

    @property
    def name(self) -> str:
        return f"{self.year} {self.make} {self.model}"


@dataclass(frozen=True)
class Owner:
    key: str
    name: str
    cars: tuple[Car, ...]
    email: str | None = None


NAMED = (
    Owner(
        "emilie",
        "Émilie Lavoie",
        (
            Car(
                2018,
                "Subaru",
                "Outback",
                "Wilderness green",
                "K47 LMR",
                "suv",
                "4326 Rue de Bordeaux, Montréal, QC H2H 1Z5",
                "Street parking in front of the house, permit zone 41.",
                "Golden retriever, Biscuit; most of the hair is in the cargo area.",
            ),
        ),
    ),
    Owner(
        "raj",
        "Raj Malhotra",
        (
            Car(
                2023,
                "Mazda",
                "CX-50",
                "Jet black",
                "R82 TNA",
                "suv",
                "1840 Chemin Lucerne, Mont-Royal, QC H3R 2J3",
                "Two-car garage; the left bay is free. Outlet by the garage door.",
            ),
        ),
    ),
    Owner(
        "nadia",
        "Nadia Benali",
        (
            Car(
                2017,
                "Honda",
                "Civic",
                "Cosmic blue",
                "G15 HXK",
                "sedan",
                "Unit 1204, 1450 Boulevard René-Lévesque Ouest, Montréal, QC H3G 0E2",
                "Underground garage, level P2, stall 84. Visitor fob from the concierge. No water "
                "hookup, so we bring the tank.",
            ),
        ),
    ),
    Owner(
        "julie",
        "Julie Tremblay",
        (
            Car(
                2020,
                "Toyota",
                "RAV4",
                "Super white",
                "F63 BRW",
                "suv",
                "6215 Avenue de Lorimier, Montréal, QC H2G 2P1",
                "Driveway beside the house. Outdoor tap at the back corner.",
                "Two car seats in the back; Julie takes them out the night before.",
            ),
        ),
    ),
    Owner(
        "thomas",
        "Thomas Girard",
        (
            Car(
                2019,
                "Ford",
                "F-150",
                "Magnetic grey",
                "L29 PQS",
                "truck",
                "11840 Rue Lachapelle, Montréal, QC H4J 2L5",
                "Long driveway; park the van behind the truck.",
                "Crew cab with a tonneau cover. Bed liner doesn't need dressing.",
            ),
        ),
    ),
    Owner(
        "samira",
        "Samira Khoury",
        (
            Car(
                2021,
                "Hyundai",
                "Kona",
                "Pulse red",
                "B74 DMJ",
                "compact",
                "7450 Rue Saint-Denis, Montréal, QC H2R 2E5",
                "Street parking out front; Samira moves the car to the corner spot if it's free.",
            ),
        ),
    ),
    Owner(
        "marieclaude",
        "Marie-Claude Pelletier",
        (
            Car(
                2022,
                "Volkswagen",
                "Tiguan",
                "Pyrite silver",
                "C38 WKF",
                "suv",
                "28 Avenue Cedar, Pointe-Claire, QC H9S 4Y1",
                "Driveway. Outdoor tap and outlet by the side door.",
            ),
        ),
    ),
    Owner(
        "david",
        "David Cohen",
        (
            Car(
                2020,
                "Subaru",
                "Forester",
                "Horizon blue",
                "M51 ZTR",
                "suv",
                "5620 Avenue Westbury, Montréal, QC H3W 2W9",
                "Driveway; the Forester is the car closer to the street.",
                "Ski rack on the roof in winter.",
            ),
            Car(
                2016,
                "Mazda",
                "Mazda3",
                "Snowflake white",
                "J86 ECV",
                "sedan",
                "5620 Avenue Westbury, Montréal, QC H3W 2W9",
                "Driveway, behind the Forester. Rachel's car.",
            ),
        ),
    ),
    Owner(
        "lucas",
        "Lucas Moreau",
        (
            Car(
                2015,
                "Volkswagen",
                "Golf GTI",
                "Deep black",
                "H40 NGS",
                "compact",
                "2350 Rue Wellington, Montréal, QC H3K 1X2",
                "Street parking on Wellington; Lucas texts the spot when he's parked.",
            ),
        ),
    ),
    Owner(
        "fatou",
        "Fatou Diallo",
        (
            Car(
                2019,
                "Honda",
                "Odyssey",
                "Modern steel",
                "D97 KLA",
                "van",
                "8940 Boulevard Lacordaire, Montréal, QC H1R 2B2",
                "Driveway. Outlet in the garage.",
                "Three rows of seats; the third row folds into the floor.",
            ),
        ),
    ),
    Owner(
        "mei",
        "Mei Chen",
        (
            Car(
                2021,
                "Toyota",
                "Corolla",
                "Classic silver",
                "N23 VBH",
                "sedan",
                "Unit 310, 1000 Rue Ottawa, Montréal, QC H3C 1S1",
                "Underground garage, level P1, stall 112. Buzz 310 for the garage door.",
            ),
        ),
    ),
    Owner(
        "sophie",
        "Sophie Bergeron",
        (
            Car(
                2018,
                "Kia",
                "Soul",
                "Clear white",
                "P58 RDT",
                "compact",
                "3725 Rue Ontario Est, Montréal, QC H1W 1R9",
                "Street parking out front.",
            ),
        ),
    ),
    Owner(
        "gilles",
        "Gilles Bergeron",
        (
            Car(
                2016,
                "Toyota",
                "Camry",
                "Ruby red",
                "S19 LMQ",
                "sedan",
                "1255 Rue Sauvé Est, Montréal, QC H2C 1Z9",
                "Driveway. Gilles is home and has a tap by the steps.",
            ),
        ),
    ),
    Owner(
        "isabelle",
        "Isabelle Fortin",
        (
            Car(
                2020,
                "Honda",
                "CR-V",
                "Aegean blue",
                "T64 HWB",
                "suv",
                "4770 Rue Saint-Zotique Est, Montréal, QC H1T 1P2",
                "Driveway shared with the neighbour; the CR-V is on the left.",
            ),
        ),
    ),
    Owner(
        "karim",
        "Karim Mansour",
        (
            Car(
                2019,
                "Nissan",
                "Rogue",
                "Magnetic black",
                "V35 GKP",
                "suv",
                "Lot C, 9800 Boulevard Cavendish, Montréal, QC H4M 2X9",
                "His office lot, row C near the side entrance. Outlet on the light post.",
            ),
        ),
    ),
    Owner(
        "patrick",
        "Patrick O'Neill",
        (
            Car(
                2017,
                "Jeep",
                "Grand Cherokee",
                "Granite grey",
                "W72 FNJ",
                "suv",
                "51 Avenue Thornhill, Westmount, QC H3Y 2E2",
                "Steep driveway; park at the top by the garage.",
            ),
        ),
    ),
    Owner(
        "elena",
        "Elena Popescu",
        (
            Car(
                2020,
                "Volvo",
                "XC60",
                "Crystal white",
                "A88 SKT",
                "suv",
                "175 Rue Elm, Beaconsfield, QC H9W 2E3",
                "Heated double garage; we work inside with the door open.",
                "Ceramic coated in the summer. Wash with the pH-neutral soap only.",
            ),
        ),
    ),
    Owner(
        "jf",
        "Jean-François Côté",
        (
            Car(
                2022,
                "Subaru",
                "WRX",
                "Solar orange",
                "E41 MZP",
                "sedan",
                "1355 Rue Bélanger, Montréal, QC H2G 1A5",
                "Lane behind the triplex, spot 2.",
            ),
        ),
    ),
    Owner(
        "simon",
        "Simon Gauthier",
        (
            Car(
                2018,
                "Dodge",
                "Grand Caravan",
                "Granite crystal",
                "Y26 TRC",
                "van",
                "2915 Rue Masson, Montréal, QC H1Y 1W9",
                "Street parking on Masson; loading zone free before 9.",
                "Bought used from a smoker.",
            ),
        ),
    ),
    Owner(
        "jason",
        "Jason Wright",
        (
            Car(
                2016,
                "Honda",
                "Accord",
                "Crystal black",
                "U53 PLW",
                "sedan",
                "4880 Avenue Grosvenor, Montréal, QC H3W 2L9",
                "Driveway.",
            ),
        ),
    ),
)
ROSEMONT = Owner(
    "rosemont",
    "Plomberie Rosemont",
    tuple(
        Car(
            year,
            make,
            model,
            "White",
            plate,
            "van",
            "5530 Boulevard Saint-Michel, Montréal, QC H1Y 2C9",
            "Fenced yard behind the shop, gate code 4410. Tap on the east wall of the shop.",
            f"Van {number} of 4.",
        )
        for number, (year, make, model, plate) in enumerate(
            (
                (2021, "Ford", "Transit Connect", "FAB 2417"),
                (2021, "Ford", "Transit Connect", "FAB 2418"),
                (2019, "Ram", "ProMaster", "FAC 0952"),
                (2023, "Ram", "ProMaster", "FAD 6630"),
            ),
            start=1,
        )
    ),
    email="bureau.plomberierosemont@example.test",
)
PEOPLE = (
    ("Alexandre", "Gagnon"),
    ("Camille", "Leblanc"),
    ("Nicolas", "Morin"),
    ("Ana", "Silva"),
    ("Youssef", "El Amrani"),
    ("Léa", "Ouellet"),
    ("Hugo", "Lefebvre"),
    ("Maxime", "Lapointe"),
    ("Sarah", "Lévesque"),
    ("Vincent", "Caron"),
    ("Amélie", "Fournier"),
    ("Gabriel", "Bélanger"),
    ("Marie", "Nguyen"),
    ("William", "Ho"),
    ("Jessica", "Martin"),
    ("Kevin", "Dubé"),
    ("Laurence", "Simard"),
    ("Antoine", "Boucher"),
    ("Rania", "Saleh"),
    ("Olivia", "Thompson"),
    ("Mohamed", "Kaba"),
    ("Valérie", "Paquette"),
    ("Benoît", "Giroux"),
    ("Stéphanie", "Lacroix"),
    ("Daniel", "Rosenberg"),
    ("Priya", "Raman"),
    ("Marco", "Rossi"),
    ("Natalia", "Kowalczyk"),
    ("Félix", "Poirier"),
    ("Jade", "Beaulieu"),
)
MODELS: tuple[tuple[str, str, VehicleSize], ...] = (
    ("Honda", "Civic", "sedan"),
    ("Toyota", "RAV4", "suv"),
    ("Mazda", "CX-5", "suv"),
    ("Hyundai", "Elantra", "sedan"),
    ("Ford", "Escape", "suv"),
    ("Kia", "Sportage", "suv"),
    ("Volkswagen", "Jetta", "sedan"),
    ("Subaru", "Crosstrek", "compact"),
    ("Toyota", "Tacoma", "truck"),
    ("Chevrolet", "Equinox", "suv"),
    ("Nissan", "Sentra", "sedan"),
    ("Honda", "Fit", "compact"),
    ("Mitsubishi", "RVR", "compact"),
)
SHADES = ("Black", "White", "Silver", "Grey", "Dark blue", "Red", "White", "Grey")
STREETS = (
    ("Rue Saint-Hubert", "H2S 2M5"),
    ("Avenue du Mont-Royal Est", "H2J 1W8"),
    ("Rue Beaubien Est", "H2S 1R4"),
    ("Rue Fleury Est", "H2C 1P9"),
    ("Rue de Verdun", "H4G 1N4"),
    ("Avenue Monkland", "H4A 1E5"),
    ("Rue Sherbrooke Est", "H1N 1C8"),
    ("Boulevard Gouin Ouest", "H4J 1C3"),
    ("Rue Notre-Dame Est", "H1W 3V3"),
    ("Avenue Papineau", "H2K 4J5"),
    ("Rue Jean-Talon Est", "H2E 1V2"),
    ("Boulevard Décarie", "H4L 3N3"),
)
SPOTS = (
    "Driveway with room on both sides. Outdoor tap by the side door.",
    "Street parking out front; we bring water and power.",
    "Underground garage, level P2. Ask the concierge for the visitor fob; no water hookup.",
    "Office lot, row B. Outlet on the light post.",
)
GENERATED = len(PEOPLE)
NO_SHOW = 21
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "card", "etransfer", "card", "cash", "card")
PHOTO_CLIENTS = (
    "emilie",
    "raj",
    "nadia",
    "julie",
    "thomas",
    "samira",
    "marieclaude",
    "david",
    "lucas",
    "fatou",
    "mei",
    "sophie",
    "gilles",
    "isabelle",
    "karim",
    "patrick",
    "elena",
    "jf",
    "simon",
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    addon = ADDONS.get(item_id)
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
        online_bookable=item_id in {WASH, INTERIOR, FULL, CORRECTION},
        sell_online=item_id in STOCK,
        addon_for=addon[0] if addon else (WASH, FULL) if stock else (),
        staff=PAINT_CREW
        if item_id in {CORRECTION, CERAMIC}
        else (OLIVIER, BOSS)
        if item_id == FLEET
        else (),
        buffer_after_min=TRAVEL_MIN if kind == "service" else 0,
        deposit_type="fixed"
        if item_id == CORRECTION
        else "percent"
        if item_id == CERAMIC
        else "none",
        deposit_value=10000 if item_id == CORRECTION else 25 if item_id == CERAMIC else None,
        frequency="month" if kind == "subscription" else None,
        visits_per_period=1 if kind == "subscription" else None,
        contract=CLUB_TERMS if kind == "subscription" else None,
        sessions=3 if kind == "package" else None,
        covers=WASH if kind == "package" else None,
        validity_days=180 if kind == "package" else None,
        ref="three" if kind == "package" else "club" if kind == "subscription" else None,
        sku=stock[3] if stock else addon[1] if addon else None,
        cost_cents=stock[2] if stock else None,
        stock=Stock(stock[0], stock[1]) if stock else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(CLEARCOAT),
    code="ct",
    slug="clearcoat",
    login_domain="clearcoat.example",
    owner=CLEARCOAT_OWNER,
    people=(
        Person(
            CLEARCOAT_OWNER,
            BOSS,
            "owner",
            "Mathieu Roy",
            "+15145550194",
            "owner",
            "Owner · Paint correction and coatings",
            "#1F4E6B",
            HOURS[BOSS],
        ),
        Person(
            "us_ct_daniela",
            DANIELA,
            "daniela",
            "Daniela Ortiz",
            "+15145550195",
            "staff",
            "Detailer · Paint correction and coatings",
            "#8A5A2B",
            HOURS[DANIELA],
            payee=True,
            rate_type="percent",
            rate_bps=4500,
            retail_rate_bps=1000,
        ),
        Person(
            "us_ct_olivier",
            OLIVIER,
            "olivier",
            "Olivier Bouchard",
            "+15145550196",
            "staff",
            "Detailer · Fleet lead",
            "#2F7FA8",
            HOURS[OLIVIER],
            payee=True,
            rate_type="hourly",
            rate_cents=2300,
        ),
        Person(
            "us_ct_anh",
            ANH,
            "anh",
            "Anh Nguyen",
            "+15145550197",
            "staff",
            "Detailer · Interiors",
            "#3F7A5A",
            HOURS[ANH],
            payee=True,
            rate_type="hourly",
            rate_cents=2100,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Mobile car washes, details and coatings across Montreal.",
        "about": (
            "Clearcoat Mobile Detailing is a team of four based in Saint-Henri. We come to your "
            "driveway, street, office lot or condo garage with our own water and power, and "
            "wash, detail, polish or coat the car where it's parked. Paint correction and "
            "ceramic coatings are done by Mathieu or Daniela and quoted from your photos."
        ),
        "address": "4040 Rue Saint-Ambroise, Montréal, QC H4C 2C8",
        "phone": "+1 514-555-0198",
        "email": "hello@clearcoat.example",
        "neighbourhood": "Saint-Henri",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject="vehicle",
    sms_number="+15145550199",
    gst_hst_number="742918365RT0001",
    qst_number="1229384756TQ0001",
    forms=(
        FormSpec(
            VEHICLE_FORM, "Vehicle details", "ff_ct_vehicle_", VEHICLE_FIELDS, send_on="booking"
        ),
        FormSpec(
            WALKAROUND_FORM,
            "Pre-detail walkaround",
            "ff_ct_walkaround_",
            WALKAROUND_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK_FORM, "Detail feedback", "ff_ct_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(AGREEMENT, "Mobile detailing agreement", AGREEMENT_BODY, created_day=-500),
        ContractSpec(CLUB_TERMS, "Monthly wash club terms", CLUB_BODY, created_day=-420),
    ),
    storyline=(
        Stage("New client booked online, waiting for approval", "emilie", ("bk_ct_emilie",)),
        Stage("Ceramic coating quote sent with optional lines", "raj", ("est_ct_raj",)),
        Stage(
            "Paint correction accepted and booked, deposit paid",
            "nadia",
            ("est_ct_nadia", "bk_ct_nadia"),
        ),
        Stage(
            "Today's visits: checked in, on the way and later today",
            "julie",
            ("bk_ct_julie", "bk_ct_thomas", "bk_ct_samira"),
        ),
        Stage("Monthly wash club member", "marieclaude", ("sub_ct_club_marieclaude",)),
        Stage("Three-wash pack for one of two cars", "david", ("pkg_ct_three_david",)),
        Stage(
            "Fleet visit with a crew of two, one invoice overdue",
            "rosemont",
            ("av_ct_crew_rosemont_3", "inv_ct_rosemont_3"),
        ),
        Stage(
            "Walkaround signed, detailed and paid by Tap to Pay with a tip",
            "lucas",
            ("fr_ct_walkaround_lucas", "ord_ct_lucas"),
        ),
        Stage(
            "Cancelled late, with a late cancellation fee",
            "jason",
            ("bk_ct_jason_late", "inv_ct_jason_late"),
        ),
        Stage("Rain day, wash moved to the next dry day", "isabelle", ("bk_ct_isabelle",)),
        Stage("Odour treatment refunded", "simon", ("inv_ct_simon",)),
        Stage("Five-star feedback and a review request", "fatou", ("fr_ct_feedback_fatou",)),
        Stage("Four-star feedback about a late arrival", "mei", ("fr_ct_feedback_mei",)),
        Stage("Gift card bought for a father's detail", "sophie", ("gc_ct_dad",)),
    ),
    pacing=Pacing(
        {OLIVIER: 7, ANH: 5, DANIELA: 4, BOSS: 2},
        (WASH, WASH, INTERIOR, WASH, FULL, WASH, INTERIOR),
        weeks=30,
        ahead_weeks=5,
        seasonality={
            1: 0.5,
            2: 0.5,
            3: 0.7,
            4: 1.25,
            5: 1.3,
            6: 1.2,
            7: 1.1,
            8: 1.1,
            9: 1.0,
            10: 1.05,
            11: 0.85,
            12: 0.6,
        },
        settlements=SETTLEMENTS,
        cancel_every=37,
    ),
    photo_clients=PHOTO_CLIENTS,
    founded_day=-760,
    catalog_day=-500,
    documents_day=-500,
    restock_days=(-500, -400, -300, -200, -100, -30),
    payouts_from_day=-210,
    invoice_start=1800,
    estimate_start=400,
    cheque_start=700,
    seed=37,
)


# client -> detailer, weekday, start, every n weeks, visits, visits already done
SERIES: dict[str, tuple[str, int, time, int, int, int]] = {
    "karim": (OLIVIER, 3, time(9, 0), 2, 12, 8),
}
# wash club members: days since they joined, detailer
CLUB_MEMBERS: dict[str, tuple[int, str]] = {"marieclaude": (172, OLIVIER), "jf": (64, ANH)}


def _clock(when: datetime) -> str:
    return f"{when:%I:%M %p}".removeprefix("0")


def _email(name: str) -> str:
    plain = "".join(
        c for c in unicodedata.normalize("NFKD", name.lower()) if c.isalpha() or c == " "
    )
    return f"{plain.replace(' ', '.')}@example.test"


def _generated(index: int) -> Owner:
    first, last = PEOPLE[index]
    make, model, size = MODELS[index % len(MODELS)]
    street, postal = STREETS[index % len(STREETS)]
    letters = "BCDFGHJKLMNPRSTVWXZ"
    plate = (
        f"{letters[index % 19]}{(index * 37) % 90 + 10} "
        f"{letters[(index * 7) % 19]}{letters[(index * 11) % 19]}{letters[(index * 13) % 19]}"
    )
    car = Car(
        2014 + index % 10,
        make,
        model,
        SHADES[index % len(SHADES)],
        plate,
        size,
        f"{110 + (index * 211) % 8800} {street}, Montréal, QC {postal}",
        SPOTS[index % len(SPOTS)],
    )
    return Owner(f"car_{index:02}", f"{first} {last}", (car,))


def _attributes(car: Car) -> dict[str, object]:
    attributes = VehicleAttributes(
        address=car.address,
        make=car.make,
        model=car.model,
        year=car.year,
        colour=car.colour,
        plate=car.plate,
        size=car.size,
        parking=car.parking,
        notes=car.notes,
    )
    return attributes.model_dump(mode="json", exclude_none=True)


def _fathers_day(today: date) -> date:
    """The latest Father's Day (the third Sunday in June) at least a month before today."""
    year = today.year if today >= date(today.year, 7, 20) else today.year - 1
    first = date(year, 6, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 14)


class Clearcoat(Demo):
    spec = SPEC

    def story(self) -> None:
        self.owners()
        self.regulars()
        self.today_jobs()
        self.storyline()
        self.fleet()
        self.club()
        self.history()
        self.tips(self.fill(self.routine_clients()))
        self.paperwork()
        self.engagement()

    def finish(self) -> None:
        super().finish()
        self.portraits()

    def visit_note(self, item: Item, booking: Booking) -> str:
        car = self.ctx.get(Subject, booking.subject_id or "")
        return f"{item.name}, {car.name}, at {car.attributes.get('address', '')}."

    def owners(self) -> None:
        for owner in (*NAMED, *(_generated(i) for i in range(GENERATED))):
            self.owner(owner)
        self.owner(ROSEMONT, tags=["fleet"])
        self.ctx.get(Client, "cl_ct_raj").created_at = self.now - timedelta(days=6)

    def owner(self, owner: Owner, *, tags: list[str] | None = None) -> None:
        index = len(self.ctx.all(Client))
        first, *others = owner.cars
        self.client(
            owner.key,
            owner.name,
            owner.email or _email(owner.name),
            f"+1514555{100 + index:04}",
            tags=tags or [],
            channel="email" if tags or index % 3 == 0 else "sms",
            fields={"source": ("google", "referral", "instagram")[index % 3]},
            subject=first.name,
            attributes=_attributes(first),
        )
        for number, car in enumerate(others, start=2):
            self.subject(f"{owner.key}_{number}", owner.key, car.name, _attributes(car))

    def routine_clients(self) -> list[str]:
        busy = {"emilie", "raj", "nadia", "jason", "rosemont", *SERIES, *CLUB_MEMBERS}
        named = [o.key for o in NAMED if o.key not in busy]
        generated = [f"car_{i:02}" for i in range(GENERATED) if i != NO_SHOW]
        return [*named, *generated]

    def regulars(self) -> None:
        for key, (staff, weekday, at, every, visits, before) in SERIES.items():
            self.series(
                key,
                key,
                WASH,
                staff,
                weekday=weekday,
                at=at,
                every=every,
                visits=visits,
                before=before,
                settle="card",
            )
        self.note(
            "cl_ct_karim",
            "client",
            "Every second Thursday at his office lot with Olivier. Card on file; he's usually in "
            "a meeting, so text when done rather than calling.",
            self.at(-110, 12),
        )

    def extras(self, booking: Booking, parts: tuple[tuple[str, int], ...]) -> None:
        """Add-ons a client picked when booking, which checkout bills with the visit."""
        for index, (part, qty) in enumerate(parts):
            item = self.items[part]
            self.ctx.add(
                Addon(
                    id=f"bka_{booking.id}_{index}",
                    business_id=self.spec.id,
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

    def job(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        staff: str,
        day: int,
        *,
        subject: str | None = None,
        note: str | None = None,
        helper: str | None = None,
    ) -> Booking:
        """A visit placed near `day` and lengthened by its add-ons."""
        extra = self.extra_minutes(quote)
        past = day < 0
        subject = subject or self.subject_id(client_key)
        start = self.place(
            staff, quote.service, day, subject, past=past, extra_min=extra, helper=helper
        ) or self.place(
            staff,
            quote.service,
            day,
            subject,
            past=past,
            forward=True,
            extra_min=extra,
            helper=helper,
        )
        assert start is not None
        created = min(start - timedelta(days=5), self.now - timedelta(hours=5))
        status: BookingStatus = "completed" if past else "confirmed"
        booking = self.book(
            key,
            client_key,
            quote.service,
            staff,
            start,
            status,
            created,
            subject=subject,
            extra_min=extra,
        )
        if note:
            self.note(booking.id, "booking", note, created)
        return booking

    def detail(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        staff: str,
        day: int,
        settle: Settle,
        *,
        subject: str | None = None,
        tip: tuple[str, int] | None = None,
        note: str | None = None,
    ) -> Booking:
        """A past visit with its add-ons and products on one invoice."""
        booking = self.job(key, client_key, quote, staff, day, subject=subject, note=note)
        assert booking.completed_at is not None
        if booking.deposit_amount_cents:
            self.deposit(booking, booking.created_at + timedelta(minutes=10))
        invoice = self.invoice(
            key,
            client_key,
            booking.completed_at + timedelta(minutes=15),
            booking.created_at,
            self.visit_note(self.items[quote.service], booking),
        )
        booking.invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booking.created_at, booking=booking)
        self.settle(invoice, client_key, settle, tip=tip)
        return booking

    def today_jobs(self) -> None:
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        plan: tuple[tuple[str, str, Quote, int], ...] = (
            (DANIELA, "julie", Quote(INTERIOR), -60),
            (OLIVIER, "thomas", Quote(WASH, ((LARGE, 1),)), 30),
            (BOSS, "samira", Quote(WASH, ((HEADLIGHTS, 1),)), 105),
        )
        starts = {
            staff: (floor + timedelta(minutes=offset)).astimezone(UTC)
            for staff, _, _, offset in plan
        }

        def length(quote: Quote) -> timedelta:
            minutes = self.items[quote.service].duration_min or 90
            return timedelta(minutes=minutes + self.extra_minutes(quote))

        today = all(
            self.within_hours(staff, starts[staff], starts[staff] + length(quote))
            and self.free(
                staff, f"sj_ct_{key}", starts[staff], starts[staff] + length(quote), 0, 30
            )
            for staff, key, quote, _ in plan
        )
        jobs: dict[str, Booking] = {}
        for staff, key, quote, _ in plan:
            extra = self.extra_minutes(quote)
            start = starts[staff]
            if not today:
                found = self.place(
                    staff, quote.service, 1, f"sj_ct_{key}", past=False, extra_min=extra
                )
                assert found is not None
                start = found
            created = min(start - timedelta(days=8), self.now - timedelta(days=2))
            jobs[key] = self.book(
                key, key, quote.service, staff, start, "confirmed", created, extra_min=extra
            )
            self.extras(jobs[key], quote.parts)
        julie, thomas = jobs["julie"], jobs["thomas"]
        if today:
            julie.departed_at = julie.starts_at - timedelta(minutes=25)
            arrived = julie.starts_at + timedelta(minutes=4)
            julie.checked_in_at = arrived
            thomas.departed_at = self.now - timedelta(minutes=10)
            self.walkaround(
                "julie",
                julie,
                ["Stone chips", "Curb rash on wheels"],
                "Chips on the hood's leading edge; curb rash on the front right wheel.",
                arrived + timedelta(minutes=6),
                key="Julie kept it; the car was unlocked.",
            )
        for key, body in (
            (
                "julie",
                "Driveway beside the house, tap at the back corner. Car seats are out. Julie asked "
                "for extra time on the juice stains on the rear seat.",
            ),
            (
                "thomas",
                "Long driveway, park behind the truck. Crew cab with a tonneau cover; skip the "
                "bed liner.",
            ),
            (
                "samira",
                "Street parking on Saint-Denis. Samira will text the spot; headlights are cloudy, "
                "so she added the restoration.",
            ),
        ):
            self.note(jobs[key].id, "booking", body, jobs[key].created_at)

    def walkaround(
        self,
        ref: str,
        booking: Booking,
        existing: list[str],
        details: str,
        submitted: datetime,
        *,
        key: str,
    ) -> None:
        client = self.ctx.get(Client, booking.client_id)
        self.response(
            "walkaround",
            ref,
            WALKAROUND_FORM,
            booking,
            {
                "visit_date": self.local(booking.starts_at).date().isoformat(),
                "existing": existing,
                "details": details,
                "valuables": True,
                "key": key,
            },
            submitted,
            opened=submitted - timedelta(minutes=8),
            created=submitted - timedelta(minutes=10),
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.74"},
        )

    def storyline(self) -> None:
        self.lead()
        self.quotes()
        self.pack()
        self.tap_to_pay()
        self.late_cancel()
        self.rain_day()
        self.refund_story()
        self.feedback_stories()
        self.fathers_day()

    def attach(self, response_id: str, field: str, asset: str, when: datetime) -> str:
        file_id = f"fl_ct_{response_id.removeprefix('fr_ct_')}_{field}"
        self.ctx.add(
            File(
                id=file_id,
                business_id=CLEARCOAT,
                parent_type="form_response",
                parent_id=response_id,
                purpose="attachment",
                s3_key=f"{CLEARCOAT}/demo/{asset}",
                content_type="image/jpeg",
                size=(ASSETS / asset).stat().st_size,
                created_at=when - timedelta(minutes=6),
                updated_at=when - timedelta(minutes=5),
            )
        )
        return file_id

    def lead(self) -> None:
        quote = Quote(INTERIOR, ((PET_HAIR, 1),))
        extra = self.extra_minutes(quote)
        start = self.place(ANH, INTERIOR, 3, "sj_ct_emilie", past=False, extra_min=extra)
        assert start is not None
        created = self.now - timedelta(hours=19)
        emilie = self.book(
            "emilie",
            "emilie",
            INTERIOR,
            ANH,
            start,
            "pending",
            created,
            source="online",
            extra_min=extra,
        )
        self.extras(emilie, quote.parts)
        submitted = created + timedelta(minutes=40)
        response = self.response(
            "vehicle",
            "emilie",
            VEHICLE_FORM,
            emilie,
            {
                "vehicle": "2018 Subaru Outback",
                "colour": "Green",
                "size": "SUV or crossover",
                "address": "4326 Rue de Bordeaux, Montréal, QC H2H 1Z5",
                "parking": "Street",
                "parking_details": "In front of the house, permit zone 41. I'll leave a visitor "
                "permit on the dash.",
                "concerns": ["Pet hair", "Stains on the seats"],
                "notes": "Our golden retriever rides in the back. Coffee stain on the driver's "
                "seat.",
            },
            submitted,
            created=created + timedelta(minutes=5),
        )
        response.answers = {
            **response.answers,
            "photo_interior": self.attach(
                response.id, "photo_interior", "ct_photo_interior.jpg", submitted
            ),
        }
        self.sign(
            "emilie", "emilie", AGREEMENT, submitted + timedelta(minutes=8), None, status="pending"
        )

    def quotes(self) -> None:
        ctx = self.ctx
        requested = self.now - timedelta(days=5, hours=3)
        response_id = "fr_ct_vehicle_raj"
        ctx.add(
            FormResponse(
                id=response_id,
                business_id=CLEARCOAT,
                form_id=VEHICLE_FORM,
                client_id="cl_ct_raj",
                parent_type="subject",
                parent_id="sj_ct_raj",
                status="submitted",
                token="demo_vehicle_ct_raj",
                answers={
                    "vehicle": "2023 Mazda CX-50",
                    "colour": "Jet black",
                    "size": "SUV or crossover",
                    "address": "1840 Chemin Lucerne, Mont-Royal, QC H3R 2J3",
                    "parking": "Driveway",
                    "parking_details": "We can clear the left garage bay for the day.",
                    "concerns": ["Swirl marks or scratches"],
                    "notes": "Bought it in the spring. The black shows every swirl from the "
                    "dealer wash. Thinking about a ceramic coating before winter.",
                    "photo_paint": self.attach(
                        response_id, "photo_paint", "ct_photo_paint.jpg", requested
                    ),
                },
                opened_at=requested - timedelta(minutes=20),
                submitted_at=requested,
                created_at=requested - timedelta(minutes=30),
                updated_at=requested,
            )
        )
        sent = requested + timedelta(hours=26)
        self.estimate(
            "raj",
            "raj",
            Quote(CERAMIC),
            sent,
            status="sent",
            note="Three-year coating on the paint, wheels and glass, done in your garage over one "
            "day. From the photo, a one-stage correction first would take out the swirls before "
            "they're sealed in, so it's listed as an option, with the engine bay.",
            optional=(
                (CORRECTION, 1, "Paint correction, one stage, before the coating", 44900),
                (ENGINE, 1, "Engine bay clean", 5900),
            ),
        )
        self.sign("raj", "raj", AGREEMENT, sent + timedelta(minutes=5), None, status="pending")
        pending = ctx.get(Signature, "sig_ct_raj")
        pending.opened_at = min(sent + timedelta(hours=5), self.now - timedelta(hours=2))
        # accepted and booked, with the deposit held against the date
        quote = Quote(CORRECTION, ((ENGINE, 1),))
        quoted = self.now - timedelta(days=9, hours=2)
        accepted = quoted + timedelta(days=1, hours=4)
        estimate = self.estimate(
            "nadia",
            "nadia",
            quote,
            quoted,
            status="accepted",
            decided=accepted,
            note="One-stage correction on the whole car in your building's garage, with the engine "
            "bay. Daniela will bring the lights and the extension cord.",
        )
        self.joined("nadia", quoted - timedelta(days=2))
        self.sign("nadia", "nadia", AGREEMENT, accepted + timedelta(minutes=15), None)
        extra = self.extra_minutes(quote)
        start = self.place(DANIELA, CORRECTION, 6, "sj_ct_nadia", past=False, extra_min=extra)
        assert start is not None
        booked = accepted + timedelta(minutes=30)
        nadia = self.book(
            "nadia", "nadia", CORRECTION, DANIELA, start, "confirmed", booked, extra_min=extra
        )
        self.addons(nadia, estimate, quote)
        self.deposit(nadia, booked + timedelta(minutes=10))
        self.note(
            nadia.id,
            "booking",
            "Underground garage, level P2, stall 84. Fob from the concierge at 7:45. No water "
            "hookup, so bring the tank and the long cord.",
            booked,
        )

    def pack(self) -> None:
        """David's three-wash pack is for the Forester; Rachel's Mazda is detailed and paid."""
        bought = self.at(-74, 18)
        package = self.package("david", THREE, bought, subject="sj_ct_david")
        for index, day in enumerate((-66, -30, 8)):
            self.visit(
                f"david_pack_{index}",
                "david",
                WASH,
                OLIVIER,
                day,
                settle=None,
                package_id=package.id,
                note="Wash from the three-wash pack, Forester only.",
            )
        self.detail("david_mazda", "david", Quote(FULL), ANH, -51, "card", subject="sj_ct_david_2")

    def tap_to_pay(self) -> None:
        self.visit("lucas_spring", "lucas", WASH, ANH, -170, settle="card")
        booking = self.job("lucas", "lucas", Quote(FULL), DANIELA, -3)
        assert booking.completed_at is not None
        paid = booking.completed_at + timedelta(minutes=6)
        self.sale(
            "lucas",
            "lucas",
            DANIELA,
            Quote(FULL, ((SPRAY, 1),)),
            booking,
            booking.created_at,
            paid,
            tip=(DANIELA, 3000),
        )
        self.walkaround(
            "lucas",
            booking,
            ["Scratches"],
            "Key scratch along the passenger door, already there.",
            booking.starts_at + timedelta(minutes=10),
            key="Lucas kept it.",
        )
        self.note(
            booking.id,
            "booking",
            "Lucas paid on Daniela's phone with Tap to Pay and added a bottle of spray detailer.",
            paid,
        )

    def late_cancel(self) -> None:
        self.detail("jason_first", "jason", Quote(FULL), OLIVIER, -88, "card")
        start = self.place(OLIVIER, INTERIOR, -15, "sj_ct_jason", past=True)
        assert start is not None
        booking = self.book(
            "jason_late", "jason", INTERIOR, OLIVIER, start, "canceled", start - timedelta(days=6)
        )
        canceled = start - timedelta(hours=2, minutes=40)
        booking.canceled_at = booking.updated_at = canceled
        self.note(
            booking.id,
            "booking",
            f"Jason texted at {_clock(self.local(canceled))} to cancel. That's under 24 hours' "
            "notice, so the $40 late cancellation fee applies.",
            canceled + timedelta(minutes=5),
        )
        invoice = self.invoice(
            "jason_late",
            "jason",
            canceled + timedelta(hours=1),
            canceled + timedelta(minutes=50),
            f"Late cancellation fee for the interior detail booked on {self.local(start):%B} "
            f"{self.local(start).day}, cancelled with under 24 hours' notice.",
        )
        booking.invoice_id = invoice.id
        self.ctx.add(
            Line(
                id=f"ln_{invoice.id}_0",
                business_id=CLEARCOAT,
                invoice_id=invoice.id,
                booking_id=booking.id,
                description="Late cancellation fee",
                quantity=1,
                unit_amount_cents=LATE_FEE,
                amount_cents=LATE_FEE,
                tax_class="standard",
                optional=False,
                selected=False,
                position=0,
                created_at=invoice.created_at,
                updated_at=invoice.created_at,
            )
        )
        self.settle(invoice, "jason", "card")
        thread = self.thread("jason", "sms", canceled)
        self.say(
            thread,
            "Sorry, I have to take the car to work today after all. Can we cancel?",
            canceled,
            sender=None,
        )
        self.say(
            thread,
            "Hi Jason, I've cancelled today's interior detail. Because it's under 24 hours' "
            "notice, the $40 late cancellation fee applies. Would you like another day?",
            canceled + timedelta(minutes=12),
        )

    def rain_day(self) -> None:
        """Isabelle's wash was rained out yesterday and moved to the next dry day."""
        start = self.place(ANH, WASH, 2, "sj_ct_isabelle", past=False)
        assert start is not None
        rained = self.local(self.now).date() - timedelta(days=1)
        while self.hours_on(ANH, rained) is None:
            rained -= timedelta(days=1)
        original = datetime.combine(rained, time(10, 0), self.ctx.zone).astimezone(UTC)
        booking = self.book(
            "isabelle", "isabelle", WASH, ANH, start, "confirmed", original - timedelta(days=8)
        )
        booking.reschedule_count = 1
        moved = datetime.combine(rained, time(7, 30), self.ctx.zone).astimezone(UTC)
        booking.updated_at = moved
        local = self.local(start)
        self.note(
            booking.id,
            "booking",
            f"Moved from {rained:%A, %B} {rained.day} at 10:00 AM because of rain. Shared "
            "driveway; the CR-V is on the left.",
            moved,
        )
        self.ctx.add(
            Audit(
                id="aud_ct_isabelle_rain",
                business_id=CLEARCOAT,
                performed_by=CLEARCOAT_OWNER,
                action="booking.reschedule",
                entity_type="booking",
                entity_id=booking.id,
                changes={"from": original.isoformat(), "to": start.isoformat()},
                created_at=moved,
            )
        )
        thread = self.thread("isabelle", "sms", moved)
        self.say(
            thread,
            "Hi Isabelle, it's Mathieu from Clearcoat. Rain is forecast all morning, so we'd like "
            f"to move today's wash to {local:%A, %B} {local.day} at {_clock(local)}. Does that "
            "work?",
            moved,
        )
        self.say(thread, "Yes, no problem. Thanks!", moved + timedelta(minutes=25), sender=None)

    def refund_story(self) -> None:
        booking = self.detail("simon", "simon", Quote(FULL, ((ODOUR, 1),)), ANH, -21, "card")
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == booking.invoice_id)
        assert payment.paid_at is not None
        when = payment.paid_at + timedelta(days=3, hours=2)
        self.refund(
            payment,
            10233,
            when,
            "The smoke smell came back after a few warm days, so the odour treatment is refunded.",
        )
        self.note(
            "cl_ct_simon",
            "client",
            "Refunded the odour treatment with GST and QST ($102.33). The headliner holds the "
            "smoke; quote a headliner shampoo if he asks again.",
            when,
        )
        thread = self.thread("simon", "email", when - timedelta(hours=4))
        self.say(
            thread,
            "Hi, the van looked great, but after a few warm days the smoke smell is back.",
            when - timedelta(hours=4),
            sender=None,
        )
        self.say(
            thread,
            "Hi Simon, thanks for telling us, and sorry it didn't last. I've refunded the odour "
            "treatment to your card. The smell is likely in the headliner, which an ozone "
            "treatment doesn't reach; we can quote a headliner shampoo if you'd like.",
            when,
            sender=CLEARCOAT_OWNER,
        )

    def feedback_stories(self) -> None:
        fatou = self.detail(
            "fatou",
            "fatou",
            Quote(FULL, ((LARGE, 1), (PET_HAIR, 1))),
            DANIELA,
            -5,
            "card",
            tip=(DANIELA, 2500),
        )
        self.feedback(
            "fatou",
            fatou,
            5,
            ["Interior", "Care with the car", "Communication"],
            "The van looked new inside, even the third row. Daniela was careful with the car "
            "seats and put everything back where it was.",
        )
        self.review("fatou")
        mei = self.detail("mei", "mei", Quote(INTERIOR), OLIVIER, -8, "etransfer")
        self.feedback(
            "mei",
            mei,
            4,
            ["Interior", "Glass"],
            "Really clean inside. Olivier arrived about 30 minutes late, and I had to come down "
            "to let him into the garage.",
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
        submitted = min(booking.completed_at + timedelta(hours=4), self.now - timedelta(hours=1))
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

    def fathers_day(self) -> None:
        sunday = _fathers_day(self.local(self.now).date())
        bought = datetime.combine(sunday - timedelta(days=5), time(19, 40), self.ctx.zone)
        card = self.gift_card(
            "dad", "sophie", GIFT, 35000, bought.astimezone(UTC), recipient="Gilles Bergeron"
        )
        day = self.days_to(bought) + 12
        visit = self.visit(
            "gilles_gift",
            "gilles",
            FULL,
            DANIELA,
            day,
            settle=None,
            price=0,
            note="Father's Day gift from Sophie (gift card CT-GIFT-DAD). Redeem $339.18 for the "
            "full detail with GST and QST; the rest stays on the card.",
        )
        assert visit is not None and visit.completed_at is not None
        self.redeem(card, 33918, visit.completed_at + timedelta(minutes=10))
        self.visit("sophie_spring", "sophie", WASH, ANH, self.days_to(bought) - 50)
        thread = self.thread("gilles", "sms", visit.completed_at + timedelta(hours=3))
        self.say(
            thread,
            "Thank you, the Camry hasn't looked this good since I bought it. My daughter will be "
            "pleased.",
            visit.completed_at + timedelta(hours=3),
            sender=None,
        )
        self.say(
            thread,
            "Thank you, Gilles. There's $10.82 left on the gift card for a wash later on.",
            visit.completed_at + timedelta(hours=3, minutes=20),
        )

    def days_to(self, when: datetime) -> int:
        return (self.local(when).date() - self.local(self.now).date()).days

    def fleet(self) -> None:
        """Plomberie Rosemont's four vans, washed once a month by Olivier with Anh as crew."""
        vans = ", ".join(c.plate for c in ROSEMONT.cars)
        settles: tuple[Settle, ...] = ("etransfer", "etransfer", "etransfer", "overdue", "card")
        for index, (day, settle) in enumerate(zip((-118, -88, -60, -32, 3), settles, strict=True)):
            key = f"rosemont_{index}"
            booking = self.job(
                key,
                "rosemont",
                Quote(FLEET),
                OLIVIER,
                day,
                helper=ANH,
                note=f"All four vans in the yard: {vans}. Gate code 4410, tap on the east wall.",
            )
            assert self.helper_on(booking, ANH)
            if booking.completed_at is None:
                continue
            invoice = self.invoice(
                key,
                "rosemont",
                booking.completed_at + timedelta(hours=2),
                booking.created_at,
                f"Fleet wash visit, {self.local(booking.starts_at):%B} "
                f"{self.local(booking.starts_at).day}: four vans ({vans}).",
            )
            booking.invoice_id = invoice.id
            self.line(invoice.id, FLEET, booking.created_at, booking=booking)
            self.settle(invoice, "rosemont", settle)
        self.note(
            "cl_ct_rosemont",
            "client",
            "Invoices go to bureau.plomberierosemont@example.test and are paid by e-Transfer "
            "within 14 days. The office keeps the vans in the yard on wash days; book Olivier "
            "with Anh.",
            self.at(-125, 11),
        )

    def club(self) -> None:
        for key, (joined_days, staff) in CLUB_MEMBERS.items():
            joined = self.at(-joined_days, 19)
            self.subscribe(key, CLUB, joined)
            month = 0
            while (day := -joined_days + 3 + month * 30) < 26:
                if -2 <= day <= 1:
                    day = 2
                self.visit(
                    f"{key}_club_{month}",
                    key,
                    WASH,
                    staff,
                    day,
                    settle=None,
                    price=0,
                    note="Wash club: this month's maintenance wash.",
                )
                month += 1

    def history(self) -> None:
        self.detail(
            "elena_coating",
            "elena",
            Quote(CERAMIC, ((HEADLIGHTS, 1),)),
            DANIELA,
            -96,
            "card",
            note="Ceramic coating in Elena's garage. Cure overnight with the door closed; no wash "
            "for a week.",
        )
        self.detail("elena_wash", "elena", Quote(WASH), DANIELA, -40, "card")
        self.detail("patrick_lights", "patrick", Quote(WASH, ((HEADLIGHTS, 1),)), BOSS, -63, "card")
        self.detail(
            "thomas_spring", "thomas", Quote(FULL, ((LARGE, 1), (ENGINE, 1))), BOSS, -178, "card"
        )
        self.detail("julie_spring", "julie", Quote(FULL, ((LARGE, 1),)), DANIELA, -160, "card")
        missed = f"car_{NO_SHOW:02}"
        booking = self.visit(
            f"{missed}_missed", missed, WASH, ANH, -26, status="no_show", settle=None
        )
        assert booking is not None
        self.note(
            booking.id,
            "booking",
            "Car wasn't in the spot or on the street nearby. Called and texted, waited 15 minutes, "
            "then left.",
            booking.starts_at + timedelta(minutes=20),
        )
        for key, staff, day, item, parts in (
            ("patrick_next", BOSS, 9, FULL, ((ENGINE, 1),)),
            ("fatou_next", DANIELA, 12, WASH, ((LARGE, 1),)),
            ("car_04_odour", ANH, 5, INTERIOR, ((PET_HAIR, 1), (ODOUR, 1))),
        ):
            client = key.removesuffix("_next").removesuffix("_odour")
            upcoming = self.job(key, client, Quote(item, parts), staff, day)
            self.extras(upcoming, parts)

    def tips(self, made: list[Booking]) -> None:
        """About one in five card payments carries a tip for the detailer."""
        by_invoice = {p.invoice_id: p for p in self.ctx.all(Payment) if p.method == "card"}
        for index, booking in enumerate(made):
            payment = by_invoice.get(booking.invoice_id)
            if payment is None or index % 5:
                continue
            cents = (1000, 1500, 2000, 1500)[index // 5 % 4]
            payment.tip_cents = cents
            payment.tip_split = [{"staff_id": booking.staff_id, "cents": cents}]

    def paperwork(self) -> None:
        """Every client signs the agreement at their first booking and answers the vehicle form."""
        ctx = self.ctx
        first: dict[str, Booking] = {}
        for booking in sorted(ctx.all(Booking), key=lambda b: b.created_at):
            first.setdefault(booking.client_id, booking)
        signed = {s.client_id for s in ctx.all(Signature) if s.contract_id == AGREEMENT}
        answered = {r.client_id for r in ctx.all(FormResponse) if r.form_id == VEHICLE_FORM}
        for client_id, booking in sorted(first.items()):
            key = client_id.removeprefix("cl_ct_")
            if client_id not in signed:
                at = min(booking.created_at + timedelta(minutes=35), self.now - timedelta(hours=2))
                self.sign(key, key, AGREEMENT, at, None)
            if client_id not in answered and key != "rosemont":
                self.vehicle_answers(key, booking)
        for key, body in (
            (
                "elena",
                "Ceramic coated in the summer. pH-neutral soap only, no wax or sealant on top.",
            ),
            ("thomas", "Truck: add the large vehicle charge. Skip the bed liner."),
            (
                "jason",
                "Late cancellation fee charged once. Remind him about the 24-hour window.",
            ),
            ("mei", "Buzz 310 for the garage door. Leave 15 minutes extra to get in."),
        ):
            self.note(self.client_id(key), "client", body, self.now - timedelta(days=4))

    def vehicle_answers(self, key: str, booking: Booking) -> None:
        car = self.ctx.get(Subject, booking.subject_id or "")
        attributes = car.attributes
        size = str(attributes.get("size", "sedan"))
        parking = str(attributes.get("parking", ""))
        submitted = min(booking.created_at + timedelta(hours=2), self.now - timedelta(hours=1))
        answers: dict[str, object] = {
            "vehicle": car.name,
            "colour": str(attributes.get("colour", "")),
            "size": {
                "compact": "Compact or small car",
                "sedan": "Sedan",
                "suv": "SUV or crossover",
                "truck": "Pickup truck",
                "van": "Van or minivan",
            }[size],
            "address": str(attributes.get("address", "")),
            "parking": "Underground or indoor garage"
            if "garage" in parking.lower()
            else "Outdoor lot at work"
            if "lot" in parking.lower()
            else "Street"
            if "street" in parking.lower()
            else "Driveway",
            "parking_details": parking,
        }
        if attributes.get("notes"):
            answers["notes"] = str(attributes["notes"])
        if len(key) % 3 == 0:
            answers["concerns"] = ["Road salt"]
        self.response("vehicle", key, VEHICLE_FORM, booking, answers, submitted)

    def engagement(self) -> None:
        self.consents()
        self.withdraw("car_07", "email", self.now - timedelta(days=33))
        self.broadcast(
            "spring",
            "Spring salt wash",
            "Winter salt keeps working on the paint and the underside of the car after the snow "
            "is gone. Book a maintenance wash or a full detail this month and we'll rinse the "
            "wheel wells and underside too. Reply to this email or book online.",
            self.at(-195, 10),
        )
        self.broadcast(
            "winter",
            "Get ready for winter",
            "A sealant or ceramic coating before the first snow makes salt and slush easier to "
            "rinse off all winter. Full details include a three-month sealant, and we have "
            "coating dates in heated garages through November.",
            self.at(-12, 10),
        )
        self.reviews()
        self.conversations()

    def reviews(self) -> None:
        ctx = self.ctx
        happy = (
            ("elena", 5, ["Paint and wheels", "Care with the car"], "The coating is stunning."),
            ("patrick", 5, ["Glass", "On time"], "The headlights look new."),
            ("thomas", 5, ["Paint and wheels", "Interior"], None),
            ("julie", 5, ["Interior", "Communication"], None),
            ("karim", 5, ["On time", "Paint and wheels"], "Done before my meeting ended."),
            ("david", 4, ["Interior", "Glass"], "Great job. A few streaks on the inside glass."),
            ("samira", 5, ["Paint and wheels", "Communication"], None),
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
                    and not any(r.parent_id == b.id for r in ctx.all(FormResponse))
                ),
                key=lambda b: b.completed_at or self.now,
            )
            if not done:
                continue
            booking = done[-1]
            self.feedback(key, booking, rating, highlights, comment)
            if rating == 5:
                self.review(booking.id.removeprefix("bk_ct_"))
        for key in ("lucas", "gilles_gift"):
            self.review(key)

    def conversations(self) -> None:
        ctx = self.ctx
        emilie = ctx.get(Booking, "bk_ct_emilie")
        when = emilie.created_at + timedelta(hours=2)
        thread = self.thread("emilie", "email", when)
        self.say(
            thread,
            "Hi, I booked an interior detail online. Do I need to be home, or can you do it on "
            "the street while I'm at work?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Émilie, you don't need to be home. Leave the car unlocked or the key in the "
            "mailbox, and Anh will text you when he's done. We'll confirm your booking today.",
            min(when + timedelta(minutes=50), self.now - timedelta(minutes=30)),
        )
        raj = ctx.get(Estimate, "est_ct_raj")
        when = raj.created_at + timedelta(minutes=15)
        thread = self.thread("raj", "email", when)
        self.say(
            thread,
            "Hi Raj, your ceramic coating quote is ready. From your photo, a one-stage correction "
            "first would take out the swirls before they're sealed in, so it's listed as an "
            "option you can tick when you accept.",
            when,
        )
        self.say(
            thread,
            "Thanks. How long before I can drive it after the coating?",
            min(when + timedelta(hours=4), self.now - timedelta(minutes=45)),
            sender=None,
        )
        self.say(
            thread,
            "You can drive it the next morning. Keep it out of the rain for a day and don't wash "
            "it for a week while the coating cures.",
            min(when + timedelta(hours=5), self.now - timedelta(minutes=20)),
        )
        thomas = ctx.get(Booking, "bk_ct_thomas")
        if thomas.departed_at is not None:
            thread = self.thread("thomas", "sms", thomas.departed_at)
            self.say(
                thread,
                "Hi Thomas, Olivier from Clearcoat is on his way and should be there in about 25 "
                "minutes.",
                thomas.departed_at,
                sender="us_ct_olivier",
            )
            self.say(
                thread,
                "Perfect, the truck's in the driveway.",
                thomas.departed_at + timedelta(minutes=3),
                sender=None,
            )
        mei = ctx.get(FormResponse, "fr_ct_feedback_mei")
        if mei.submitted_at is not None:
            when = mei.submitted_at + timedelta(hours=2)
            thread = self.thread("mei", "email", when)
            self.say(
                thread,
                "Hi Mei, thank you for the feedback, and sorry for the late start and for making "
                "you come down. The garage door code didn't work for Olivier. I've added a note to "
                "your file to buzz 310 and to leave more time before your visits.",
                when,
                sender=CLEARCOAT_OWNER,
            )
        overdue = ctx.get(Invoice, "inv_ct_rosemont_3")
        if overdue.overdue_notified_at is not None:
            when = overdue.overdue_notified_at + timedelta(hours=2)
            thread = self.thread("rosemont", "email", when)
            self.say(
                thread,
                f"Bonjour, invoice {overdue.number} for last month's fleet wash is past due. You "
                "can pay by card from the invoice email or by e-Transfer to "
                "hello@clearcoat.example.",
                when,
            )
            self.say(
                thread,
                "Thanks for the reminder. Our bookkeeper was away; we'll send it with Friday's "
                "payments.",
                when + timedelta(hours=6),
                sender=None,
            )


EDITION = Clearcoat
