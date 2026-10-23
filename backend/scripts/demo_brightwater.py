"""Brightwater Home Cleaning: a four-person house cleaner in Calgary, built on the demo engine."""

import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.catalog import Item, ItemKind
from clientbridge.models.clients import Client, Subject
from clientbridge.models.documents import FormResponse, Signature
from clientbridge.models.payments import Payment
from clientbridge.models.platform import File
from clientbridge.models.scheduling import Addon, Booking, Slot
from clientbridge.schemas.subjects import PropertyAttributes
from scripts.demo_context import demo_business
from scripts.demo_engine import ASSETS, Demo, Quote
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

BRIGHTWATER = "bz_brightwater"
BRIGHTWATER_OWNER = "us_bw_owner"

BOSS, JOY, HARPREET, TOMASZ = "st_bw_owner", "st_bw_joy", "st_bw_harpreet", "st_bw_tomasz"
STANDARD, RECURRING, DEEP, MOVE_OUT, MOVE_IN, TOUCH_UP = (
    "it_bw_standard",
    "it_bw_recurring",
    "it_bw_deep",
    "it_bw_move_out",
    "it_bw_move_in",
    "it_bw_touch_up",
)
OVEN, FRIDGE, WINDOWS, LAUNDRY = "it_bw_oven", "it_bw_fridge", "it_bw_windows", "it_bw_laundry"
REFILL, BOTTLE, CLOTHS, DRYER = "it_bw_refill", "it_bw_bottle", "it_bw_cloths", "it_bw_dryer_balls"
GIFT = "it_bw_gift"
HOME_FORM, CHECKLIST_FORM, FEEDBACK_FORM = "frm_bw_home", "frm_bw_move_out", "frm_bw_feedback"
AGREEMENT, KEYS = "con_bw_agreement", "con_bw_keys"
CLEANS = (STANDARD, RECURRING, DEEP, MOVE_OUT, MOVE_IN, TOUCH_UP)

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        STANDARD,
        "service",
        "Standard clean",
        16500,
        150,
        "Cleans",
        "Kitchen counters, stovetop and sink, bathrooms, dusting, vacuuming and mopping "
        "throughout, and beds made. Priced for homes up to about 1,800 sq ft; we quote larger "
        "homes.",
    ),
    (
        RECURRING,
        "service",
        "Recurring clean",
        14500,
        150,
        "Cleans",
        "The same cleaner on a set day every week or every two weeks. Everything in a standard "
        "clean, plus one extra area each visit, such as baseboards or the microwave.",
    ),
    (
        DEEP,
        "service",
        "Deep clean",
        34500,
        300,
        "Cleans",
        "A top-to-bottom clean for a first visit or once a season: baseboards, door frames and "
        "switches, cabinet fronts, descaled showers and taps, and under furniture we can move "
        "safely.",
    ),
    (
        MOVE_OUT,
        "service",
        "Move-out clean",
        42500,
        360,
        "Moving",
        "For an empty home at the end of a tenancy or a sale: inside every cabinet, closet and "
        "drawer, walls spot-cleaned, baseboards, windowsills and floors. We quote from photos, "
        "and a 25% deposit holds the date.",
    ),
    (
        MOVE_IN,
        "service",
        "Move-in clean",
        37500,
        300,
        "Moving",
        "An empty home cleaned before your things arrive: cabinets and drawers wiped inside, "
        "bathrooms disinfected, floors and baseboards done. A 25% deposit holds the date.",
    ),
    (
        TOUCH_UP,
        "service",
        "Touch-up clean",
        9500,
        90,
        "Cleans",
        "A shorter visit for one or two areas, such as the kitchen and main bathroom before "
        "guests arrive.",
    ),
    (
        OVEN,
        "product",
        "Inside the oven",
        4500,
        None,
        "Add-ons",
        "Inside the oven, the racks and the door glass, with a plant-based degreaser. Adds about "
        "45 minutes to the clean.",
    ),
    (
        FRIDGE,
        "product",
        "Inside the fridge",
        4000,
        None,
        "Add-ons",
        "Shelves and drawers washed and dried. Please clear out food first, or we'll move it to "
        "the counter while we work.",
    ),
    (
        WINDOWS,
        "product",
        "Inside windows",
        6000,
        None,
        "Add-ons",
        "Inside glass, frames and tracks on up to 10 windows. We don't clean outside glass above "
        "the ground floor.",
    ),
    (
        LAUNDRY,
        "product",
        "Laundry, wash and fold",
        3000,
        None,
        "Add-ons",
        "One load washed, dried and folded during your clean, using your machines.",
    ),
    (
        REFILL,
        "product",
        "All-purpose cleaner refill, 1 L",
        1400,
        None,
        "Eco supplies",
        "The fragrance-free all-purpose cleaner we use in your home. It refills a 500 ml spray "
        "bottle twice, and we take the empty jug back for refilling.",
    ),
    (
        BOTTLE,
        "product",
        "Glass spray bottle, 500 ml",
        1200,
        None,
        "Eco supplies",
        "An amber glass spray bottle with a silicone sleeve, for the all-purpose refill.",
    ),
    (
        CLOTHS,
        "product",
        "Sponge cloths, pack of 4",
        1500,
        None,
        "Eco supplies",
        "Cellulose and cotton cloths that replace paper towel in the kitchen. They go in the "
        "washing machine and can be composted when they wear out.",
    ),
    (
        DRYER,
        "product",
        "Wool dryer balls, set of 4",
        2000,
        None,
        "Eco supplies",
        "Unscented wool balls that shorten drying time and replace dryer sheets.",
    ),
    (
        GIFT,
        "gift",
        "Gift card",
        0,
        None,
        "Gift cards",
        "A gift card for any clean or add-on, emailed to the person you choose with your note. "
        "It doesn't expire.",
    ),
)
COLORS = {
    STANDARD: "#1E6A73",
    RECURRING: "#2F8F83",
    DEEP: "#28506B",
    MOVE_OUT: "#9A6B3F",
    MOVE_IN: "#7C8A3A",
    TOUCH_UP: "#6A7FA0",
}
# on hand today, low-stock line, unit cost, SKU; the dryer balls sit under their line
STOCK: dict[str, tuple[int, int, int, str]] = {
    REFILL: (31, 10, 520, "BW-ECO-APC1L"),
    BOTTLE: (17, 6, 450, "BW-ECO-BTL500"),
    CLOTHS: (24, 8, 560, "BW-ECO-CLOTH4"),
    DRYER: (3, 5, 700, "BW-ECO-DRYER4"),
}
ADDON_SKUS = {
    OVEN: "BW-ADD-OVEN",
    FRIDGE: "BW-ADD-FRIDGE",
    WINDOWS: "BW-ADD-WINDOWS",
    LAUNDRY: "BW-ADD-LAUNDRY",
}
WEEKDAYS = {d: (time(8, 0), time(16, 30)) for d in range(5)}
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {d: (time(8, 30), time(16, 0)) for d in range(5)},
    JOY: WEEKDAYS,
    HARPREET: WEEKDAYS,
    TOMASZ: {**WEEKDAYS, 5: (time(9, 0), time(13, 0))},
}
TRAVEL_MIN = 30
LATE_FEE = 5000
# the agreement's version 2, with the late cancellation fee, took effect this many days ago
AGREEMENT_REVISED = 150
AGREEMENT_V1 = (
    "Brightwater Home Cleaning will clean the home named on your booking as described for the "
    "service you chose. Please give us 24 hours' notice to move or cancel a clean. Tell us "
    "within 48 hours if we missed something and we'll come back to fix it at no charge. We "
    "charge the card on file after each clean, or you can pay by e-Transfer within 7 days. "
    "Keys and codes you give us are kept in a locked box at our office and used only for your "
    "cleans."
)
AGREEMENT_BODY = "\n\n".join(
    (
        "This agreement covers the cleans Brightwater Home Cleaning does at the home named on "
        "your booking. It is demo text for a fictional business, not legal advice.",
        "What we clean\nEach service lists what's included. Add-ons, such as inside the oven or "
        "the fridge, are done only when they're on the booking or estimate. If something takes "
        "longer than expected, we'll ask before staying past the booked time.",
        "Getting in\nYou'll tell us how to get in: being home, a lockbox, a hidden key, a door "
        "code or a building concierge. Keys and codes are kept in a locked box at our office, "
        "labelled with a number rather than your address, and used only for your cleans.",
        "Alarms and pets\nTell us if there's an alarm and how to turn it off, and about any "
        "pets, including which doors to keep closed. If an alarm goes off because the code we "
        "were given doesn't work, we'll call you and wait for you or the monitoring company.",
        "Products\nWe bring our own fragrance-free, plant-based products and equipment. If you'd "
        "like us to use yours on some surfaces, such as stone counters or hardwood, leave them "
        "out and tell us which.",
        "What we don't do\nFor our cleaners' safety we don't move furniture over 20 kg, use "
        "ladders above two steps, clean outside windows above the ground floor, or clean up "
        "mould, pest droppings or biohazards.",
        "Breakage\nTell us within 48 hours if something was damaged during a clean. We're "
        "insured, and we'll repair or replace it, or pay its fair value.",
        "Re-cleans\nIf we missed something, tell us within 48 hours with a photo if you can, and "
        "we'll come back to fix it at no charge.",
        "Cancelling and lockouts\nYou can move or cancel a clean at no charge up to 24 hours "
        "before it starts. Later cancellations, and visits where we can't get in, carry a $50 "
        "fee for the time we set aside.",
        "Payment\nWe charge the card on file after each clean, or you can pay the invoice by "
        "e-Transfer within 7 days. Property managers pay within 14 days of the invoice. Tips "
        "are optional and go in full to your cleaner.",
        "Ending a regular schedule\nYou can pause or end a weekly or every-two-weeks schedule at "
        "any time with a week's notice.",
    )
)
KEYS_BODY = "\n\n".join(
    (
        "This authorization lets Brightwater Home Cleaning hold a key, fob or code for your home "
        "and let ourselves in for your cleans. It is demo text for a fictional business, not "
        "legal advice.",
        "What we hold\nThe key, fob, lockbox code, garage code or alarm code you give us, listed "
        "on your property's entry notes.",
        "How it's kept\nKeys and fobs are kept in a locked key box at our office, tagged with a "
        "number instead of your address. Codes are kept in your client record, which only our "
        "team can see.",
        "Who uses it\nOnly the cleaner booked for your visit, and only on the day of the clean. "
        "We lock up and set the alarm when we leave, unless you ask us not to.",
        "Changing or ending it\nTell us when a code changes. When you end the arrangement or "
        "your regular schedule, we return keys and fobs within 7 days and delete the codes.",
    )
)
HOME_FIELDS: tuple[DocField, ...] = (
    ("address", "address", "Address", None, True, ()),
    (
        "home_type",
        "select",
        "Type of home",
        None,
        True,
        ("House", "Townhouse", "Condo or apartment", "Duplex"),
    ),
    ("bedrooms", "number", "Bedrooms", None, True, ()),
    ("bathrooms", "number", "Bathrooms", "Count a half bath as one.", True, ()),
    ("square_feet", "number", "Approximate size in square feet", None, False, ()),
    (
        "service",
        "select",
        "What would you like done?",
        None,
        True,
        (
            "Standard clean",
            "Recurring clean",
            "Deep clean",
            "Move-out clean",
            "Move-in clean",
            "Not sure yet",
        ),
    ),
    (
        "entry",
        "select",
        "How will we get in?",
        None,
        True,
        (
            "I'll be home",
            "Lockbox",
            "Key hidden on site",
            "Garage or door code",
            "Concierge or building manager",
        ),
    ),
    (
        "entry_details",
        "longtext",
        "Entry details",
        "Lockbox or door codes, which door to use and where to park. We use them only on the day "
        "of the clean.",
        False,
        (),
    ),
    (
        "alarm",
        "select",
        "Is there an alarm?",
        None,
        True,
        ("No alarm", "Yes, I'll turn it off", "Yes, code below"),
    ),
    ("alarm_details", "text", "Alarm code and where the panel is", None, False, ()),
    (
        "pets",
        "select",
        "Pets at home",
        None,
        True,
        ("No pets", "Dog", "Cat", "Dog and cat", "Other"),
    ),
    (
        "pet_notes",
        "text",
        "Anything we should know about your pets?",
        "For example, keep a door closed or don't let the cat out.",
        False,
        (),
    ),
    (
        "priorities",
        "multiselect",
        "Where should we focus?",
        None,
        False,
        (
            "Kitchen",
            "Bathrooms",
            "Floors",
            "Dusting",
            "Baseboards",
            "Inside appliances",
            "Windows",
        ),
    ),
    (
        "products",
        "select",
        "Products",
        None,
        True,
        (
            "Your fragrance-free products are fine",
            "Please use the products I leave out",
        ),
    ),
    ("skip", "longtext", "Rooms or things to leave alone", None, False, ()),
    ("start_date", "date", "Preferred first date", None, False, ()),
    ("photo_kitchen", "image", "A photo of the kitchen", None, False, ()),
    ("photo_bathroom", "image", "A photo of the main bathroom", None, False, ()),
)
CHECKLIST_FIELDS: tuple[DocField, ...] = (
    ("clean_date", "date", "Clean date", None, True, ()),
    ("oven", "checkbox", "Oven cleaned inside, with racks and glass", None, False, ()),
    ("fridge", "checkbox", "Fridge and freezer washed and dried", None, False, ()),
    ("cabinets", "checkbox", "Inside every cabinet, drawer and closet", None, True, ()),
    ("bathrooms", "checkbox", "Bathrooms descaled and disinfected", None, True, ()),
    ("baseboards", "checkbox", "Baseboards, door frames and switches wiped", None, True, ()),
    ("windows", "checkbox", "Windowsills and tracks wiped", None, True, ()),
    ("floors", "checkbox", "Floors vacuumed and mopped", None, True, ()),
    (
        "walls",
        "select",
        "Walls",
        None,
        True,
        ("Spot-cleaned", "Not needed", "Marks remain that need paint"),
    ),
    ("keys", "text", "Where the keys were left", None, False, ()),
    (
        "notes",
        "longtext",
        "Anything the landlord or new owner should know",
        None,
        False,
        (),
    ),
    ("rating", "rating", "How did the clean turn out?", None, False, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your clean?", None, True, ()),
    (
        "highlights",
        "multiselect",
        "What went well?",
        None,
        False,
        ("Kitchen", "Bathrooms", "Floors", "On time", "Communication", "Care with our things"),
    ),
    ("comments", "longtext", "Anything we missed or could do better?", None, False, ()),
    ("follow_up", "checkbox", "You can contact me about this", None, False, ()),
)


@dataclass(frozen=True)
class Household:
    key: str
    name: str
    address: str
    home: str
    rooms: int
    access: str
    pets: str | None = None
    email: str | None = None
    phone: str | None = None


# key, name, address, home type, rooms, entry and alarm, pets
NAMED = (
    Household(
        "sofia",
        "Sofia Martínez",
        "3615 19 Street SW, Calgary, AB T2T 4X9",
        "House",
        7,
        "Lockbox on the back gate, code 8823. No alarm. Park in the back lane.",
        "Pepper, a cat who hides under the bed; please keep the front door closed.",
    ),
    Household(
        "daniel",
        "Daniel Eze",
        "Unit 1408, 1111 10 Street SW, Calgary, AB T2R 1E2",
        "Condo or apartment",
        5,
        "Concierge holds a key under Eze. Visitor parking off 11 Avenue.",
    ),
    Household(
        "wei",
        "Wei Zhang",
        "Unit 902, 2510 Erlton Street SW, Calgary, AB T2S 2W1",
        "Condo or apartment",
        5,
        "Keys from the concierge on the day. Book the service elevator for 8:30 with the front "
        "desk. Underground visitor stall 14.",
    ),
    Household(
        "margaret",
        "Margaret Fraser",
        "3824 Elbow Drive SW, Calgary, AB T2S 2J1",
        "House",
        9,
        "Key on our key ring, tag 12. Alarm panel inside the front door, code 4096, then Off. "
        "Park in the driveway.",
    ),
    Household(
        "jennifer",
        "Jennifer MacDonald",
        "2219 Bowness Road NW, Calgary, AB T2N 3L1",
        "House",
        8,
        "Garage code 7710; the door from the garage is unlocked. No alarm.",
        "Two cats, Ollie and Fig. Don't let them into the garage.",
    ),
    Household(
        "omar",
        "Omar Haddad",
        "159 Aspen Summit Drive SW, Calgary, AB T3H 0K9",
        "House",
        10,
        "Lockbox by the side door, code 2468. Alarm panel in the mudroom, code 1357, then Away "
        "when we leave.",
        "Biscuit, a golden retriever, goes to daycare on clean days.",
    ),
    Household(
        "anjali",
        "Anjali Patel",
        "84 Tuscany Ravine Road NW, Calgary, AB T3L 2V7",
        "House",
        10,
        "Someone is home on Saturday mornings. Use the front door.",
    ),
    Household(
        "hyejin",
        "Hye-jin Park",
        "47 Royal Oak Drive NW, Calgary, AB T3G 4Z6",
        "House",
        8,
        "Lockbox on the garage side door, code 5150. Alarm panel by the garage door, code 8642, "
        "then Off.",
    ),
    Household(
        "linh",
        "Linh Nguyen",
        "1022 McDougall Road NE, Calgary, AB T2E 7Z5",
        "Townhouse",
        6,
        "Lockbox by the side door, code 3190. No alarm. Street parking on McDougall Road.",
        "Mochi, a cat, stays upstairs. Keep the bedroom door closed.",
    ),
    Household(
        "chidi",
        "Chidi Eze",
        "917 Edmonton Trail NE, Calgary, AB T2E 3J9",
        "House",
        8,
        "Chidi works from home and will let you in. Alarm is off during the day.",
        "Zara, a friendly boxer, will be in the back yard.",
    ),
    Household(
        "kateryna",
        "Kateryna Bondarenko",
        "3307 Varsity Drive NW, Calgary, AB T3A 1A4",
        "House",
        9,
        "Key under the blue planter by the back door. Alarm panel in the back hall, code 2207, "
        "then Off.",
    ),
    Household(
        "amara",
        "Amara Haile",
        "212 8 Avenue NE, Calgary, AB T2E 0R1",
        "House",
        7,
        "Amara is home on clean days. Park on 8 Avenue.",
    ),
    Household(
        "fatima",
        "Fatima Siddiqui",
        "91 Saddlebrook Way NE, Calgary, AB T3J 0L6",
        "House",
        9,
        "Garage code 4321. No alarm. Please take shoes off at the door; we keep shoe covers in "
        "the kit.",
    ),
    Household(
        "kevin",
        "Kevin Murray",
        "52 Cranston Boulevard SE, Calgary, AB T3M 0S9",
        "House",
        9,
        "Lockbox on the front railing, code 9087. Alarm panel inside the front door, code 1100, "
        "then Off.",
        "A senior beagle, Hank, sleeps in the laundry room.",
    ),
    Household(
        "brandon",
        "Brandon Kowalchuk",
        "1814 33 Avenue SW, Calgary, AB T2T 1Z3",
        "Duplex",
        6,
        "Key in the lockbox on the back porch, code 6060. No alarm.",
    ),
    Household(
        "rachel",
        "Rachel Goldberg",
        "4431 Lake Bonavista Drive SE, Calgary, AB T2J 2X9",
        "House",
        9,
        "Rachel is usually home. Alarm is off when someone's home.",
        "A parrot in the den; keep the den door shut and don't use sprays in that room.",
    ),
    Household(
        "jasmine",
        "Jasmine Cruz",
        "126 Evanston Drive NW, Calgary, AB T3P 0A2",
        "Townhouse",
        6,
        "Jasmine is home. Visitor parking at the end of the row.",
    ),
    Household(
        "teresita",
        "Teresita Cruz",
        "38 Panorama Hills Boulevard NW, Calgary, AB T3K 5J4",
        "House",
        8,
        "Teresita is home and will let you in. No alarm.",
    ),
    Household(
        "priya",
        "Priya Sharma",
        "71 Mahogany Boulevard SE, Calgary, AB T3M 1X8",
        "House",
        8,
        "Garage code 3355; the house door is unlocked. No alarm.",
        "Leo, a small dog, is in a crate in the office.",
    ),
    Household(
        "luis",
        "Luis Hernández",
        "2610 26 Avenue SW, Calgary, AB T3E 0E4",
        "House",
        7,
        "Lockbox by the front door, code 1984. Alarm panel in the front closet, code 6655.",
    ),
    Household(
        "grace",
        "Grace Lee",
        "18 Sienna Park Drive SW, Calgary, AB T3H 3V1",
        "House",
        9,
        "Grace is home weekday mornings. Alarm off.",
    ),
    Household(
        "samuel",
        "Samuel Mensah",
        "44 McKenzie Towne Drive SE, Calgary, AB T2Z 3S5",
        "Townhouse",
        6,
        "Lockbox on the back gate, code 7272. No alarm.",
    ),
    Household(
        "carmen",
        "Carmen Ruiz",
        "1317 Kensington Road NW, Calgary, AB T2N 3P5",
        "Duplex",
        7,
        "Door code 2580 on the front keypad. No alarm.",
        "Two guinea pigs in the spare room; no need to go in.",
    ),
    Household(
        "elena",
        "Elena Sokolova",
        "608 Lake Bonavista Drive SE, Calgary, AB T2J 0M2",
        "House",
        8,
        "Elena is home. Please ring the side door.",
    ),
    Household(
        "andre",
        "André Tremblay",
        "Unit 507, 1110 3 Avenue NW, Calgary, AB T2N 0J9",
        "Condo or apartment",
        4,
        "Fob in the lockbox at the front entrance, code 0505. Buzz 507 for the door.",
    ),
    Household(
        "olivia",
        "Olivia Harper",
        "214 10A Street NW, Calgary, AB T2N 1W6",
        "House",
        7,
        "Key under the mat at the back door. Alarm panel in the kitchen, code 3141.",
        "A tabby cat, Pickles. Keep the back door shut.",
    ),
    Household(
        "nikhil",
        "Nikhil Desai",
        "88 Auburn Bay Boulevard SE, Calgary, AB T3M 0K6",
        "House",
        9,
        "Garage code 1212. No alarm.",
    ),
    Household(
        "mariam",
        "Mariam Yusuf",
        "203 Panorama Hills Way NW, Calgary, AB T3K 0P4",
        "House",
        9,
        "Mariam is home. Shoes off at the door, please.",
    ),
    Household(
        "ahmed",
        "Ahmed Farouk",
        "Unit 1802, 220 12 Avenue SE, Calgary, AB T2G 0R5",
        "Condo or apartment",
        4,
        "Concierge has the fob. Visitor parking on level P1.",
    ),
    Household(
        "tom",
        "Tom Brennan",
        "1203 9 Avenue SE, Calgary, AB T2G 0S9",
        "House",
        7,
        "Lockbox on the back door, code 4455. No alarm. Lane parking behind the garage.",
        "A husky, Juno, who will want to say hello. Keep the yard gate latched.",
    ),
)
PRAIRIE_LANE = Household(
    "prairielane",
    "Prairie Lane Property Management",
    "Unit 304, 1110 3 Avenue NW, Calgary, AB T2N 0J9",
    "Condo or apartment",
    4,
    "Fob from the Prairie Lane office on 10 Street NW, or the lockbox at the front entrance, "
    "code 3304. Tenant is gone by the clean date.",
    email="units.prairielane@example.test",
)
# the other units Prairie Lane manages: key, unit name, address, entry
UNITS = (
    (
        "prairielane_beltline",
        "Unit 1207, Beltline",
        "Unit 1207, 1025 14 Avenue SW, Calgary, AB T2R 0P1",
        "Lockbox in the visitor lobby, code 1207. Service elevator booked by the office.",
    ),
    (
        "prairielane_bridgeland",
        "Unit 2, Bridgeland",
        "Unit 2, 803 McDougall Road NE, Calgary, AB T2E 7Z2",
        "Key in the lockbox on the front railing, code 8030.",
    ),
    (
        "prairielane_mission",
        "Unit 501, Mission",
        "Unit 501, 2307 4 Street SW, Calgary, AB T2S 1X4",
        "Fob from the Prairie Lane office. Parking in the loading zone for 30 minutes only.",
    ),
)
# generated regulars and movers; names reflect who lives in Calgary
PEOPLE = (
    ("Arjun", "Sandhu"),
    ("Bianca", "Ferreira"),
    ("Connor", "Walsh"),
    ("Divya", "Nair"),
    ("Emeka", "Obi"),
    ("Farah", "Rahimi"),
    ("Gabriel", "Santos"),
    ("Hannah", "Schultz"),
    ("Isaac", "Mbeki"),
    ("Jia", "Chen"),
    ("Kiran", "Dhaliwal"),
    ("Leila", "Mansour"),
    ("Marco", "Bianchi"),
    ("Noor", "Ali"),
    ("Paulina", "Wójcik"),
    ("Quinn", "Fortier"),
    ("Rosa", "Delgado"),
    ("Sanjay", "Kulkarni"),
    ("Tamara", "Kuznetsova"),
    ("Uche", "Nwosu"),
    ("Vanessa", "Tran"),
    ("Wyatt", "Larson"),
    ("Ximena", "Rojas"),
    ("Yasmin", "Abdi"),
    ("Zoe", "Mackenzie"),
    ("Aaron", "Kim"),
    ("Beatriz", "Gomes"),
    ("Callum", "Ferguson"),
    ("Deepa", "Iyer"),
    ("Ethan", "Wong"),
)
STREETS = (
    ("Centre Street N", "T2E 2R1"),
    ("Kensington Road NW", "T2N 3P5"),
    ("17 Avenue SW", "T2T 0A1"),
    ("Edmonton Trail NE", "T2E 3J9"),
    ("Bowness Road NW", "T3B 0B5"),
    ("Varsity Drive NW", "T3A 1A4"),
    ("McKenzie Towne Drive SE", "T2Z 3S5"),
    ("Mahogany Boulevard SE", "T3M 1X8"),
    ("Tuscany Boulevard NW", "T3L 2V7"),
    ("Evanston Drive NW", "T3P 0A2"),
    ("Cranston Boulevard SE", "T3M 0S9"),
    ("Royal Oak Drive NW", "T3G 4Z6"),
)
ENTRIES = (
    "Lockbox on the back door, code {code}. No alarm.",
    "Garage code {code}; the house door is unlocked. No alarm.",
    "Someone is home to let you in.",
    "Key in the lockbox by the front door, code {code}. Alarm panel inside the door, code "
    "{alarm}, then Off.",
)
GENERATED = len(PEOPLE)
# the last few generated clients moved in or out this year rather than cleaning regularly
MOVERS = range(22, 30)
LOCKOUT, DECLINED = 20, 21
SETTLEMENTS: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cash", "card", "etransfer")
PHOTO_CLIENTS = (
    "sofia",
    "daniel",
    "wei",
    "margaret",
    "anjali",
    "linh",
    "chidi",
    "kateryna",
    "amara",
    "fatima",
    "jasmine",
    "teresita",
    "omar",
    "jennifer",
    "priya",
    "luis",
    "hyejin",
    "grace",
    "samuel",
    "carmen",
    "elena",
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    moving = item_id in {MOVE_OUT, MOVE_IN}
    addon = item_id in ADDON_SKUS
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
        online_bookable=item_id in {STANDARD, RECURRING, DEEP, TOUCH_UP},
        sell_online=item_id in STOCK,
        addon_for=(STANDARD, RECURRING, DEEP, MOVE_OUT, MOVE_IN)
        if addon
        else (STANDARD, RECURRING)
        if stock
        else (),
        buffer_after_min=TRAVEL_MIN if kind == "service" else 0,
        deposit_type="percent" if moving else "none",
        deposit_value=25 if moving else None,
        sku=stock[3] if stock else ADDON_SKUS.get(item_id),
        cost_cents=stock[2] if stock else None,
        stock=Stock(stock[0], stock[1]) if stock else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(BRIGHTWATER),
    code="bw",
    slug="brightwater",
    login_domain="brightwater.example",
    owner=BRIGHTWATER_OWNER,
    people=(
        Person(
            BRIGHTWATER_OWNER,
            BOSS,
            "owner",
            "Leah Tran",
            "+14035550194",
            "owner",
            "Owner, quotes and deep cleans",
            "#1E6A73",
            HOURS[BOSS],
        ),
        Person(
            "us_bw_joy",
            JOY,
            "joy",
            "Joy Mendoza",
            "+14035550195",
            "staff",
            "Lead cleaner",
            "#2F8F83",
            HOURS[JOY],
            payee=True,
            rate_type="hourly",
            rate_cents=2600,
        ),
        Person(
            "us_bw_harpreet",
            HARPREET,
            "harpreet",
            "Harpreet Gill",
            "+14035550196",
            "staff",
            "Cleaner",
            "#B0703C",
            HOURS[HARPREET],
            payee=True,
            rate_type="hourly",
            rate_cents=2400,
        ),
        Person(
            "us_bw_tomasz",
            TOMASZ,
            "tomasz",
            "Tomasz Nowak",
            "+14035550197",
            "staff",
            "Cleaner, move-outs and deep cleans",
            "#5B6C8F",
            HOURS[TOMASZ],
            payee=True,
            rate_type="percent",
            rate_bps=4500,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Standard, deep and move-out cleaning for houses and condos in Calgary.",
        "about": (
            "Brightwater Home Cleaning is a team of four based in Inglewood. We clean houses "
            "and condos across Calgary, once or on a regular schedule, and quote move-out and "
            "move-in cleans from your photos. We bring fragrance-free, plant-based products "
            "unless you'd like us to use yours. If we miss something, tell us within 48 hours "
            "and we'll come back to fix it at no charge."
        ),
        "address": "1324 9 Avenue SE, Calgary, AB T2G 0T2",
        "phone": "+1 403-555-0198",
        "email": "hello@brightwater.example",
        "neighbourhood": "Inglewood",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 24,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
        "max_reschedules": 2,
    },
    subject="property",
    sms_number="+14035550199",
    gst_hst_number="784512369RT0001",
    forms=(
        FormSpec(HOME_FORM, "Home details", "ff_bw_home_", HOME_FIELDS, send_on="booking"),
        FormSpec(
            CHECKLIST_FORM,
            "Move-out checklist",
            "ff_bw_move_out_",
            CHECKLIST_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK_FORM, "Clean feedback", "ff_bw_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(
            AGREEMENT,
            "Cleaning service agreement",
            AGREEMENT_BODY,
            version=2,
            earlier_body=AGREEMENT_V1,
            revised_day=-AGREEMENT_REVISED,
            created_day=-400,
        ),
        ContractSpec(KEYS, "Key and alarm code authorization", KEYS_BODY, created_day=-400),
    ),
    storyline=(
        Stage("New lead, first clean waiting for approval", "sofia", ("bk_bw_sofia",)),
        Stage("Move-out quote sent with optional lines", "daniel", ("est_bw_daniel",)),
        Stage(
            "Move-out quote accepted and booked, deposit paid", "wei", ("est_bw_wei", "bk_bw_wei")
        ),
        Stage("Regular every two weeks on a series", "margaret", ("sch_bw_margaret",)),
        Stage(
            "Today's cleans: checked in, on the way and later today",
            "linh",
            ("bk_bw_linh", "bk_bw_chidi", "bk_bw_kateryna"),
        ),
        Stage("Cleaned and paid by Tap to Pay with a tip", "amara", ("ord_bw_amara",)),
        Stage(
            "Property manager with four units, one invoice overdue",
            "prairielane",
            ("inv_bw_prairielane_sunnyside",),
        ),
        Stage(
            "Cancelled late, with a late cancellation fee",
            "brandon",
            ("bk_bw_brandon_late", "inv_bw_brandon_late"),
        ),
        Stage("Five-star feedback and a review request", "fatima", ("fr_bw_feedback_fatima",)),
        Stage(
            "Three-star feedback about a missed spot, re-clean done",
            "kevin",
            ("fr_bw_feedback_kevin", "bk_bw_kevin_reclean"),
        ),
        Stage("Gift card bought for a mother's clean", "jasmine", ("gc_bw_mom",)),
    ),
    pacing=Pacing(
        {JOY: 5, HARPREET: 6, TOMASZ: 5, BOSS: 2},
        (STANDARD, STANDARD, DEEP, STANDARD, TOUCH_UP, STANDARD, STANDARD),
        weeks=30,
        ahead_weeks=5,
        seasonality={
            1: 0.7,
            2: 0.8,
            3: 0.95,
            4: 1.2,
            5: 1.2,
            6: 1.05,
            7: 0.85,
            8: 0.95,
            9: 1.05,
            10: 1.0,
            11: 0.95,
            12: 1.15,
        },
        settlements=SETTLEMENTS,
        cancel_every=29,
    ),
    photo_clients=PHOTO_CLIENTS,
    founded_day=-900,
    catalog_day=-420,
    documents_day=-410,
    restock_days=(-420, -330, -240, -150, -75, -20),
    payouts_from_day=-215,
    invoice_start=1400,
    estimate_start=200,
    cheque_start=500,
    seed=31,
)


# client -> cleaner, weekday, start, every n weeks, visits, visits already done, how they pay
SERIES: dict[str, tuple[str, int, time, int, int, int, Settle]] = {
    "margaret": (JOY, 3, time(9, 0), 2, 14, 10, "etransfer"),
    "jennifer": (JOY, 1, time(13, 30), 2, 12, 8, "card"),
    "omar": (TOMASZ, 4, time(9, 0), 2, 12, 9, "card"),
    "anjali": (TOMASZ, 5, time(9, 30), 1, 26, 22, "card"),
    "hyejin": (HARPREET, 2, time(9, 0), 2, 10, 6, "card"),
}


def _clock(when: datetime) -> str:
    return f"{when:%I:%M %p}".removeprefix("0")


def _email(name: str) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", name.lower()) if c.isascii())
    return f"{plain.replace(' ', '.').replace('-', '')}@example.test"


def _subject_name(address: str) -> str:
    parts = [part.strip() for part in address.split(",")]
    return ", ".join(parts[:2]) if parts[0].startswith("Unit") else parts[0]


def _generated(index: int) -> Household:
    first, last = PEOPLE[index]
    street, postal = STREETS[index % len(STREETS)]
    number = 104 + (index * 173) % 2900
    home = "Townhouse" if index % 5 == 3 else "House"
    code = f"{(index * 7919) % 9000 + 1000}"
    entry = ENTRIES[index % len(ENTRIES)].format(code=code, alarm=f"{(index * 31) % 90 + 10}00")
    return Household(
        f"home_{index:02}",
        f"{first} {last}",
        f"{number} {street}, Calgary, AB {postal}",
        home,
        6 if home == "Townhouse" else 8,
        entry,
        "A dog at home; keep the yard gate shut." if index % 6 == 2 else None,
    )


def _attributes(home: Household) -> dict[str, object]:
    attributes = PropertyAttributes(
        address=home.address, rooms=home.rooms, access=home.access, pets=home.pets
    )
    return attributes.model_dump(mode="json", exclude_none=True)


def _mothers_day(today: date) -> date:
    """The latest Mother's Day (the second Sunday in May) at least a month before today."""
    year = today.year if today >= date(today.year, 6, 15) else today.year - 1
    first = date(year, 5, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7)


class Brightwater(Demo):
    spec = SPEC

    def story(self) -> None:
        self.households()
        self.regulars()
        self.today_jobs()
        self.storyline()
        self.property_manager()
        self.moves()
        self.upcoming()
        self.tips(self.fill(self.routine_clients()))
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

    def households(self) -> None:
        for home in (*NAMED, *(_generated(i) for i in range(GENERATED))):
            self.household(home)
        self.household(PRAIRIE_LANE, tags=["property manager"])
        self.ctx.get(Subject, "sj_bw_prairielane").name = "Unit 304, Sunnyside"
        for key, name, address, access in UNITS:
            unit = Household(key, name, address, "Condo or apartment", 4, access)
            self.subject(key, "prairielane", name, _attributes(unit))
        self.ctx.get(Client, "cl_bw_daniel").created_at = self.now - timedelta(days=4)
        self.ctx.get(Client, "cl_bw_wei").created_at = self.now - timedelta(days=12)

    def household(self, home: Household, *, tags: list[str] | None = None) -> None:
        index = len(self.ctx.all(Client))
        self.client(
            home.key,
            home.name,
            home.email or _email(home.name),
            home.phone or f"+1403555{100 + index:04}",
            tags=tags or [],
            channel="email" if tags or index % 3 == 0 else "sms",
            fields={"source": ("referral", "google", "neighbourhood group")[index % 3]},
            subject=_subject_name(home.address),
            attributes=_attributes(home),
        )

    def routine_clients(self) -> list[str]:
        busy = {"sofia", "daniel", "wei", "teresita", "jasmine", "prairielane", *SERIES}
        named = [h.key for h in NAMED if h.key not in busy]
        generated = [f"home_{i:02}" for i in range(GENERATED) if i not in MOVERS and i != DECLINED]
        return [*named, *generated]

    def regulars(self) -> None:
        for key, (staff, weekday, at, every, visits, before, settle) in SERIES.items():
            self.series(
                key,
                key,
                RECURRING,
                staff,
                weekday=weekday,
                at=at,
                every=every,
                visits=visits,
                before=before,
                settle=settle,
            )
        self.note(
            "cl_bw_margaret",
            "client",
            "Every second Thursday with Joy. Margaret leaves the e-Transfer the next morning. "
            "Rotate baseboards, the microwave and the fridge shelves.",
            self.at(-140, 12),
        )

    def today_jobs(self) -> None:
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        plan = ((JOY, "linh", -60), (HARPREET, "chidi", 30), (TOMASZ, "kateryna", 90))
        length = timedelta(minutes=self.items[STANDARD].duration_min or 150)
        starts = {
            staff: (floor + timedelta(minutes=offset)).astimezone(UTC) for staff, _, offset in plan
        }
        today = all(
            self.within_hours(staff, starts[staff], starts[staff] + length)
            and self.free(staff, f"sj_bw_{key}", starts[staff], starts[staff] + length, 0, 30)
            for staff, key, _ in plan
        )
        jobs: dict[str, Booking] = {}
        for staff, key, _ in plan:
            start = starts[staff]
            if not today:
                found = self.place(staff, STANDARD, 1, f"sj_bw_{key}", past=False)
                assert found is not None
                start = found
            created = min(start - timedelta(days=9), self.now - timedelta(days=2))
            jobs[key] = self.book(key, key, STANDARD, staff, start, "confirmed", created)
        if today:
            linh, chidi = jobs["linh"], jobs["chidi"]
            linh.departed_at = linh.starts_at - timedelta(minutes=22)
            linh.checked_in_at = linh.starts_at + timedelta(minutes=3)
            chidi.departed_at = self.now - timedelta(minutes=8)
        for key, body in (
            (
                "linh",
                "Lockbox by the side door, code 3190. No alarm. Mochi stays upstairs, so keep "
                "the bedroom door closed. Linh asked for the oven racks to soak if there's time.",
            ),
            (
                "chidi",
                "Chidi works from home and will let you in. Zara (boxer) is in the back yard. "
                "Focus on the kitchen and both bathrooms; the basement is off limits this time.",
            ),
            (
                "kateryna",
                "Key under the blue planter by the back door. Alarm panel in the back hall, code "
                "2207, then Off, and set it again when you leave.",
            ),
        ):
            self.note(jobs[key].id, "booking", body, jobs[key].created_at)

    def clean(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        staff: str,
        day: int,
        settle: Settle,
        *,
        tip: tuple[str, int] | None = None,
        note: str | None = None,
    ) -> Booking:
        """A past clean with its add-ons and products on one invoice."""
        booking = self.visit(key, client_key, quote.service, staff, day, settle=None, note=note)
        assert booking is not None and booking.completed_at is not None
        item = self.items[quote.service]
        invoice = self.invoice(
            key,
            client_key,
            booking.completed_at + timedelta(minutes=20),
            booking.created_at,
            self.visit_note(item, booking),
        )
        booking.invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booking.created_at, booking=booking)
        self.settle(invoice, client_key, settle, tip=tip)
        return booking

    def extras(self, booking: Booking, parts: tuple[tuple[str, int], ...]) -> None:
        """Add-ons a client picked when booking, which checkout bills with the clean."""
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

    def storyline(self) -> None:
        self.lead()
        self.quotes()
        self.tap_to_pay()
        self.late_cancel()
        self.feedback_stories()
        self.mothers_day()
        self.refund_story()

    def lead(self) -> None:
        start = self.place(JOY, STANDARD, 3, "sj_bw_sofia", past=False)
        assert start is not None
        created = self.now - timedelta(hours=20)
        sofia = self.book(
            "sofia", "sofia", STANDARD, JOY, start, "pending", created, source="online"
        )
        self.extras(sofia, ((FRIDGE, 1),))
        submitted = created + timedelta(hours=2)
        self.response(
            "home",
            "sofia",
            HOME_FORM,
            sofia,
            {
                "address": "3615 19 Street SW, Calgary, AB T2T 4X9",
                "home_type": "House",
                "bedrooms": 3,
                "bathrooms": 2,
                "square_feet": 1650,
                "service": "Standard clean",
                "entry": "Lockbox",
                "entry_details": "Lockbox on the back gate, code 8823. Please park in the lane.",
                "alarm": "No alarm",
                "pets": "Cat",
                "pet_notes": "Pepper hides under the bed. Please keep the front door closed.",
                "priorities": ["Kitchen", "Bathrooms", "Floors"],
                "products": "Your fragrance-free products are fine",
                "skip": "The basement storage room.",
                "start_date": self.local(start).date().isoformat(),
            },
            submitted,
            created=created + timedelta(minutes=5),
        )
        self.sign(
            "sofia", "sofia", AGREEMENT, submitted + timedelta(minutes=10), None, status="pending"
        )

    def quotes(self) -> None:
        ctx = self.ctx
        requested = self.now - timedelta(days=3, hours=20)
        response_id = "fr_bw_home_daniel"
        answers: dict[str, object] = {
            "address": "Unit 1408, 1111 10 Street SW, Calgary, AB T2R 1E2",
            "home_type": "Condo or apartment",
            "bedrooms": 2,
            "bathrooms": 2,
            "square_feet": 940,
            "service": "Move-out clean",
            "entry": "Concierge or building manager",
            "entry_details": "The concierge will have a key under Eze from October 30.",
            "alarm": "No alarm",
            "pets": "No pets",
            "priorities": ["Kitchen", "Bathrooms", "Inside appliances"],
            "products": "Your fragrance-free products are fine",
            "start_date": self.local(self.now + timedelta(days=11)).date().isoformat(),
        }
        for field, asset in (
            ("photo_kitchen", "bw_photo_kitchen.jpg"),
            ("photo_bathroom", "bw_photo_bathroom.jpg"),
        ):
            file_id = f"fl_bw_daniel_{field}"
            ctx.add(
                File(
                    id=file_id,
                    business_id=BRIGHTWATER,
                    parent_type="form_response",
                    parent_id=response_id,
                    purpose="attachment",
                    s3_key=f"{BRIGHTWATER}/demo/{asset}",
                    content_type="image/jpeg",
                    size=(ASSETS / asset).stat().st_size,
                    created_at=requested - timedelta(minutes=6),
                    updated_at=requested - timedelta(minutes=5),
                )
            )
            answers[field] = file_id
        ctx.add(
            FormResponse(
                id=response_id,
                business_id=BRIGHTWATER,
                form_id=HOME_FORM,
                client_id="cl_bw_daniel",
                parent_type="subject",
                parent_id="sj_bw_daniel",
                status="submitted",
                token="demo_home_bw_daniel",
                answers=answers,
                opened_at=requested - timedelta(minutes=20),
                submitted_at=requested,
                created_at=requested - timedelta(minutes=30),
                updated_at=requested,
            )
        )
        sent = requested + timedelta(hours=22)
        self.estimate(
            "daniel",
            "daniel",
            Quote(MOVE_OUT, ((OVEN, 1), (FRIDGE, 1))),
            sent,
            status="sent",
            note="Two-bedroom condo, empty from October 31. Inside the oven and fridge are "
            "included as we discussed; the windows and the balcony are optional.",
            optional=(
                (WINDOWS, 1, "Inside windows and tracks", 6000),
                (None, 1, "Balcony swept and glass door cleaned outside", 3500),
            ),
        )
        self.sign(
            "daniel", "daniel", AGREEMENT, sent + timedelta(minutes=5), None, status="pending"
        )
        pending = ctx.get(Signature, "sig_bw_daniel")
        pending.opened_at = min(sent + timedelta(hours=4), self.now - timedelta(hours=1))
        # accepted and booked, with a deposit held against the date
        quote = Quote(MOVE_OUT, ((OVEN, 1), (FRIDGE, 1), (WINDOWS, 1)))
        quoted = self.now - timedelta(days=8, hours=3)
        accepted = quoted + timedelta(days=1, hours=5)
        estimate = self.estimate(
            "wei",
            "wei",
            quote,
            quoted,
            status="accepted",
            decided=accepted,
            note="Two-bedroom condo in Mission, empty from the morning of the clean. Oven, fridge "
            "and inside windows included.",
        )
        self.sign("wei", "wei", AGREEMENT, accepted + timedelta(minutes=20), None)
        start = self.place(HARPREET, MOVE_OUT, 5, "sj_bw_wei", past=False)
        assert start is not None
        booked = accepted + timedelta(minutes=40)
        wei = self.book("wei", "wei", MOVE_OUT, HARPREET, start, "confirmed", booked)
        self.addons(wei, estimate, quote)
        self.deposit(wei, booked + timedelta(minutes=10))
        self.note(
            wei.id,
            "booking",
            "Keys from the concierge. Book the service elevator for 8:30 with the front desk. The "
            "landlord's inspection is the next morning, so photos of the oven and fridge when "
            "done, please.",
            booked,
        )

    def tap_to_pay(self) -> None:
        self.visit("amara_first", "amara", DEEP, BOSS, -64, settle="card")
        booking = self.visit("amara", "amara", STANDARD, JOY, -2, settle=None)
        assert booking is not None and booking.completed_at is not None
        paid = booking.completed_at + timedelta(minutes=8)
        self.sale(
            "amara",
            "amara",
            JOY,
            Quote(STANDARD, ((OVEN, 1), (REFILL, 1))),
            booking,
            booking.created_at,
            paid,
            tip=(JOY, 2500),
        )
        self.note(
            booking.id,
            "booking",
            "Amara added the oven on the day and bought a refill. Paid on Joy's phone with Tap "
            "to Pay, with a tip.",
            paid,
        )

    def late_cancel(self) -> None:
        self.clean("brandon_first", "brandon", Quote(DEEP), HARPREET, -96, "card")
        self.visit("brandon_june", "brandon", STANDARD, HARPREET, -60, settle="card")
        start = self.place(HARPREET, STANDARD, -12, "sj_bw_brandon", past=True)
        assert start is not None
        created = start - timedelta(days=8)
        booking = self.book(
            "brandon_late", "brandon", STANDARD, HARPREET, start, "canceled", created
        )
        canceled = start - timedelta(hours=3, minutes=20)
        booking.canceled_at = booking.updated_at = canceled
        self.note(
            booking.id,
            "booking",
            f"Brandon texted at {_clock(self.local(canceled))} to cancel. That's under 24 hours' "
            "notice, so the $50 late cancellation fee applies.",
            canceled + timedelta(minutes=5),
        )
        invoice = self.invoice(
            "brandon_late",
            "brandon",
            canceled + timedelta(hours=1),
            canceled + timedelta(minutes=50),
            "Late cancellation fee for the clean booked on "
            f"{self.local(start):%B} {self.local(start).day}, cancelled with under 24 hours' "
            "notice.",
        )
        booking.invoice_id = invoice.id
        self.ctx.add(
            Line(
                id=f"ln_{invoice.id}_0",
                business_id=BRIGHTWATER,
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
        self.settle(invoice, "brandon", "card")

    def feedback_stories(self) -> None:
        fatima = self.clean(
            "fatima",
            "fatima",
            Quote(STANDARD, ((FRIDGE, 1),)),
            HARPREET,
            -6,
            "card",
            tip=(HARPREET, 2000),
        )
        self.feedback(
            "fatima",
            fatima,
            5,
            ["Kitchen", "Bathrooms", "Care with our things"],
            "Harpreet was careful around the kids' things and the fridge looks new. Thank you.",
        )
        self.review("fatima")
        kevin = self.clean("kevin", "kevin", Quote(DEEP, ((OVEN, 1),)), TOMASZ, -9, "card")
        self.feedback(
            "kevin",
            kevin,
            3,
            ["Kitchen", "On time"],
            "The kitchen and oven were great. The baseboards in the main bathroom and the floor "
            "behind the toilet were missed, which is most of why we booked a deep clean.",
            follow_up=True,
        )
        assert kevin.completed_at is not None
        start = self.place(TOMASZ, TOUCH_UP, -7, "sj_bw_kevin", past=True, forward=True)
        assert start is not None
        reclean = self.book(
            "kevin_reclean",
            "kevin",
            TOUCH_UP,
            TOMASZ,
            start,
            "completed",
            kevin.completed_at + timedelta(hours=22),
            price=0,
        )
        self.note(
            reclean.id,
            "booking",
            "Re-clean at no charge: main bathroom baseboards and behind the toilet, missed on the "
            "deep clean. Send Kevin a photo when done.",
            reclean.created_at,
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

    def mothers_day(self) -> None:
        sunday = _mothers_day(self.local(self.now).date())
        bought = datetime.combine(sunday - timedelta(days=4), time(20, 15), self.ctx.zone)
        card = self.gift_card(
            "mom", "jasmine", GIFT, 20000, bought.astimezone(UTC), recipient="Teresita Cruz"
        )
        self.visit("jasmine_spring", "jasmine", STANDARD, JOY, self.days_to(bought) - 30)
        day = self.days_to(bought) + 9
        clean = self.visit(
            "teresita_gift",
            "teresita",
            STANDARD,
            JOY,
            day,
            settle=None,
            price=0,
            note="Mother's Day gift from Jasmine (gift card BW-GIFT-MOM). Redeem $173.25 for the "
            "clean with GST; the rest stays on the card.",
        )
        assert clean is not None and clean.completed_at is not None
        self.redeem(card, 17325, clean.completed_at + timedelta(minutes=15))
        self.visit("teresita_summer", "teresita", STANDARD, JOY, day + 70, settle="etransfer")
        self.gift_card(
            "housewarming",
            "samuel",
            GIFT,
            15000,
            self.at(-26, 18),
            recipient="Ama Mensah",
        )

    def days_to(self, when: datetime) -> int:
        return (self.local(when).date() - self.local(self.now).date()).days

    def refund_story(self) -> None:
        booking = self.clean("rachel", "rachel", Quote(DEEP, ((OVEN, 1),)), TOMASZ, -40, "card")
        self.note(
            booking.id,
            "booking",
            "The oven was locked in its self-clean cycle when Tomasz arrived, so it wasn't done. "
            "Refund the oven add-on.",
            (booking.completed_at or self.now) - timedelta(minutes=30),
        )
        payment = next(p for p in self.ctx.all(Payment) if p.invoice_id == booking.invoice_id)
        assert payment.paid_at is not None
        self.refund(
            payment,
            4725,
            payment.paid_at + timedelta(hours=20),
            "Inside the oven wasn't done: it was mid self-clean when we arrived.",
        )

    def property_manager(self) -> None:
        units: tuple[tuple[str, str, int, str, Settle], ...] = (
            ("prairielane_beltline", "sj_bw_prairielane_beltline", -128, TOMASZ, "etransfer"),
            ("prairielane_bridgeland", "sj_bw_prairielane_bridgeland", -92, HARPREET, "etransfer"),
            ("prairielane_mission", "sj_bw_prairielane_mission", -62, TOMASZ, "etransfer"),
            ("prairielane_sunnyside", "sj_bw_prairielane", -36, TOMASZ, "overdue"),
            ("prairielane_beltline_oct", "sj_bw_prairielane_beltline", -4, HARPREET, "open"),
            ("prairielane_bridgeland_nov", "sj_bw_prairielane_bridgeland", 9, TOMASZ, "card"),
        )
        for key, subject, day, staff, settle in units:
            booking = self.visit(
                key,
                "prairielane",
                MOVE_OUT,
                staff,
                day,
                settle=settle,
                subject=subject,
                price=32500,
            )
            assert booking is not None
            if booking.completed_at is not None and day < -30:
                self.checklist(key, booking, keys="Back in the lockbox; fob returned to the office")
        self.note(
            "cl_bw_prairielane",
            "client",
            "Invoices go to units.prairielane@example.test and are paid by e-Transfer within 14 "
            "days. Book move-outs the day after the tenant leaves; the office sends the fob.",
            self.at(-130, 11),
        )

    def checklist(self, key: str, booking: Booking, *, keys: str) -> None:
        assert booking.completed_at is not None
        client = self.ctx.get(Client, booking.client_id)
        parts = {a.item_id for a in self.ctx.all(Addon) if a.booking_id == booking.id} | {
            line.item_id
            for line in self.ctx.all(Line)
            if line.invoice_id is not None and line.invoice_id == booking.invoice_id
        }
        submitted = booking.completed_at - timedelta(minutes=5)
        self.response(
            "move_out",
            key,
            CHECKLIST_FORM,
            booking,
            {
                "clean_date": self.local(booking.starts_at).date().isoformat(),
                "oven": OVEN in parts or "prairielane" in key,
                "fridge": FRIDGE in parts or "prairielane" in key,
                "cabinets": True,
                "bathrooms": True,
                "baseboards": True,
                "windows": True,
                "floors": True,
                "walls": "Spot-cleaned" if len(key) % 3 else "Marks remain that need paint",
                "keys": keys,
                "rating": 5 if len(key) % 4 else 4,
            },
            submitted,
            opened=submitted - timedelta(minutes=6),
            created=submitted - timedelta(minutes=15),
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.61"},
        )

    def moves(self) -> None:
        quotes = (
            Quote(MOVE_OUT, ((OVEN, 1), (FRIDGE, 1))),
            Quote(MOVE_IN, ((FRIDGE, 1),)),
            Quote(MOVE_OUT, ((OVEN, 1), (FRIDGE, 1), (WINDOWS, 1))),
            Quote(MOVE_IN, ((OVEN, 1), (FRIDGE, 1))),
        )
        staff = (TOMASZ, HARPREET, TOMASZ, JOY)
        for offset, index in enumerate(MOVERS):
            key = f"home_{index:02}"
            quote = quotes[offset % len(quotes)]
            self.moved(
                key,
                quote,
                quote_day=-200 + offset * 24 + self.rng.randint(0, 4),
                staff=staff[offset % len(staff)],
                settle=SETTLEMENTS[offset % len(SETTLEMENTS)],
            )
        declined = f"home_{DECLINED:02}"
        estimate = self.estimate(
            declined,
            declined,
            Quote(MOVE_OUT, ((OVEN, 1), (FRIDGE, 1))),
            self.at(-23, 14),
            status="declined",
            decided=self.at(-19, 9),
            note="Three-bedroom house, empty from the 30th.",
        )
        estimate.decline_reason = "Our moving company is including a clean, so we won't need it."
        self.joined(declined, self.at(-24, 12))
        lockout = f"home_{LOCKOUT:02}"
        missed = self.visit(
            f"{lockout}_lockout",
            lockout,
            STANDARD,
            HARPREET,
            -33,
            status="no_show",
            settle=None,
            note="Locked out: the lockbox code didn't open it and no one answered the phone. "
            "Waited 20 minutes, then left.",
        )
        assert missed is not None

    def moved(self, key: str, quote: Quote, *, quote_day: int, staff: str, settle: Settle) -> None:
        """A move-out or move-in from its estimate: accepted, deposit held, cleaned and invoiced."""
        sent = self.at(quote_day, 15)
        accepted = sent + timedelta(days=1, hours=3)
        estimate = self.estimate(
            key,
            key,
            quote,
            sent,
            status="accepted",
            decided=accepted,
            note="Quoted from your photos. The deposit holds the date and comes off the invoice.",
        )
        self.joined(key, sent - timedelta(days=1))
        start = self.place(
            staff,
            quote.service,
            quote_day + 10,
            f"sj_bw_{key}",
            past=True,
            not_before=accepted + timedelta(days=2),
        ) or self.place(
            staff,
            quote.service,
            quote_day + 10,
            f"sj_bw_{key}",
            past=True,
            not_before=accepted + timedelta(days=2),
            forward=True,
        )
        assert start is not None
        booked = accepted + timedelta(minutes=40)
        booking = self.book(key, key, quote.service, staff, start, "completed", booked)
        assert booking.completed_at is not None
        self.deposit(booking, booked + timedelta(minutes=10))
        address = self.ctx.get(Subject, f"sj_bw_{key}").attributes.get("address", "")
        invoice = self.invoice(
            key,
            key,
            booking.completed_at + timedelta(minutes=30),
            booked,
            f"{self.items[quote.service].name} at {address}. The deposit is applied.",
        )
        booking.invoice_id = estimate.converted_invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booked, booking=booking)
        self.settle(invoice, key, settle)
        if quote.service == MOVE_OUT:
            self.checklist(key, booking, keys="Left on the kitchen counter for the landlord")

    def upcoming(self) -> None:
        for key, staff, day, item, parts in (
            ("priya_deep", BOSS, 4, DEEP, ((OVEN, 1), (FRIDGE, 1))),
            ("luis_windows", JOY, 6, STANDARD, ((WINDOWS, 1),)),
            ("olivia_laundry", HARPREET, 3, STANDARD, ((LAUNDRY, 2),)),
            ("grace_refill", JOY, 8, STANDARD, ((REFILL, 1), (CLOTHS, 1))),
        ):
            booking = self.visit(key, key.split("_")[0], item, staff, day)
            assert booking is not None
            self.extras(booking, parts)
        mover = f"home_{GENERATED - 1:02}"
        booking = self.visit(
            "kateryna_holiday",
            "kateryna",
            DEEP,
            BOSS,
            24,
            note="Holiday deep clean before family arrives. Include inside the cabinets.",
        )
        assert booking is not None
        newcomer = self.visit(f"{mover}_first", mover, STANDARD, TOMASZ, 7)
        assert newcomer is not None
        self.response("home", mover, HOME_FORM, newcomer, {}, None)

    def tips(self, made: list[Booking]) -> None:
        """About one in six card payments carries a tip for the cleaner."""
        by_invoice = {p.invoice_id: p for p in self.ctx.all(Payment) if p.method == "card"}
        for index, booking in enumerate(made):
            payment = by_invoice.get(booking.invoice_id)
            if payment is None or index % 6:
                continue
            cents = (1000, 1500, 2000, 2500)[index // 6 % 4]
            payment.tip_cents = cents
            payment.tip_split = [{"staff_id": booking.staff_id, "cents": cents}]

    def paperwork(self) -> None:
        """Every client signs the agreement at their first booking; regulars authorize keys."""
        ctx = self.ctx
        first: dict[str, datetime] = {}
        for booking in ctx.all(Booking):
            client = booking.client_id
            first[client] = min(first.get(client, booking.created_at), booking.created_at)
        signed = {s.client_id for s in ctx.all(Signature) if s.contract_id == AGREEMENT}
        for client_id, when in sorted(first.items()):
            if client_id in signed:
                continue
            key = client_id.removeprefix("cl_bw_")
            at = min(when + timedelta(minutes=40), self.now - timedelta(hours=2))
            self.sign(key, key, AGREEMENT, at, None)
        for key in (
            "margaret",
            "jennifer",
            "omar",
            "hyejin",
            "kateryna",
            "linh",
            "kevin",
            "prairielane",
        ):
            when = first[self.client_id(key)] + timedelta(hours=1)
            self.sign(f"{key}_keys", key, KEYS, when, None)
        self.sign(
            "home_03_keys",
            "home_03",
            KEYS,
            first[self.client_id("home_03")] + timedelta(hours=2),
            None,
            status="declined",
        )
        self.sign(
            "sofia_keys", "sofia", KEYS, self.now - timedelta(hours=6), None, status="pending"
        )
        for client_id, when in first.items():
            key = client_id.removeprefix("cl_bw_")
            if key in {"sofia", "daniel", "wei", "prairielane"}:
                continue
            bookings = sorted(
                (b for b in ctx.all(Booking) if b.client_id == client_id),
                key=lambda b: b.created_at,
            )
            earliest = bookings[0]
            if earliest.created_at != when or key.startswith("home_2"):
                continue
            if any(r.client_id == client_id for r in ctx.all(FormResponse)):
                continue
            self.home_answers(key, earliest)
        self.notes()

    def home_answers(self, key: str, booking: Booking) -> None:
        subject = self.ctx.get(Subject, booking.subject_id or "")
        attributes = subject.attributes
        access = str(attributes.get("access", ""))
        pets = attributes.get("pets")
        home = next(
            (h.home for h in (*NAMED, *(_generated(i) for i in range(GENERATED))) if h.key == key),
            "House",
        )
        alarm = next((s for s in access.split(". ") if "alarm panel" in s.lower()), None)
        animal = str(pets or "").lower()
        submitted = min(booking.created_at + timedelta(hours=3), self.now - timedelta(hours=1))
        answers: dict[str, object] = {
            "address": str(attributes.get("address", "")),
            "home_type": home,
            "bedrooms": 2 if home in {"Townhouse", "Condo or apartment"} else 3,
            "bathrooms": 2 if home != "Condo or apartment" else 1,
            "service": "Recurring clean"
            if self.ctx.get(Slot, booking.slot_id).recurrence_id
            else "Deep clean"
            if self.ctx.get(Slot, booking.slot_id).item_id == DEEP
            else "Standard clean",
            "entry": "I'll be home"
            if "home" in access.lower()
            else "Garage or door code"
            if "garage" in access.lower() or "door code" in access.lower()
            else "Concierge or building manager"
            if "concierge" in access.lower() or "fob" in access.lower()
            else "Lockbox",
            "entry_details": access,
            "alarm": "No alarm" if alarm is None else "Yes, code below",
            "pets": "No pets"
            if not animal
            else "Cat"
            if "cat" in animal
            else "Dog"
            if any(word in animal for word in ("dog", "retriever", "boxer", "beagle", "husky"))
            else "Other",
            "priorities": ["Kitchen", "Bathrooms"]
            if len(key) % 2
            else ["Kitchen", "Floors", "Dusting"],
            "products": "Your fragrance-free products are fine"
            if len(key) % 5
            else "Please use the products I leave out",
        }
        if pets:
            answers["pet_notes"] = str(pets)
        if alarm is not None:
            answers["alarm_details"] = alarm.removesuffix(".")
        self.response("home", key, HOME_FORM, booking, answers, submitted)

    def notes(self) -> None:
        for key, body in (
            (
                "omar",
                "Biscuit goes to daycare on clean days. Set the alarm to Away when leaving.",
            ),
            (
                "kevin",
                "Deep clean feedback was 3 stars for missed bathroom baseboards. Re-clean done at "
                "no charge; check the baseboards on every visit.",
            ),
            ("rachel", "Ask before using any spray near the den; the parrot is sensitive to it."),
            (
                "brandon",
                "Late cancellation fee charged once. Remind him about the 24-hour window when "
                "booking.",
            ),
            ("anjali", "Weekly on Saturdays with Tomasz. The family is home; start upstairs."),
        ):
            self.note(self.client_id(key), "client", body, self.now - timedelta(days=3))

    def engagement(self) -> None:
        self.consents()
        self.withdraw("home_05", "email", self.now - timedelta(days=41))
        self.broadcast(
            "spring",
            "Spring deep cleans",
            "Spring is when most of our clients book a deep clean. If you'd like the baseboards, "
            "inside cabinets, the oven or the inside windows done this spring, book a deep clean "
            "online or reply to this email and we'll find a time. Regular clients can add any "
            "of these to their next visit instead.",
            self.at(-190, 10),
        )
        self.reviews()
        self.conversations()

    def reviews(self) -> None:
        ctx = self.ctx
        happy = (
            ("margaret", 5, ["Kitchen", "On time", "Communication"], None),
            ("anjali", 5, ["Floors", "On time"], "Tomasz is always on time and thorough."),
            ("omar", 5, ["Kitchen", "Bathrooms"], None),
            ("priya", 5, ["Bathrooms", "Care with our things"], "Leo was very calm with Joy."),
            ("luis", 4, ["Kitchen", "Floors"], "Great clean. It ran about 20 minutes late."),
            ("grace", 5, ["Kitchen", "Communication"], None),
            ("samuel", 5, ["Floors", "Bathrooms"], None),
            ("elena", 5, ["Kitchen", "Care with our things"], "Thank you for the careful work."),
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
                    and b.price_cents
                ),
                key=lambda b: b.completed_at or self.now,
            )
            if not done:
                continue
            booking = done[-1]
            self.feedback(key, booking, rating, highlights, comment)
            if rating == 5:
                self.review(booking.id.removeprefix("bk_bw_"))
        for key in ("amara", "teresita_gift"):
            self.review(key)
        luis = next(r for r in ctx.all(FormResponse) if r.id == "fr_bw_feedback_luis")
        if luis.submitted_at is not None:
            when = luis.submitted_at + timedelta(hours=2)
            staff = ctx.get(Booking, luis.parent_id or "").staff_id
            cleaner = next(p.name.split()[0] for p in SPEC.people if p.staff_id == staff)
            thread = self.thread("luis", "email", when)
            self.say(
                thread,
                f"Thanks for the feedback, Luis, and sorry about the late start. {cleaner}'s "
                "clean before yours ran over. We've left more time before your visits from now "
                "on.",
                when,
                sender=BRIGHTWATER_OWNER,
            )

    def conversations(self) -> None:
        ctx = self.ctx
        sofia = ctx.get(Booking, "bk_bw_sofia")
        when = sofia.created_at + timedelta(hours=3)
        thread = self.thread("sofia", "email", when)
        self.say(
            thread,
            "Hi, I booked a first clean online and filled in the home details. Is it okay that "
            "our cat will be home? She mostly hides.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Sofia, thanks for the details. Cats are fine; Joy will keep the front door closed "
            "and leave the room she's hiding in for last. We'll confirm your booking today.",
            min(when + timedelta(minutes=40), self.now - timedelta(minutes=30)),
        )
        daniel = ctx.get(Estimate, "est_bw_daniel")
        when = daniel.created_at + timedelta(minutes=10)
        thread = self.thread("daniel", "email", when)
        self.say(
            thread,
            "Hi Daniel, your move-out quote is ready. The oven and fridge are included; the "
            "inside windows and the balcony are optional, so you can tick them when you accept.",
            when,
        )
        self.say(
            thread,
            "Thanks. Does the price include inside the kitchen cabinets? The landlord checks "
            "those.",
            min(when + timedelta(hours=3), self.now - timedelta(minutes=50)),
            sender=None,
        )
        self.say(
            thread,
            "Yes, every cabinet, drawer and closet is wiped inside on a move-out clean.",
            min(when + timedelta(hours=4), self.now - timedelta(minutes=25)),
        )
        chidi = ctx.get(Booking, "bk_bw_chidi")
        if chidi.departed_at is not None:
            thread = self.thread("chidi", "sms", chidi.departed_at)
            self.say(
                thread,
                "Hi Chidi, Harpreet from Brightwater is on her way and should be there in about "
                "20 minutes.",
                chidi.departed_at,
                sender="us_bw_harpreet",
            )
            self.say(
                thread,
                "Great, see you soon.",
                chidi.departed_at + timedelta(minutes=2),
                sender=None,
            )
        linh = ctx.get(Booking, "bk_bw_linh")
        when = min(linh.created_at + timedelta(days=1), self.now - timedelta(days=1))
        thread = self.thread("linh", "sms", when)
        self.say(
            thread,
            "Hi, could we move this week's clean back a day? I have a contractor coming in.",
            when,
            sender=None,
        )
        self.say(
            thread,
            f"No problem, Linh. You're now booked for {self.local(linh.starts_at):%A} at "
            f"{_clock(self.local(linh.starts_at))} with Joy.",
            when + timedelta(minutes=12),
        )
        teresita = ctx.get(Booking, "bk_bw_teresita_gift")
        if teresita.completed_at is not None:
            when = teresita.completed_at + timedelta(hours=4)
            thread = self.thread("teresita", "sms", when)
            self.say(
                thread,
                "Thank you so much. My daughter gave me this for Mother's Day and the house "
                "hasn't looked this good in years. Joy was lovely.",
                when,
                sender=None,
            )
            self.say(
                thread,
                "Thank you, Teresita, we're glad you enjoyed it. There's $26.75 left on the gift "
                "card for your next visit.",
                when + timedelta(minutes=30),
            )
        kevin = ctx.get(FormResponse, "fr_bw_feedback_kevin")
        reclean = ctx.get(Booking, "bk_bw_kevin_reclean")
        if kevin.submitted_at is not None:
            when = kevin.submitted_at + timedelta(hours=1)
            thread = self.thread("kevin", "email", when)
            self.say(
                thread,
                "Hi Kevin, thank you for telling us, and I'm sorry the bathroom baseboards and "
                "the floor behind the toilet were missed. That should have been part of the deep "
                f"clean. Tomasz can come back on {self.local(reclean.starts_at):%A} to do them at "
                "no charge. Does that work?",
                when,
                sender=BRIGHTWATER_OWNER,
            )
            self.say(
                thread,
                "Yes, that works. Thanks for the quick reply.",
                when + timedelta(hours=2),
                sender=None,
            )
            if reclean.completed_at is not None:
                self.say(
                    thread,
                    "Tomasz has finished the baseboards and behind the toilet, and sent the "
                    "photos. Thanks again for letting us know.",
                    reclean.completed_at + timedelta(minutes=20),
                    sender=BRIGHTWATER_OWNER,
                )
        brandon = ctx.get(Booking, "bk_bw_brandon_late")
        if brandon.canceled_at is not None:
            when = brandon.canceled_at
            thread = self.thread("brandon", "sms", when)
            self.say(
                thread,
                "Sorry, something came up at work and I won't be home today. Can we cancel?",
                when,
                sender=None,
            )
            self.say(
                thread,
                "Hi Brandon, I've cancelled today's clean. Because it's under 24 hours' notice, "
                "the $50 late cancellation fee in our agreement applies. Would you like to book "
                "another day?",
                when + timedelta(minutes=10),
            )
        overdue = ctx.get(Invoice, "inv_bw_prairielane_sunnyside")
        if overdue.overdue_notified_at is not None:
            when = overdue.overdue_notified_at + timedelta(hours=3)
            thread = self.thread("prairielane", "email", when)
            self.say(
                thread,
                f"Hello, invoice {overdue.number} for the move-out clean at Unit 304, 1110 3 "
                "Avenue NW is past due. You can pay by card from the invoice email or by "
                "e-Transfer to hello@brightwater.example.",
                when,
            )
            self.say(
                thread,
                "Thanks for the reminder. The owner's approval came through late; we'll send it "
                "with this month's batch on Friday.",
                when + timedelta(hours=5),
                sender=None,
            )


EDITION = Brightwater
