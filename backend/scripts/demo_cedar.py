"""Cedar Coast Pet Care: a four-person dog walking and pet sitting team in downtown Vancouver."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import ItemKind
from clientbridge.models.clients import Note
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import (
    Booking,
    BookingStatus,
    Recurrence,
    RecurrenceStatus,
    Slot,
    Weekday,
)
from clientbridge.schemas.subjects import PetAttributes
from clientbridge.services.bookings import expand_occurrences
from clientbridge.services.catalog import deposit_cents
from scripts.demo_context import demo_business
from scripts.demo_engine import WEEKDAYS, Demo, Quote
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

CEDAR = "bz_demo_second"
CEDAR_OWNER = "us_cc_owner"
LEILA_USER = "us_cc_leila"

BOSS, AMRIT, TESSA, LEILA = "st_cc_owner", "st_cc_amrit", "st_cc_tessa", "st_cc_leila"
WALK30, WALK60, GROUP30, GROUP60 = (
    "it_cc_walk_30",
    "it_cc_walk_60",
    "it_cc_group_30",
    "it_cc_group_60",
)
DROPIN, PUPPY, OVERNIGHT, MEET = "it_cc_dropin", "it_cc_puppy", "it_cc_overnight", "it_cc_meet"
TREATS, LIGHT = "it_cc_treats", "it_cc_light"
TEN, PLAN, GIFT = "it_cc_ten", "it_cc_plan", "it_cc_gift"
MEET_FORM, SITTING_FORM, FEEDBACK_FORM = "frm_cc_meet", "frm_cc_sitting", "frm_cc_feedback"
AGREEMENT, PLAN_TERMS = "con_cc_service", "con_cc_plan"
WALKS = (WALK30, WALK60, GROUP30, GROUP60, PUPPY, TEN)

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        WALK30,
        "service",
        "Dog Walk, 30 minutes",
        3200,
        30,
        "Walks",
        "A solo walk around your neighbourhood for one dog, or two from the same home. We "
        "send a short note and a photo when we bring them back.",
    ),
    (
        WALK60,
        "service",
        "Dog Walk, 60 minutes",
        4800,
        60,
        "Walks",
        "A longer solo walk, often on the seawall or in Stanley Park, for dogs with energy to "
        "spare. A towel-down and paw wipe at the door are included.",
    ),
    (
        GROUP30,
        "class",
        "Group Walk, 30 minutes",
        2400,
        30,
        "Walks",
        "A short walk with up to three small dogs who get along, for dogs under 10 kg. We "
        "pick up and drop off at home.",
    ),
    (
        GROUP60,
        "class",
        "Group Walk, 60 minutes",
        3400,
        60,
        "Walks",
        "An hour out with up to four dogs who walk well together, usually in a park with an "
        "off-leash area. We pick up and drop off at home.",
    ),
    (
        DROPIN,
        "service",
        "Cat Drop-in Visit",
        3000,
        30,
        "Visits",
        "Thirty minutes at your home: fresh food and water, a clean litter box, play and a "
        "brush if they like it, and a photo for you.",
    ),
    (
        PUPPY,
        "service",
        "Puppy Visit",
        3200,
        30,
        "Visits",
        "A midday visit for puppies under a year old: a potty break, a meal if one is due, "
        "play and some leash practice.",
    ),
    (
        OVERNIGHT,
        "service",
        "Overnight Pet Sitting",
        11500,
        900,
        "Sitting",
        "Leila stays at your home from 6 pm to 9 am, with a walk or play time in the evening "
        "and the morning. Priced per night, and a $50 deposit holds the dates.",
    ),
    (
        MEET,
        "service",
        "Meet and Greet",
        0,
        30,
        "Visits",
        "A free 30-minute visit at your home before the first booking. We meet your pet, go "
        "over their routine and how we get in, and sign the key holding agreement.",
    ),
    (
        TREATS,
        "product",
        "Salmon Training Treats",
        1200,
        None,
        "Shop",
        "Soft, pea-sized salmon treats, about 200 g. The same ones we carry on walks.",
    ),
    (
        LIGHT,
        "product",
        "LED Collar Light",
        1600,
        None,
        "Shop",
        "A rechargeable clip-on light for dark winter walks, with steady and flashing modes.",
    ),
    (
        TEN,
        "package",
        "10 Walks, 30 minutes",
        29500,
        None,
        "Packages",
        "Ten 30-minute solo walks at a lower price per walk, to use within six months.",
    ),
    (
        PLAN,
        "subscription",
        "Monthly Walking Plan",
        56000,
        None,
        "Plans",
        "A 30-minute solo walk every weekday at a set time with the same walker, billed "
        "monthly to the card on file.",
    ),
    (
        GIFT,
        "gift",
        "Gift Card",
        0,
        None,
        "Gift cards",
        "A gift card for any walk, visit or stay, in the amount you choose.",
    ),
)
COLORS = {
    WALK30: "#35576B",
    WALK60: "#2E6670",
    GROUP30: "#5C6B3A",
    GROUP60: "#3F5E50",
    DROPIN: "#A95C43",
    PUPPY: "#A0703A",
    OVERNIGHT: "#3F5E80",
    MEET: "#7D5A82",
    TEN: "#3A7CA5",
    PLAN: "#2E4A3F",
    GIFT: "#A44A5F",
}
# on hand today, low-stock line, unit cost, SKU; the collar lights sit under their line
STOCK: dict[str, tuple[int, int, int, str]] = {
    TREATS: (18, 6, 640, "CC-TRT-SAL"),
    LIGHT: (3, 4, 720, "CC-LED-01"),
}
ONLINE = {WALK30, WALK60, DROPIN, PUPPY, MEET}
BUFFERS = {GROUP60: 30, OVERNIGHT: 0}
# staff, weekday -> (start, end); Leila keeps Friday to Sunday free for overnight stays
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    BOSS: {**{d: (time(8, 0), time(17, 0)) for d in range(5)}, 6: (time(9, 0), time(13, 0))},
    AMRIT: {d: (time(8, 0), time(16, 0)) for d in range(5)},
    TESSA: {**{d: (time(8, 0), time(16, 0)) for d in range(5)}, 5: (time(9, 0), time(14, 0))},
    LEILA: {d: (time(8, 0), time(17, 0)) for d in range(4)},
}
# the agreement's version 2 took effect this many days ago; earlier clients signed version 1
AGREEMENT_REVISED = 90
INTRO = (
    "This agreement covers the dog walks, drop-in visits and pet sitting Cedar Coast Pet Care "
    "provides, and how we look after the keys, fobs and codes you give us. It is demo text for "
    "a fictional business, not legal advice."
)
SERVICES = (
    "Services\nWe provide the visits you book: walks, drop-in visits, puppy visits and "
    "overnight stays. A visit's length is the time we spend with your pet and doesn't include "
    "travel. Walks are on leash on city streets and in parks. Dogs go off leash only in fenced "
    "off-leash areas, and only if you've said yes on the intake form."
)
KEYS = (
    "Keys, fobs and codes\nWe keep keys and fobs in a locked cabinet at our office, each on a "
    "tag with a number and never your name or address. Lockbox and alarm codes are kept in "
    "your client record, and only the person on your visit sees them. We return keys and fobs "
    "within seven days of this agreement ending, or sooner if you ask."
)
HOME = (
    "Your home\nWe lock the doors we used, close any windows we opened and set the alarm if "
    "you've given us the code. If we find a door unlocked, a leak or anything else wrong when "
    "we arrive, we'll tell you right away. Please tell us before a visit if anyone else will "
    "be home or if a code has changed."
)
VET = (
    "Emergencies and vet care\nIf your pet is hurt or unwell and we can't reach you or your "
    "emergency contact, you authorize us to take them to your vet, or to the nearest emergency "
    "clinic if yours is closed, and to approve care up to $1,000. You agree to pay for that "
    "care, and we'll keep trying to reach you the whole time."
)
WEATHER = (
    "Weather and safety\nWe walk in the rain. In extreme heat, wildfire smoke advisories or "
    "snow, we may shorten a walk or turn it into play time indoors, and we'll tell you when we "
    "do. A shortened 60-minute walk is billed at the 30-minute price."
)
CANCEL_V1 = (
    "Cancellations\nPlease cancel or move a walk or visit at least 24 hours before it starts. "
    "Later cancellations are charged half the visit price, and a visit where we can't get in "
    "is charged in full. Overnight stays need seven days' notice to cancel, or the $50 deposit "
    "is kept."
)
CANCEL_V2 = (
    CANCEL_V1 + " Stays between December 18 and January 3 need 14 days' notice, because we "
    "turn other bookings away to hold those dates."
)
PAYMENT = (
    "Payment\nWe invoice after each visit, or every Friday for regular walks, and invoices are "
    "due within 14 days by card, e-Transfer or cash. Packages and the monthly plan are paid in "
    "advance."
)
LIABILITY = (
    "Insurance and liability\nWe're insured for the visits we provide, and every walker has "
    "pet first aid training. We aren't responsible for illness or injury we didn't cause, or "
    "for damage a pet does while loose in the home. Our liability for our own work is limited "
    "to the amount you paid for the visit."
)
ENDING = (
    "Ending the agreement\nEither of us can end this agreement at any time by email. Visits "
    "already booked are charged under the cancellation terms above."
)
AGREEMENT_V1 = "\n\n".join(
    (INTRO, SERVICES, KEYS, HOME, VET, WEATHER, CANCEL_V1, PAYMENT, LIABILITY, ENDING)
)
AGREEMENT_BODY = "\n\n".join(
    (INTRO, SERVICES, KEYS, HOME, VET, WEATHER, CANCEL_V2, PAYMENT, LIABILITY, ENDING)
)
PLAN_BODY = "\n\n".join(
    (
        "These terms cover the Monthly Walking Plan, and add to the key holding and service "
        "agreement you signed at your meet and greet. They are demo text for a fictional "
        "business, not legal advice.",
        "What's included\nA 30-minute solo walk every weekday, Monday to Friday, at the time and "
        "with the walker we agree on. Statutory holidays aren't included, and walks you skip "
        "aren't carried over to the next month.",
        "Billing\nThe plan is billed monthly in advance to the card on file, on the same day "
        "each month. A change in price applies from the next billing date, and we'll email you "
        "30 days before it does.",
        "Changes and pauses\nYou can change the walk time, or pause the plan for a month you're "
        "away, with seven days' notice before the next billing date.",
        "Cancelling\nYou can cancel at any time before the next billing date. The month that has "
        "started isn't refunded.",
    )
)
MEET_FIELDS: tuple[DocField, ...] = (
    ("pet_names", "text", "Your pets' names", None, True, ()),
    ("home_address", "address", "Address for visits", None, True, ()),
    ("vet_clinic", "text", "Veterinary clinic", None, True, ()),
    ("vet_phone", "phone", "Clinic phone number", None, True, ()),
    (
        "emergency_name",
        "text",
        "Emergency contact",
        "Someone nearby who can make decisions if we can't reach you.",
        True,
        (),
    ),
    ("emergency_phone", "phone", "Emergency contact's phone", None, True, ()),
    (
        "behaviour",
        "multiselect",
        "Around other dogs and people",
        None,
        False,
        (
            "Friendly with most dogs",
            "Prefers people to dogs",
            "Reactive on leash",
            "Nervous with strangers",
            "Guards food or toys",
            "Chases cats or squirrels",
        ),
    ),
    (
        "leash",
        "select",
        "On the leash",
        None,
        False,
        (
            "Walks nicely",
            "Pulls at first, then settles",
            "Pulls most of the walk",
            "Needs a front-clip harness",
        ),
    ),
    (
        "recall",
        "select",
        "Recall off leash",
        "We only let dogs off leash in fenced off-leash areas, and only with your permission.",
        False,
        (
            "Comes back every time",
            "Comes back most of the time",
            "Not reliable, keep on leash",
        ),
    ),
    (
        "off_leash",
        "checkbox",
        "You may let my dog off leash in fenced off-leash areas",
        None,
        False,
        (),
    ),
    ("feeding", "longtext", "Feeding, treats and water", None, True, ()),
    ("health", "longtext", "Medications or health notes", None, False, ()),
    (
        "entry",
        "longtext",
        "How do we get in?",
        "Lockbox location and code, a key, a fob or a concierge. Only the person on your visit "
        "sees this.",
        True,
        (),
    ),
    ("alarm", "text", "Alarm instructions", None, False, ()),
    ("photo", "image", "A recent photo of your pet", None, False, ()),
    (
        "key_consent",
        "checkbox",
        "Cedar Coast may keep a key, fob or lockbox code for booked visits",
        None,
        True,
        (),
    ),
)
SITTING_FIELDS: tuple[DocField, ...] = (
    ("leave_date", "date", "The day you leave", None, True, ()),
    ("leave_time", "time", "About what time", None, False, ()),
    ("return_date", "date", "The day you're back", None, True, ()),
    ("return_time", "time", "About what time", None, False, ()),
    ("reach_you", "phone", "Where we can reach you while you're away", None, True, ()),
    (
        "sleeping",
        "select",
        "Where your pet sleeps",
        None,
        True,
        ("In the bedroom", "In their own bed", "In a crate", "Wherever they like"),
    ),
    ("plants_mail", "longtext", "Plants, mail and garbage day", None, False, ()),
    (
        "house_notes",
        "longtext",
        "House notes",
        "Thermostat, lights, rooms that stay closed and anything else we should know.",
        False,
        (),
    ),
    (
        "supplies",
        "checkbox",
        "I've left enough food and medication for the whole stay, plus two extra days",
        None,
        True,
        (),
    ),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was the visit?", None, True, ()),
    ("went_well", "longtext", "What went well?", None, False, ()),
    ("improve", "longtext", "Anything we could do better?", None, False, ()),
    ("share", "checkbox", "You may share this comment on our page", None, False, ()),
)
# breed -> weight in kg and coat
BREEDS: dict[str, tuple[float, str]] = {
    "Shiba Inu": (10, "Double coat"),
    "Labrador Retriever mix": (24, "Short double coat"),
    "Cavapoo": (7.5, "Curly"),
    "Boxer": (29, "Short"),
    "Golden Retriever": (30, "Long double coat"),
    "Border Collie mix": (17, "Medium double coat"),
    "Bernese Mountain Dog": (44, "Long double coat"),
    "Miniature Dachshund": (5, "Smooth"),
    "Domestic Shorthair": (4.6, "Short"),
    "Domestic Longhair": (5.2, "Long"),
    "American Staffordshire Terrier": (27, "Short"),
    "Australian Shepherd": (23, "Medium double coat"),
    "English Springer Spaniel": (21, "Feathered"),
    "Weimaraner": (32, "Short"),
    "Pembroke Welsh Corgi": (12, "Double coat"),
    "Bernedoodle": (14, "Wavy"),
    "Miniature Schnauzer": (8, "Wire"),
    "French Bulldog": (12, "Short"),
    "Siberian Husky": (23, "Double coat"),
    "Samoyed": (25, "Long double coat"),
    "Havanese": (5.5, "Long silky"),
    "Cocker Spaniel": (13, "Feathered"),
    "Rottweiler": (45, "Short double coat"),
    "Pomeranian": (3, "Long double coat"),
    "Irish Terrier": (12, "Wire"),
    "Goldendoodle": (26, "Curly"),
    "Labrador Retriever": (31, "Short double coat"),
    "Vizsla": (24, "Short"),
    "Akita": (38, "Double coat"),
    "Italian Greyhound": (5, "Short"),
    "German Shepherd": (34, "Medium double coat"),
    "Shih Tzu": (6, "Long"),
    "Beagle": (11, "Short"),
    "Chow Chow mix": (22, "Long double coat"),
    "Chihuahua mix": (3.5, "Short"),
    "Standard Poodle": (25, "Curly"),
    "Boston Terrier": (9, "Short"),
    "Jindo": (18, "Double coat"),
    "Bichon Frise": (6, "Curly"),
    "Maltese": (3.5, "Long silky"),
    "Australian Cattle Dog": (20, "Short double coat"),
    "Labradoodle": (23, "Wavy"),
    "Cavalier King Charles Spaniel": (8, "Feathered"),
    "Greyhound": (30, "Short"),
    "Doberman": (36, "Short"),
    "Pug": (8, "Short"),
    "Ragdoll": (6.5, "Long"),
    "Siamese": (4.2, "Short"),
}
STYLES = {
    "Long silky": "Keep the topknot clipped up on walks",
    "Double coat": "Brush out after wet walks; no shaving",
    "Curly": "Comb out burrs after park walks",
    "Wire": "Hand-stripped by the groomer; towel only",
    "Long": "Comb through after walks",
    "Short": "Towel and paw wipe after walks",
    "Feathered": "Check ears and feathers for burrs",
    "Wavy": "Brush out after the beach",
    "Smooth": "Towel dry in the rain; wears a coat",
}
VETS = (
    ("Seawall Animal Hospital", "+12365550101"),
    ("Davie Village Veterinary Clinic", "+12365550102"),
    ("False Creek Pet Hospital", "+12365550103"),
    ("Laurel Street Animal Clinic", "+12365550104"),
    ("Kits Point Veterinary", "+12365550105"),
)
STATUTORY = {
    date(2026, 2, 16),
    date(2026, 4, 3),
    date(2026, 5, 18),
    date(2026, 7, 1),
    date(2026, 8, 3),
    date(2026, 9, 7),
    date(2026, 9, 30),
    date(2026, 10, 12),
    date(2026, 11, 11),
    date(2026, 12, 25),
    date(2027, 1, 1),
}
type Temperament = Literal["calm", "friendly", "energetic", "anxious", "reactive"]


@dataclass(frozen=True)
class Pet:
    name: str
    breed: str
    born: str
    sex: Literal["female", "male"]
    temperament: Temperament
    allergies: str = "None known"
    feeding: str | None = None
    species: Literal["dog", "cat"] = "dog"


@dataclass(frozen=True)
class Home:
    key: str
    name: str
    phone: int
    address: str
    entry: str
    pets: tuple[Pet, ...]
    alarm: str | None = None
    vet: int = 0
    # days ago of the meet and greet; long-time clients met before the seeded history
    since: int = -300
    tags: tuple[str, ...] = ()
    leash: str = "Pulls at first, then settles"
    recall: str = "Comes back most of the time"
    off_leash: bool = True
    behaviour: tuple[str, ...] = ("Friendly with most dogs",)
    emergency: str = "a neighbour"


def _dog(
    name: str,
    breed: str,
    born: str,
    sex: Literal["female", "male"],
    temperament: Temperament = "friendly",
    allergies: str = "None known",
) -> Pet:
    return Pet(name, breed, born, sex, temperament, allergies)


HOMES: tuple[Home, ...] = (
    Home(
        "morgan",
        "Morgan Fraser",
        150,
        "1180 Comox Street, Vancouver, BC V6E 1K5",
        "Fob for the lobby and key for unit 604, both on tag C-07 in the office cabinet.",
        (_dog("Tofu", "Shiba Inu", "2019-04-02", "male", "calm"),),
        tags=("key holder", "weekday walks"),
        leash="Walks nicely",
        recall="Not reliable, keep on leash",
        off_leash=False,
        behaviour=("Prefers people to dogs",),
        emergency="Jamie Fraser",
        since=-330,
    ),
    Home(
        "daniel",
        "Daniel Okafor",
        101,
        "1650 West 4th Avenue, Vancouver, BC V6J 1L9",
        "To be collected at the meet and greet.",
        (_dog("Juno", "Labrador Retriever mix", "2025-09-14", "female", "energetic"),),
        since=2,
        leash="Pulls most of the walk",
        recall="Not reliable, keep on leash",
        off_leash=False,
        emergency="Grace Okafor",
    ),
    Home(
        "wen",
        "Wen Li",
        102,
        "1288 Marinaside Crescent, Vancouver, BC V6Z 2W5",
        "Concierge holds a fob for us; sign in at the front desk and ask for unit 1903.",
        (_dog("Mochi", "Cavapoo", "2021-07-20", "female"),),
        tags=("walk pack",),
        vet=2,
        emergency="Henry Li",
        since=-58,
    ),
    Home(
        "sanjay",
        "Sanjay Mehta",
        103,
        "2140 Cypress Street, Vancouver, BC V6J 3M1",
        "Lockbox on the side gate, code 4417. Key opens the back door.",
        (_dog("Bruno", "Boxer", "2020-11-03", "male", "energetic"),),
        alarm="Panel inside the back door: 2290, then Off. Set it again when you leave.",
        vet=4,
        tags=("lockbox",),
        leash="Needs a front-clip harness",
        emergency="Priya Mehta",
        since=-320,
    ),
    Home(
        "chloe",
        "Chloé Tremblay",
        104,
        "1045 Haro Street, Vancouver, BC V6E 1C8",
        "Key on tag C-19. Buzzer 2210 lets you into the lobby during the day.",
        (_dog("Maple", "Golden Retriever", "2022-02-11", "female"),),
        vet=1,
        tags=("key holder",),
        emergency="Marc Tremblay",
        since=-310,
    ),
    Home(
        "nasrin",
        "Nasrin Karimi",
        105,
        "3367 West 2nd Avenue, Vancouver, BC V6R 1J3",
        "Lockbox on the gas meter at the side of the house, code 8150.",
        (
            _dog("Zola", "Border Collie mix", "2020-06-25", "female", "energetic"),
            Pet("Pistachio", "Domestic Shorthair", "2018-03-09", "male", "calm", species="cat"),
        ),
        alarm="No alarm.",
        vet=4,
        tags=("lockbox", "sitting"),
        recall="Comes back every time",
        behaviour=("Friendly with most dogs", "Chases cats or squirrels"),
        emergency="Shirin Karimi",
        since=-305,
    ),
    Home(
        "ben",
        "Ben Kowalski",
        106,
        "455 West 14th Avenue, Vancouver, BC V5Y 1W7",
        "Key on tag C-22 opens the front door and the side gate.",
        (
            _dog("Murphy", "Bernese Mountain Dog", "2021-01-30", "male", "calm"),
            _dog("Pickles", "Miniature Dachshund", "2019-10-12", "female", "anxious"),
        ),
        alarm="Panel by the front door: 7731, then Away when you leave.",
        vet=2,
        tags=("key holder", "sitting"),
        emergency="Anna Kowalski",
        since=-300,
    ),
    Home(
        "aiko",
        "Aiko Sato",
        107,
        "1725 Pendrell Street, Vancouver, BC V6G 1T3",
        "Key on tag C-03. The mailbox key is on the same ring.",
        (
            Pet("Nori", "Domestic Shorthair", "2016-05-18", "female", "calm", species="cat"),
            Pet(
                "Kabocha",
                "Domestic Longhair",
                "2019-09-02",
                "male",
                "anxious",
                feeding="Kabocha eats a renal diet only; never share Nori's food.",
                species="cat",
            ),
        ),
        vet=1,
        tags=("key holder", "cats"),
        emergency="Yumi Sato",
        since=-325,
    ),
    Home(
        "ryan",
        "Ryan Mitchell",
        108,
        "1350 Burrard Street, Vancouver, BC V6Z 0C2",
        "Fob on tag C-31. Unit 1407; the dog's lead hangs on the closet door.",
        (
            _dog(
                "Diesel",
                "American Staffordshire Terrier",
                "2019-08-08",
                "male",
                allergies="Chicken",
            ),
        ),
        vet=1,
        tags=("key holder",),
        emergency="Tyler Mitchell",
    ),
    Home(
        "isabel",
        "Isabel Santos",
        109,
        "2880 Yew Street, Vancouver, BC V6K 3H5",
        "Lockbox on the back gate, code 6021.",
        (_dog("Luna", "Australian Shepherd", "2021-04-16", "female", "energetic"),),
        vet=4,
        tags=("lockbox", "group walks"),
        recall="Comes back every time",
        emergency="Paolo Santos",
    ),
    Home(
        "callum",
        "Callum Reid",
        110,
        "4120 West 10th Avenue, Vancouver, BC V6R 2H3",
        "Key under the blue planter by the back door, which Callum prefers to a lockbox.",
        (_dog("Barley", "English Springer Spaniel", "2020-09-27", "male", "energetic"),),
        vet=4,
        behaviour=("Friendly with most dogs", "Chases cats or squirrels"),
        emergency="Fiona Reid",
    ),
    Home(
        "elena",
        "Elena Petrova",
        111,
        "1501 Howe Street, Vancouver, BC V6Z 2P8",
        "Fob on tag C-12; the concierge knows us. Unit 2202.",
        (_dog("Ghost", "Weimaraner", "2020-03-05", "male", "energetic"),),
        vet=2,
        tags=("key holder", "walking plan"),
        leash="Needs a front-clip harness",
        emergency="Pavel Petrov",
        since=-315,
    ),
    Home(
        "jun",
        "Jun Seo",
        112,
        "1155 Seymour Street, Vancouver, BC V6B 0G2",
        "Fob on tag C-28 for the lobby and the elevator, unit 3108.",
        (_dog("Biscuit", "Pembroke Welsh Corgi", "2022-05-01", "male"),),
        vet=2,
        tags=("key holder", "walking plan"),
        emergency="Soo-ah Park",
    ),
    Home(
        "simran",
        "Simran Dhillon",
        113,
        "2955 Oak Street, Vancouver, BC V6H 2K9",
        "Lockbox on the front railing, code 1972.",
        (_dog("Ziggy", "Bernedoodle", "2026-06-02", "male", "energetic"),),
        vet=3,
        tags=("lockbox", "puppy"),
        leash="Pulls most of the walk",
        recall="Not reliable, keep on leash",
        off_leash=False,
        emergency="Harjit Dhillon",
        since=-66,
    ),
    Home(
        "catherine",
        "Catherine Wong",
        114,
        "1960 Robson Street, Vancouver, BC V6G 1E8",
        "Key on tag C-09. Door sticks; lift the handle as you turn the key.",
        (_dog("Dot", "Miniature Schnauzer", "2017-12-19", "female", "calm"),),
        vet=1,
        tags=("key holder",),
        leash="Walks nicely",
        emergency="Edward Wong",
    ),
    Home(
        "hugo",
        "Hugo Lefebvre",
        115,
        "1238 Richards Street, Vancouver, BC V6B 3G2",
        "Hugo works from home and buzzes us in (unit 806).",
        (_dog("Gus", "French Bulldog", "2021-11-23", "male", "calm"),),
        vet=0,
        emergency="Camille Lefebvre",
    ),
    Home(
        "derek",
        "Derek Lam",
        116,
        "2190 West 8th Avenue, Vancouver, BC V6K 2A5",
        "Lockbox on the side door, code 3305.",
        (_dog("Kobe", "Siberian Husky", "2020-01-14", "male", "energetic"),),
        vet=4,
        tags=("lockbox",),
        recall="Not reliable, keep on leash",
        off_leash=False,
        emergency="Kevin Lam",
    ),
    Home(
        "tasha",
        "Natasha Ivanova",
        117,
        "1720 Barclay Street, Vancouver, BC V6G 1K3",
        "Key on tag C-25 for the lobby and unit 302.",
        (_dog("Sasha", "Samoyed", "2022-08-30", "female"),),
        vet=1,
        tags=("key holder", "group walks"),
        emergency="Oleg Ivanov",
        since=-150,
    ),
    Home(
        "maria",
        "María José Herrera",
        118,
        "3450 West 6th Avenue, Vancouver, BC V6R 1T4",
        "Lockbox on the back fence, code 0912.",
        (_dog("Coco", "Havanese", "2018-04-21", "female", "calm"),),
        alarm="Panel in the hall closet: 5517, then Off.",
        vet=4,
        tags=("lockbox", "sitting"),
        emergency="Lucía Herrera",
    ),
    Home(
        "olivia",
        "Olivia Bennett",
        119,
        "1035 Pacific Street, Vancouver, BC V6E 4G7",
        "Key on tag C-14 for unit 1102.",
        (_dog("Rosie", "Cocker Spaniel", "2021-06-08", "female"),),
        vet=1,
        tags=("key holder", "group walks"),
        emergency="Kate Bennett",
    ),
    Home(
        "arjun",
        "Arjun Grewal",
        121,
        "6050 Fraser Street, Vancouver, BC V5W 2Z7",
        "Lockbox on the front porch post, code 2711.",
        (_dog("Tank", "Rottweiler", "2019-02-17", "male", "calm"),),
        vet=3,
        tags=("lockbox", "group walks"),
        leash="Walks nicely",
        emergency="Manpreet Grewal",
    ),
    Home(
        "mei",
        "Mei Fong",
        122,
        "939 Expo Boulevard, Vancouver, BC V6Z 3G4",
        "Fob on tag C-05; unit 1508.",
        (_dog("Dumpling", "Pomeranian", "2020-12-01", "male", "energetic"),),
        vet=2,
        tags=("key holder", "small dog group"),
        emergency="Lily Fong",
    ),
    Home(
        "liam",
        "Liam Gallagher",
        123,
        "2236 Trafalgar Street, Vancouver, BC V6K 3T1",
        "Key on tag C-17 for the basement suite door.",
        (_dog("Fergus", "Irish Terrier", "2018-07-04", "male", "reactive"),),
        vet=4,
        tags=("key holder",),
        recall="Not reliable, keep on leash",
        off_leash=False,
        behaviour=("Reactive on leash",),
        emergency="Siobhan O'Connor",
    ),
    Home(
        "fatemeh",
        "Fatemeh Rahimi",
        124,
        "1477 West Pender Street, Vancouver, BC V6G 2S3",
        "Fob on tag C-33; unit 2405.",
        (_dog("Simba", "Goldendoodle", "2023-03-15", "male", "energetic"),),
        vet=0,
        tags=("key holder",),
        emergency="Reza Rahimi",
        since=-24,
    ),
    Home(
        "jasper",
        "Jasper Thompson",
        125,
        "3088 Quebec Street, Vancouver, BC V5T 3A9",
        "Lockbox on the stair railing, code 6684.",
        (_dog("Ollie", "Labrador Retriever", "2019-05-29", "male"),),
        vet=3,
        tags=("lockbox", "group walks"),
        recall="Comes back every time",
        emergency="Mara Thompson",
    ),
    Home(
        "noor",
        "Noor Haddad",
        126,
        "1268 West Broadway, Vancouver, BC V6H 1G6",
        "Concierge holds a key for us, unit 704.",
        (_dog("Hazel", "Vizsla", "2021-10-10", "female", "energetic"),),
        vet=3,
        tags=("group walks",),
        emergency="Sami Haddad",
    ),
    Home(
        "kenji",
        "Kenji Yamamoto",
        127,
        "1889 Alberni Street, Vancouver, BC V6G 3G9",
        "Fob on tag C-11; unit 1705.",
        (_dog("Hachi", "Akita", "2018-11-11", "male", "calm"),),
        vet=1,
        tags=("key holder",),
        leash="Walks nicely",
        behaviour=("Prefers people to dogs",),
        off_leash=False,
        recall="Not reliable, keep on leash",
        emergency="Haruka Yamamoto",
    ),
    Home(
        "sofia",
        "Sofia Rossi",
        128,
        "1133 Homer Street, Vancouver, BC V6B 0B1",
        "Fob on tag C-20; unit 1207.",
        (_dog("Bella", "Italian Greyhound", "2020-02-02", "female", "anxious"),),
        vet=2,
        tags=("key holder", "small dog group"),
        behaviour=("Nervous with strangers",),
        off_leash=False,
        recall="Not reliable, keep on leash",
        emergency="Marco Rossi",
    ),
    Home(
        "marcus",
        "Marcus Johnson",
        129,
        "2520 Ontario Street, Vancouver, BC V5T 2X7",
        "Lockbox on the garage door, code 5240.",
        (_dog("Duke", "German Shepherd", "2019-09-09", "male", "calm"),),
        vet=3,
        tags=("lockbox", "group walks"),
        emergency="Tanya Johnson",
    ),
    Home(
        "grace",
        "Grace Kim",
        130,
        "1311 Beach Avenue, Vancouver, BC V6E 1V6",
        "Key on tag C-02; unit 905.",
        (_dog("Kimchi", "Shih Tzu", "2017-06-30", "female", "calm"),),
        vet=1,
        tags=("key holder",),
        leash="Walks nicely",
        emergency="Daniel Kim",
    ),
    Home(
        "rahul",
        "Rahul Sharma",
        131,
        "1010 Richards Street, Vancouver, BC V6B 3E7",
        "Fob on tag C-34; unit 1810.",
        (_dog("Leo", "Beagle", "2022-01-25", "male", "energetic"),),
        vet=2,
        tags=("key holder", "group walks"),
        recall="Not reliable, keep on leash",
        off_leash=False,
        emergency="Neha Sharma",
    ),
    Home(
        "thomas",
        "Thomas Tran",
        132,
        "3550 Main Street, Vancouver, BC V5V 3N2",
        "Lockbox on the back porch, code 4402.",
        (_dog("Bear", "Chow Chow mix", "2020-10-20", "male", "calm"),),
        vet=3,
        tags=("lockbox",),
        emergency="Linh Tran",
        since=-9,
    ),
    Home(
        "jessica",
        "Jessica Ramos",
        133,
        "1268 Nelson Street, Vancouver, BC V6E 1J5",
        "Key on tag C-16; unit 408.",
        (_dog("Nacho", "Chihuahua mix", "2019-03-03", "male", "anxious"),),
        vet=1,
        tags=("key holder", "small dog group"),
        behaviour=("Nervous with strangers",),
        emergency="Ana Ramos",
    ),
    Home(
        "david",
        "David Cohen",
        134,
        "2670 West 3rd Avenue, Vancouver, BC V6K 1M5",
        "Lockbox on the side gate, code 7713.",
        (_dog("Max", "Standard Poodle", "2018-08-15", "male"),),
        vet=4,
        tags=("lockbox",),
        emergency="Rachel Cohen",
    ),
    Home(
        "megan",
        "Megan Wright",
        135,
        "1575 West 7th Avenue, Vancouver, BC V6J 1S1",
        "Key on tag C-27 for the front door.",
        (_dog("Penny", "Boston Terrier", "2021-12-12", "female"),),
        vet=3,
        tags=("key holder", "group walks"),
        emergency="Chris Wright",
    ),
    Home(
        "sebastian",
        "Sebastian Müller",
        136,
        "1820 West 11th Avenue, Vancouver, BC V6J 2C5",
        "Lockbox by the back door, code 1408.",
        (_dog("Otto", "Miniature Dachshund", "2020-05-05", "male", "anxious"),),
        vet=3,
        tags=("lockbox",),
        off_leash=False,
        recall="Not reliable, keep on leash",
        emergency="Lena Müller",
    ),
    Home(
        "aaliyah",
        "Aaliyah Brown",
        137,
        "2788 Prince Edward Street, Vancouver, BC V5T 3L8",
        "Key on tag C-30; the side door sticks in the rain.",
        (_dog("Nala", "Labrador Retriever mix", "2020-04-11", "female"),),
        vet=3,
        tags=("key holder", "group walks"),
        emergency="Jordan Brown",
    ),
    Home(
        "vikram",
        "Vikram Sidhu",
        138,
        "7120 Knight Street, Vancouver, BC V5P 2W9",
        "Lockbox on the carport post, code 3360.",
        (_dog("Sher", "Labrador Retriever", "2018-06-06", "male", "calm"),),
        alarm="Panel in the carport entry: 8842, then Off.",
        vet=3,
        tags=("lockbox",),
        emergency="Gurpreet Sidhu",
    ),
    Home(
        "eunji",
        "Eun-ji Choi",
        139,
        "1239 Harwood Street, Vancouver, BC V6E 1S4",
        "Fob on tag C-08; unit 610.",
        (_dog("Bori", "Jindo", "2021-03-27", "female", "reactive"),),
        vet=1,
        tags=("key holder",),
        behaviour=("Reactive on leash", "Nervous with strangers"),
        off_leash=False,
        recall="Not reliable, keep on leash",
        emergency="Min-jun Choi",
    ),
    Home(
        "lucas",
        "Lucas Silva",
        140,
        "1938 Cornwall Avenue, Vancouver, BC V6J 1C8",
        "Key on tag C-21 for the townhouse.",
        (_dog("Thor", "Siberian Husky", "2021-02-14", "male", "energetic"),),
        vet=4,
        tags=("key holder", "group walks"),
        recall="Not reliable, keep on leash",
        emergency="Beatriz Silva",
    ),
    Home(
        "emma",
        "Emma Lavoie",
        141,
        "1661 Davie Street, Vancouver, BC V6G 1W2",
        "Key on tag C-10; unit 503.",
        (_dog("Poutine", "Bichon Frise", "2020-07-07", "female"),),
        vet=1,
        tags=("key holder", "small dog group"),
        emergency="Julien Lavoie",
    ),
    Home(
        "nadia",
        "Nadia Hussain",
        142,
        "1199 Seymour Street, Vancouver, BC V6B 1K3",
        "Fob on tag C-24; unit 2301.",
        (_dog("Pearl", "Maltese", "2019-01-19", "female", "calm"),),
        vet=2,
        tags=("key holder", "small dog group"),
        emergency="Imran Hussain",
    ),
    Home(
        "james",
        "James Whitehorse",
        143,
        "2304 East 1st Avenue, Vancouver, BC V5N 1B6",
        "Lockbox on the back gate, code 5096.",
        (_dog("Kiwi", "Australian Cattle Dog", "2020-08-18", "female", "energetic"),),
        vet=3,
        tags=("lockbox", "group walks"),
        recall="Comes back every time",
        emergency="Mary Whitehorse",
    ),
    Home(
        "zoe",
        "Zoe Campbell",
        144,
        "1490 Pennyfarthing Drive, Vancouver, BC V6J 4Z3",
        "Key on tag C-26 for unit 210.",
        (_dog("Winnie", "Labradoodle", "2022-04-04", "female"),),
        vet=4,
        tags=("key holder", "group walks"),
        emergency="Ian Campbell",
    ),
    Home(
        "omar",
        "Omar Farouk",
        145,
        "1088 Quebec Street, Vancouver, BC V6A 4H2",
        "Fob on tag C-35; unit 1611.",
        (_dog("Milo", "Cavalier King Charles Spaniel", "2022-10-05", "male", "calm"),),
        vet=2,
        tags=("key holder",),
        leash="Walks nicely",
        emergency="Yasmin Farouk",
        since=-38,
    ),
    Home(
        "lena",
        "Lena Fischer",
        146,
        "2050 West 13th Avenue, Vancouver, BC V6J 2H6",
        "Lockbox on the front door handle, code 2468.",
        (_dog("Frida", "Greyhound", "2019-11-30", "female", "calm"),),
        vet=4,
        tags=("lockbox",),
        off_leash=False,
        recall="Not reliable, keep on leash",
        emergency="Tobias Fischer",
        since=-14,
    ),
    Home(
        "tyler",
        "Tyler Brooks",
        147,
        "1408 Strathmore Mews, Vancouver, BC V6Z 3A9",
        "Fob on tag C-29; unit 1902.",
        (_dog("Remy", "Doberman", "2021-05-22", "male", "energetic"),),
        vet=2,
        tags=("key holder",),
        emergency="Kayla Brooks",
    ),
    Home(
        "rina",
        "Rina Mercado",
        148,
        "1250 Burnaby Street, Vancouver, BC V6E 1P5",
        "Key on tag C-18; unit 202.",
        (_dog("Taco", "Pug", "2020-09-09", "male", "calm"),),
        vet=1,
        tags=("key holder", "small dog group"),
        emergency="Joel Mercado",
    ),
    Home(
        "paul",
        "Paul Dubois",
        149,
        "1330 Jervis Street, Vancouver, BC V6E 2B7",
        "Key on tag C-04; unit 1501.",
        (Pet("Mimi", "Ragdoll", "2017-02-14", "female", "calm", species="cat"),),
        vet=1,
        tags=("key holder", "cats"),
        emergency="Claire Dubois",
    ),
    Home(
        "kavya",
        "Kavya Iyer",
        151,
        "2655 Cranberry Drive, Vancouver, BC V6K 4V5",
        "Lockbox on the stair rail, code 9031.",
        (Pet("Chai", "Siamese", "2020-12-24", "female", "energetic", species="cat"),),
        vet=4,
        tags=("lockbox", "cats"),
        emergency="Arun Iyer",
    ),
    Home(
        "rose",
        "Rose McKenzie",
        152,
        "1015 Cardero Street, Vancouver, BC V6G 2H1",
        "Key on tag C-06 for unit 701.",
        (
            Pet("Earl", "Domestic Shorthair", "2015-10-01", "male", "calm", species="cat"),
            Pet("Grey", "Domestic Shorthair", "2015-10-01", "male", "anxious", species="cat"),
        ),
        vet=0,
        tags=("key holder", "cats"),
        emergency="Duncan McKenzie",
    ),
    Home(
        "samuel",
        "Samuel Adeyemi",
        153,
        "1650 Columbia Street, Vancouver, BC V5Y 0H1",
        "Fob on tag C-32; unit 908.",
        (Pet("Biscotti", "Domestic Longhair", "2021-08-08", "female", "friendly", species="cat"),),
        vet=2,
        tags=("key holder", "cats"),
        emergency="Tolu Adeyemi",
    ),
    Home(
        "hamid",
        "Hamid Sadeghi",
        154,
        "1325 Nicola Street, Vancouver, BC V6G 2E8",
        "Key on tag C-13; unit 304.",
        (_dog("Pasha", "Labrador Retriever", "2017-03-18", "male", "calm"),),
        vet=1,
        tags=("key holder",),
        leash="Walks nicely",
        emergency="Leyla Sadeghi",
        since=-80,
    ),
)
SMALL_GROUP = ("mei", "sofia", "jessica", "emma", "nadia", "rina")
BIG_GROUP = (
    "olivia",
    "arjun",
    "jasper",
    "noor",
    "marcus",
    "rahul",
    "megan",
    "aaliyah",
    "lucas",
    "james",
    "zoe",
    "isabel",
)
SOLO = (
    "chloe",
    "sanjay",
    "callum",
    "catherine",
    "hugo",
    "liam",
    "kenji",
    "grace",
    "david",
    "sebastian",
    "vikram",
    "eunji",
    "tyler",
    "maria",
    "nasrin",
    "ben",
    "ryan",
    "derek",
)
CATS = ("paul", "kavya", "rose", "samuel")
# fill history settles mostly by card and e-Transfer; cash goes to the walker at the door
SETTLEMENTS: tuple[Settle, ...] = ("card", "etransfer", "card", "etransfer", "cash", "card")
PHOTO_CLIENTS = (
    "morgan",
    "daniel",
    "wen",
    "sanjay",
    "chloe",
    "nasrin",
    "ben",
    "aiko",
    "isabel",
    "elena",
    "jun",
    "simran",
    "catherine",
    "hugo",
    "maria",
    "olivia",
    "kenji",
    "emma",
    "rahul",
)


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    stock = STOCK.get(item_id)
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="standard"
        if kind == "product"
        else "exempt"
        if kind == "gift"
        else "federal_only",
        minutes=minutes,
        color=COLORS.get(item_id, "#5E7391"),
        online_bookable=item_id in ONLINE,
        sell_online=kind == "product",
        capacity=3 if item_id == GROUP30 else 4 if item_id == GROUP60 else None,
        buffer_after_min=BUFFERS.get(item_id, 15) if minutes else 0,
        deposit_type="fixed" if item_id == OVERNIGHT else "none",
        deposit_value=5000 if item_id == OVERNIGHT else None,
        frequency="month" if kind == "subscription" else None,
        sku=stock[3] if stock else None,
        cost_cents=stock[2] if stock else None,
        stock=Stock(stock[0], stock[1]) if stock else None,
        sessions=10 if item_id == TEN else None,
        covers=WALK30 if item_id == TEN else None,
        validity_days=180 if item_id == TEN else None,
        ref={TEN: "ten", PLAN: "plan"}.get(item_id),
        contract=PLAN_TERMS if item_id == PLAN else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(CEDAR),
    code="cc",
    slug="cedar-coast-demo",
    login_domain="cedarcoast.example.test",
    owner=CEDAR_OWNER,
    people=(
        Person(
            CEDAR_OWNER,
            BOSS,
            "owner",
            "Rowan Ellis",
            "+16045550190",
            "owner",
            "Owner, meet and greets and walks",
            "#35576B",
            HOURS[BOSS],
        ),
        Person(
            "us_cc_amrit",
            AMRIT,
            "amrit",
            "Amrit Sandhu",
            "+16045550191",
            "staff",
            "Dog walker",
            "#2E7A5A",
            HOURS[AMRIT],
            payee=True,
            rate_type="percent",
            rate_bps=5500,
        ),
        Person(
            "us_cc_tessa",
            TESSA,
            "tessa",
            "Tessa Nguyen",
            "+16045550192",
            "staff",
            "Dog walker",
            "#A0703A",
            HOURS[TESSA],
            payee=True,
            rate_type="hourly",
            rate_cents=2400,
        ),
        Person(
            "us_cc_leila",
            LEILA,
            "leila",
            "Leila Jafari",
            "+16045550193",
            "staff",
            "Pet sitter, cat and puppy visits",
            "#7D5A82",
            HOURS[LEILA],
            payee=True,
            rate_type="percent",
            rate_bps=6000,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Dog walks, cat visits and overnight pet sitting in downtown Vancouver.",
        "about": (
            "Cedar Coast Pet Care is a team of four in the West End. Rowan, Amrit and Tessa "
            "walk dogs on weekdays, on their own or in small groups of up to four, and Leila "
            "looks after cats and puppies during the week and stays overnight when you're "
            "away. Every new client starts with a free meet and greet at home, where we go "
            "over your pet's routine and how we get in, and sign our key holding agreement."
        ),
        "address": "455 Granville Street, Vancouver, BC V6C 1T1",
        "phone": "+1 604-555-0120",
        "email": "hello@cedarcoast.example.test",
        "website": "https://cedarcoast.example.test",
        "neighbourhood": "Downtown and the West End",
    },
    booking_policy={
        "approve_new_clients": False,
        "lead_hours": 12,
        "step_min": 30,
        "cancel_cutoff_hours": 24,
        "reschedule_cutoff_hours": 24,
    },
    subject="pet",
    sms_number="+16045550998",
    gst_hst_number="726418093RT0001",
    pst_number="PST-1048-2716",
    trial_days=14,
    forms=(
        FormSpec(MEET_FORM, "Meet and greet intake", "ff_cc_meet_", MEET_FIELDS, send_on="booking"),
        FormSpec(
            SITTING_FORM,
            "Before your pet sitting stay",
            "ff_cc_sit_",
            SITTING_FIELDS,
            require_signature=True,
        ),
        FormSpec(FEEDBACK_FORM, "How was the visit?", "ff_cc_fb_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(
            AGREEMENT,
            "Key holding and service agreement",
            AGREEMENT_BODY,
            version=2,
            earlier_body=AGREEMENT_V1,
            revised_day=-AGREEMENT_REVISED,
        ),
        ContractSpec(PLAN_TERMS, "Monthly walking plan terms", PLAN_BODY),
    ),
    storyline=(
        Stage(
            "New client's meet and greet booked online, intake form sent",
            "daniel",
            ("bk_cc_daniel_meet", "fr_cc_meet_daniel"),
        ),
        Stage("Regular on a weekday walk series, invoiced weekly", "morgan", ("sch_cc_morgan",)),
        Stage("Partway through a 10-walk pack", "wen", ("pkg_cc_ten_wen",)),
        Stage("Today's walk, checked in", "sanjay", ("bk_cc_sanjay_today",)),
        Stage("Today's walk, walker on the way", "chloe", ("bk_cc_chloe_today",)),
        Stage("Overnight sitting this weekend, deposit paid", "nasrin", ("bk_cc_nasrin_stay",)),
        Stage("Holiday sitting request, quote sent", "ben", ("est_cc_ben_holiday",)),
        Stage("Cat drop-ins while the owner is away", "aiko", ("bk_cc_aiko_trip_0",)),
        Stage(
            "Late cancellation, half the walk charged",
            "ryan",
            ("bk_cc_ryan_late", "inv_cc_ryan_late"),
        ),
        Stage("Five-star feedback", "isabel", ("fr_cc_feedback_isabel",)),
        Stage(
            "Four-star feedback about a muddy dog, with a reply",
            "callum",
            ("fr_cc_feedback_callum", "th_cc_callum_sms"),
        ),
        Stage("Monthly walking plan", "elena", ("sub_cc_plan_elena", "sch_cc_elena")),
        Stage("Puppy visits four days a week", "simran", ("sch_cc_simran",)),
        Stage("Group walk full, with a dog on the waitlist", "tasha", ("bk_cc_tasha_wait",)),
        Stage("Walk and a collar light paid by Tap to Pay", "hugo", ("ord_cc_hugo",)),
        Stage("Stay cut short, one night refunded", "maria", ("bk_cc_maria_stay",)),
    ),
    pacing=Pacing(
        {BOSS: 5, AMRIT: 7, TESSA: 6},
        (WALK30, WALK60, WALK30, WALK30, WALK60),
        weeks=34,
        ahead_weeks=4,
        # quieter in high summer when owners are home or away, busier back at work in the fall
        seasonality={6: 0.9, 7: 0.75, 8: 0.8, 9: 1.1, 10: 1.1, 12: 0.85},
        settlements=SETTLEMENTS,
        cancel_every=31,
    ),
    photo_clients=PHOTO_CLIENTS,
    founded_day=-420,
    catalog_day=-340,
    documents_day=-338,
    restock_days=(-340, -280, -220, -160, -100, -40),
    invoice_start=1400,
    estimate_start=120,
    seed=31,
)


def _attributes(home: Home, pet: Pet, index: int) -> dict[str, object]:
    weight, coat = BREEDS[pet.breed]
    born = date.fromisoformat(pet.born)
    vet = VETS[home.vet][0]
    rabies = date(2027, born.month, min(born.day, 28)) if pet.species == "dog" else None
    attributes = PetAttributes(
        species=pet.species,
        breed=pet.breed,
        weight_kg=weight if index == 0 else round(weight * 0.95, 1),
        birthday=born,
        sex=pet.sex,
        temperament=pet.temperament,
        coat=coat,
        allergies=pet.allergies,
        vet=vet,
        rabies_until=rabies,
        style="Indoor only; brushed weekly"
        if pet.species == "cat"
        else next(
            (style for name, style in STYLES.items() if name.lower() in coat.lower()),
            "Towel and paw wipe after walks",
        ),
    )
    return attributes.model_dump(mode="json", exclude_none=True)


def _feeding(home: Home) -> str:
    notes = [pet.feeding for pet in home.pets if pet.feeding]
    dog = next((p for p in home.pets if p.species == "dog"), None)
    if dog is not None:
        weight = BREEDS[dog.breed][0]
        cups = "a quarter cup" if weight < 6 else "half a cup" if weight < 15 else "one cup"
        notes.insert(
            0,
            f"Fresh water after every walk. On midday visits {dog.name} gets {cups} of kibble "
            "from the bin in the pantry. Training treats are fine.",
        )
    else:
        notes.insert(
            0,
            "Wet food morning and evening, a quarter can each, plus dry food topped up. Fresh "
            "water and a scooped litter box every visit.",
        )
    return " ".join(notes)


class Cedar(Demo):
    spec = SPEC

    def story(self) -> None:
        self.households()
        self.time_off("tessa_away", TESSA, self.at(-75, 0), self.at(-68, 23), "Vacation")
        self.regulars()
        self.groups()
        self.today()
        self.stays()
        self.cats()
        self.storyline()
        self.history()
        self.engagement()

    def homes(self, keys: tuple[str, ...]) -> list[Home]:
        return [home for home in HOMES if home.key in keys]

    def home(self, key: str) -> Home:
        return next(home for home in HOMES if home.key == key)

    def households(self) -> None:
        for home in HOMES:
            first = home.pets[0]
            self.client(
                home.key,
                home.name,
                f"{_email(home.name)}@example.test",
                f"+1604555{home.phone:04}",
                tags=list(home.tags),
                channel="email" if home.phone % 3 == 0 else "sms",
                fields={"source": "referral" if home.phone % 4 == 0 else "google"},
                subject=first.name,
                attributes=_attributes(home, first, 0),
            )
            for index, pet in enumerate(home.pets[1:], start=1):
                self.subject(
                    f"{home.key}_{pet.name.lower()}",
                    home.key,
                    pet.name,
                    _attributes(home, pet, index),
                )
        self.photos()

    def meet(self, home: Home, day: int, *, status: BookingStatus = "completed") -> Booking:
        """The free first visit, with its intake form, key holding agreement and access note."""
        past = status == "completed"
        start = self.place(BOSS, MEET, day, self.subject_id(home.key), past=past)
        assert start is not None, home.key
        created = min(start - timedelta(days=4), self.now - timedelta(hours=5))
        booking = self.book(
            f"{home.key}_meet",
            home.key,
            MEET,
            BOSS,
            start,
            status,
            created,
            source="online",
        )
        sent = created + timedelta(minutes=5)
        if past:
            submitted = min(start - timedelta(hours=20), created + timedelta(days=1))
            self.response(
                "meet", home.key, MEET_FORM, booking, self.intake(home), submitted, created=sent
            )
            self.sign(home.key, home.key, AGREEMENT, start + timedelta(minutes=25), None)
            self.access(home, start + timedelta(minutes=40))
        else:
            self.response("meet", home.key, MEET_FORM, booking, {}, None, created=sent)
            self.sign(home.key, home.key, AGREEMENT, sent, None, status="pending")
        return booking

    def intake(self, home: Home) -> dict[str, object]:
        dogs = [pet for pet in home.pets if pet.species == "dog"]
        answers: dict[str, object] = {
            "pet_names": " and ".join(pet.name for pet in home.pets),
            "home_address": home.address,
            "vet_clinic": VETS[home.vet][0],
            "vet_phone": VETS[home.vet][1],
            "emergency_name": home.emergency,
            "emergency_phone": f"+1778555{home.phone:04}",
            "feeding": _feeding(home),
            "entry": home.entry,
            "key_consent": True,
        }
        if dogs:
            answers |= {
                "behaviour": list(home.behaviour),
                "leash": home.leash,
                "recall": home.recall,
                "off_leash": home.off_leash,
            }
        allergies = [
            f"{p.name}: no {p.allergies.lower()}" for p in home.pets if p.allergies != "None known"
        ]
        if allergies:
            answers["health"] = "; ".join(allergies) + "."
        if home.alarm:
            answers["alarm"] = home.alarm
        return answers

    def access(self, home: Home, when: datetime) -> None:
        client_id = self.client_id(home.key)
        alarm = f" Alarm: {home.alarm}" if home.alarm else ""
        self.note(client_id, "client", f"Home access: {home.entry}{alarm}", when)
        note = next(n for n in self.ctx.all(Note) if n.parent_id == client_id)
        note.pinned = True

    def walks(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        *,
        weekdays: tuple[int, ...],
        at: time,
        first: date,
        count: int,
        price: int | None = None,
        status: RecurrenceStatus = "active",
    ) -> list[Booking]:
        """A weekday series; statutory holidays in it are cancelled, as the plan terms say."""
        item = self.items[item_id]
        byday: list[Weekday] = [WEEKDAYS[day] for day in weekdays]
        days = expand_occurrences(
            start_date=first, frequency="week", interval=1, byday=byday, count=count, until=None
        )
        recurrence = Recurrence(
            id=f"sch_{self.code}_{key}",
            business_id=self.spec.id,
            item_id=item_id,
            staff_id=staff,
            client_id=self.client_id(client_key),
            frequency="week",
            interval=1,
            byday=byday,
            count=count,
            status=status,
        )
        self.ctx.add(recurrence)
        opened = datetime.combine(days[0], at, self.ctx.zone).astimezone(UTC)
        recurrence.created_at = recurrence.updated_at = min(
            opened - timedelta(days=10), self.now - timedelta(days=1)
        )
        made: list[Booking] = []
        for index, day in enumerate(days):
            start = datetime.combine(day, at, self.ctx.zone).astimezone(UTC)
            end = start + timedelta(minutes=item.duration_min or 30)
            if not self.within_hours(staff, start, end) or not self.free(
                staff, self.subject_id(client_key), start, end, 0, item.buffer_after_min
            ):
                raise ValueError(f"{recurrence.id}: visit {index} does not fit the calendar")
            done = end <= self.now
            booking = self.book(
                f"{key}_{index}",
                client_key,
                item_id,
                staff,
                start,
                "canceled" if day in STATUTORY else "completed" if done else "confirmed",
                recurrence.created_at,
                price=price,
            )
            self.ctx.get(Slot, booking.slot_id).recurrence_id = recurrence.id
            made.append(booking)
        return made

    def weekly(self, client_key: str, bookings: list[Booking], settle: Settle) -> None:
        """Regular walks are invoiced on Friday afternoon for the week's completed visits."""
        weeks: dict[date, list[Booking]] = {}
        for booking in bookings:
            if booking.status != "completed" or not booking.price_cents or booking.invoice_id:
                continue
            day = self.local(booking.starts_at).date()
            weeks.setdefault(day - timedelta(days=day.weekday()), []).append(booking)
        for monday, visits in sorted(weeks.items()):
            issued = datetime.combine(monday + timedelta(days=4), time(17, 0), self.ctx.zone)
            if issued.astimezone(UTC) > self.now - timedelta(hours=2):
                continue
            visits.sort(key=lambda b: b.starts_at)
            names = {self.items[self.ctx.get(Slot, b.slot_id).item_id].name for b in visits}
            invoice = self.invoice(
                f"{client_key}_week_{monday:%m%d}",
                client_key,
                issued.astimezone(UTC),
                visits[0].created_at,
                f"{', '.join(sorted(names))}, week of {monday:%B} {monday.day}.",
            )
            for position, booking in enumerate(visits):
                booking.invoice_id = invoice.id
                item_id = self.ctx.get(Slot, booking.slot_id).item_id
                self.line(invoice.id, item_id, booking.created_at, position, booking=booking)
            self.settle(invoice, client_key, settle)

    def free_start(
        self, staff: str, item_id: str, day: int, subject: str | None, hour: int
    ) -> datetime | None:
        """The first free half hour on that very day, from `hour`, inside the member's hours."""
        item = self.items[item_id]
        local = self.local(self.at(day))
        window = self.hours_on(staff, local.date())
        if window is None:
            return None
        for h in range(max(hour, window[0].hour), window[1].hour):
            for m in (0, 30):
                start = local.replace(hour=h, minute=m).astimezone(UTC)
                end = start + timedelta(minutes=item.duration_min or 30)
                if not self.within_hours(staff, start, end):
                    continue
                if start - timedelta(hours=1) < self.now < end + timedelta(hours=1):
                    continue
                if self.free(staff, subject, start, end, 0, item.buffer_after_min):
                    return start
        return None

    def regulars(self) -> None:
        today = self.local(self.now).date()
        monday = today - timedelta(days=today.weekday())
        # Morgan's weekday walks, renewed every twelve weeks
        morgan: list[Booking] = []
        for index, weeks_back in enumerate((32, 20)):
            morgan += self.walks(
                f"morgan_{index + 1}",
                "morgan",
                WALK30,
                AMRIT,
                weekdays=(0, 1, 2, 3, 4),
                at=time(12, 0),
                first=monday - timedelta(weeks=weeks_back),
                count=60,
                status="ended",
            )
        morgan += self.walks(
            "morgan",
            "morgan",
            WALK30,
            AMRIT,
            weekdays=(0, 1, 2, 3, 4),
            at=time(12, 0),
            first=monday - timedelta(weeks=8),
            count=60,
        )
        self.weekly("morgan", morgan, "etransfer")
        # the monthly plan: walks are covered by the subscription
        plan_start = self.at(-148, 10)
        self.subscribe("elena", PLAN, plan_start)
        first = self.local(plan_start).date() + timedelta(days=1)
        first += timedelta(days=(7 - first.weekday()) % 7)
        self.walks(
            "elena_1",
            "elena",
            WALK30,
            BOSS,
            weekdays=(0, 1, 2, 3, 4),
            at=time(11, 0),
            first=first,
            count=60,
            price=0,
            status="ended",
        )
        self.walks(
            "elena",
            "elena",
            WALK30,
            BOSS,
            weekdays=(0, 1, 2, 3, 4),
            at=time(11, 0),
            first=first + timedelta(weeks=12),
            count=60,
            price=0,
        )
        jun_start = self.at(-40, 10)
        self.subscribe("jun", PLAN, jun_start)
        first = self.local(jun_start).date() + timedelta(days=1)
        first += timedelta(days=(7 - first.weekday()) % 7)
        self.walks(
            "jun",
            "jun",
            WALK30,
            TESSA,
            weekdays=(0, 1, 2, 3, 4),
            at=time(12, 30),
            first=first,
            count=40,
            price=0,
        )
        # Ziggy's puppy visits since he came home at ten weeks
        ziggy = self.walks(
            "simran",
            "simran",
            PUPPY,
            LEILA,
            weekdays=(0, 1, 2, 3),
            at=time(12, 0),
            first=monday - timedelta(weeks=8),
            count=44,
        )
        self.weekly("simran", ziggy, "card")

    def groups(self) -> None:
        """Group walks: Amrit's on Tuesday and Thursday, Tessa's on the other weekdays."""
        today = self.local(self.now).date()
        monday = today - timedelta(days=today.weekday())
        seats: dict[str, list[Booking]] = {}
        turn = 0
        schedule = (
            (GROUP60, AMRIT, (1, 3), time(14, 0), BIG_GROUP[:7]),
            (GROUP60, TESSA, (0, 2, 4), time(14, 0), BIG_GROUP[5:]),
            (GROUP30, TESSA, (1, 3), time(9, 0), SMALL_GROUP),
        )
        for week in range(-32, 4):
            for item_id, staff, weekdays, at, pool in schedule:
                item = self.items[item_id]
                for weekday in weekdays:
                    day = monday + timedelta(weeks=week, days=weekday)
                    if day in STATUTORY:
                        continue
                    start = datetime.combine(day, at, self.ctx.zone).astimezone(UTC)
                    end = start + timedelta(minutes=item.duration_min or 60)
                    if start <= self.now < end + timedelta(hours=1):
                        continue
                    if not self.free(staff, None, start, end, 0, item.buffer_after_min):
                        continue
                    key = f"group_{staff.removeprefix('st_cc_')}_{day:%m%d}"
                    slot = self.session(key, item_id, staff, start)
                    capacity = item.capacity or 1
                    count = capacity if week >= 0 or turn % 4 else capacity - 1
                    chosen = [pool[(turn + i) % len(pool)] for i in range(count)]
                    turn += 1
                    for seat, client_key in enumerate(chosen):
                        subject = self.subject_id(client_key)
                        if not self.free("", subject, start, end, 0, item.buffer_after_min):
                            continue
                        done = end <= self.now
                        booking = self.book(
                            f"{key}_{seat}",
                            client_key,
                            item_id,
                            staff,
                            start,
                            "completed" if done else "confirmed",
                            min(start - timedelta(days=7), self.now - timedelta(hours=6)),
                            slot=slot,
                        )
                        self.busy.append((staff, subject, start, end, 0, item.buffer_after_min))
                        seats.setdefault(client_key, []).append(booking)
        for index, (client_key, bookings) in enumerate(sorted(seats.items())):
            self.weekly(client_key, bookings, SETTLEMENTS[index % len(SETTLEMENTS)])
        # next week's first full group with Tessa, where Sasha waits for a seat
        full = min(
            (
                slot
                for slot in self.ctx.all(Slot)
                if slot.item_id == GROUP60
                and slot.staff_id == TESSA
                and slot.starts_at > self.now + timedelta(days=4)
                and sum(1 for b in self.ctx.all(Booking) if b.slot_id == slot.id) == slot.capacity
                and self.subject_id("tasha")
                not in {b.subject_id for b in self.ctx.all(Booking) if b.slot_id == slot.id}
            ),
            key=lambda slot: slot.starts_at,
        )
        self.book(
            "tasha_wait",
            "tasha",
            GROUP60,
            TESSA,
            full.starts_at,
            "waitlisted",
            self.now - timedelta(days=1, hours=3),
            slot=full,
        )

    def today(self) -> None:
        """Today's walks: Amrit has Bruno out, and Tessa is on her way to Maple."""
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        planned = (
            ("sanjay", AMRIT, (floor - timedelta(minutes=20)).astimezone(UTC)),
            ("chloe", TESSA, (floor + timedelta(minutes=20)).astimezone(UTC)),
        )
        hour = timedelta(hours=1)
        live = all(
            self.within_hours(staff, start, start + hour)
            and self.free(staff, self.subject_id(key), start, start + hour, 0, 15)
            for key, staff, start in planned
        )
        for key, staff, start in planned:
            if not live:
                found = self.place(staff, WALK60, 1, self.subject_id(key), past=False)
                assert found is not None
                start = found
            booking = self.book(
                f"{key}_today",
                key,
                WALK60,
                staff,
                start,
                "confirmed",
                self.now - timedelta(days=6),
            )
            if live and key == "sanjay":
                booking.departed_at = start - timedelta(minutes=15)
                booking.checked_in_at = start + timedelta(minutes=2)
            elif live:
                booking.departed_at = self.now - timedelta(minutes=7)
        self.note(
            "bk_cc_sanjay_today",
            "booking",
            "Lockbox on the side gate. Bruno wears the front-clip harness from the hook by the "
            "back door. Reset the alarm when you leave.",
            self.now - timedelta(days=6),
        )
        self.note(
            "bk_cc_chloe_today",
            "booking",
            "Maple had a sore paw last week; keep to pavement and skip the beach today.",
            self.now - timedelta(days=1),
        )

    def stay(
        self,
        key: str,
        client_key: str,
        start: datetime,
        nights: int,
        *,
        status: BookingStatus,
        created: datetime,
    ) -> Booking:
        """An overnight stay as one long booking, from the first evening to the last morning."""
        item = self.items[OVERNIGHT]
        end = start + timedelta(days=nights - 1, minutes=item.duration_min or 900)
        subject = self.subject_id(client_key)
        if not self.free(LEILA, subject, start, end):
            raise ValueError(f"{key}: the stay overlaps another of Leila's visits")
        booking = self.book(
            key,
            client_key,
            OVERNIGHT,
            LEILA,
            start,
            status,
            created,
            price=item.price_cents * nights,
        )
        slot = self.ctx.get(Slot, booking.slot_id)
        slot.ends_at = end
        slot.updated_at = booking.updated_at = min(end, self.now)
        self.busy[-1] = (LEILA, subject, start, end, 0, 0)
        if status == "completed":
            booking.completed_at = end
        booking.deposit_amount_cents = deposit_cents(item)
        self.deposit(booking, created + timedelta(minutes=10))
        return booking

    def per_night(self, booking: Booking, nights: int) -> None:
        """Show a stay's invoice line as nights at the nightly price."""
        if booking.invoice_id is None:
            return
        line = next(
            r for r in self.ctx.all(Line) if r.invoice_id == booking.invoice_id and r.position == 0
        )
        line.quantity, line.unit_amount_cents = nights, self.items[OVERNIGHT].price_cents
        invoice = self.ctx.get(Invoice, booking.invoice_id)
        invoice.notes = (
            f"Overnight Pet Sitting, {nights} nights at ${line.unit_amount_cents // 100}."
        )

    def evening(self, day: int, weekday: int = 4) -> datetime:
        """6 pm on the first `weekday` (Friday by default) on or after `day`."""
        local = self.local(self.at(day)).date()
        local += timedelta(days=(weekday - local.weekday()) % 7)
        return datetime.combine(local, time(18, 0), self.ctx.zone).astimezone(UTC)

    def stays(self) -> None:
        # this weekend at Nasrin's, deposit paid and the stay form signed
        start = self.evening(0)
        if start < self.now + timedelta(hours=2):
            start += timedelta(weeks=1)
        nasrin = self.stay(
            "nasrin_stay",
            "nasrin",
            start,
            2,
            status="confirmed",
            created=self.now - timedelta(days=12),
        )
        leave = self.local(start).date()
        self.response(
            "sitting",
            "nasrin",
            SITTING_FORM,
            nasrin,
            {
                "leave_date": leave.isoformat(),
                "leave_time": "17:00",
                "return_date": (leave + timedelta(days=2)).isoformat(),
                "return_time": "11:00",
                "reach_you": "+16045550105",
                "sleeping": "Wherever they like",
                "plants_mail": "Water the fern on the landing on Saturday. Garbage and green bin "
                "go out Sunday night.",
                "house_notes": "Pistachio has the run of the house except the office. Zola "
                "sleeps on the couch; her evening walk is around Jericho Park.",
                "supplies": True,
            },
            self.now - timedelta(days=3),
            signature={"name": "Nasrin Karimi", "strokes": None, "ip": "192.0.2.41"},
        )
        # past stays: weekends and longer trips, each from a Friday or Saturday evening
        history: tuple[tuple[str, str, int, int, int, Settle], ...] = (
            ("nasrin_june", "nasrin", -132, 4, 2, "card"),
            ("ben_spring", "ben", -205, 5, 3, "etransfer"),
            ("ben_summer", "ben", -96, 4, 7, "etransfer"),
            ("maria_may", "maria", -160, 5, 2, "card"),
            ("vikram_stay", "vikram", -118, 4, 3, "card"),
            ("david_stay", "david", -61, 5, 2, "etransfer"),
            ("callum_stay", "callum", -47, 4, 2, "card"),
            ("tyler_stay", "tyler", -33, 4, 3, "card"),
            ("sanjay_stay", "sanjay", -180, 4, 9, "etransfer"),
            ("catherine_stay", "catherine", -19, 5, 2, "card"),
        )
        for key, client_key, day, weekday, nights, settle in history:
            start = self.evening(day, weekday)
            booking = self.stay(
                key,
                client_key,
                start,
                nights,
                status="completed",
                created=start - timedelta(days=21),
            )
            self.bill(booking, settle)
            self.per_night(booking, nights)
        # María came home a day early, so one of four nights is refunded
        start = self.evening(-75)
        maria = self.stay(
            "maria_stay", "maria", start, 4, status="completed", created=start - timedelta(days=18)
        )
        self.bill(maria, "card")
        self.per_night(maria, 4)
        assert maria.invoice_id is not None
        paid = next(
            p
            for p in self.ctx.all(Payment)
            if p.invoice_id == maria.invoice_id and p.kind == "payment"
        )
        assert paid.paid_at is not None
        self.refund(paid, 12075, paid.paid_at + timedelta(days=1), "Home a day early, one night")
        self.note(
            maria.id,
            "booking",
            "María's flight moved up a day, so Leila left Monday morning. One night refunded.",
            paid.paid_at,
        )

    def cats(self) -> None:
        """Cat drop-ins while owners travel, one visit a day by whoever works that day."""
        trips: tuple[tuple[str, int, int], ...] = (
            ("aiko", -3, 7),
            ("aiko_spring", -170, 5),
            ("paul", -54, 4),
            ("kavya", -88, 6),
            ("rose", -140, 3),
            ("rose_summer", -40, 5),
            ("samuel", -24, 4),
            ("paul_may", -150, 3),
        )
        for trip, first_day, days in trips:
            client_key = trip.split("_")[0]
            subject = self.subject_id(client_key)
            visits: list[Booking] = []
            for offset in range(days):
                day = first_day + offset
                weekday = self.local(self.at(day)).weekday()
                staff = LEILA if weekday < 4 else TESSA if weekday < 6 else BOSS
                start = self.free_start(staff, DROPIN, day, subject, 10)
                if start is None:
                    continue
                past = start < self.now
                booking = self.book(
                    f"{trip}_trip_{offset}" if trip == client_key else f"{trip}_{offset}",
                    client_key,
                    DROPIN,
                    staff,
                    start,
                    "completed" if past else "confirmed",
                    self.at(first_day - 12, 15),
                )
                visits.append(booking)
            if not visits:
                continue
            if trip == "aiko":
                for booking in visits:
                    if booking.status == "completed":
                        self.bill(booking, "card")
            else:
                self.weekly(client_key, visits, "etransfer")

    def storyline(self) -> None:
        # a new client's meet and greet, booked online, intake form waiting
        daniel = self.home("daniel")
        meet = self.meet(daniel, 2, status="confirmed")
        meet.created_at = self.now - timedelta(hours=5)
        # Wen's 10-walk pack: six walks used, one booked, three left
        wen = self.home("wen")
        self.meet(wen, wen.since)
        pack = self.package("wen", TEN, self.at(wen.since + 1, 18))
        for index, day in enumerate((-50, -43, -36, -29, -22, -9)):
            self.visit(f"wen_pack_{index}", "wen", WALK30, TESSA, day, package_id=pack.id)
        self.visit("wen_pack_next", "wen", WALK30, TESSA, 3, package_id=pack.id)
        # holiday request: Ben is away over Christmas, and the quote waits for his reply
        holiday = self.estimate(
            "ben_holiday",
            "ben",
            Quote(OVERNIGHT),
            self.now - timedelta(days=2, hours=4),
            status="sent",
            note="Leila stays from Saturday, December 19 to the morning of Sunday, December 27. "
            "Holiday stays need 14 days' notice to cancel.",
            optional=((WALK60, 5, "Extra midday walk for Murphy, weekdays", 4800),),
        )
        line = next(
            r for r in self.ctx.all(Line) if r.estimate_id == holiday.id and r.position == 0
        )
        line.quantity = 8
        line.description = "Overnight Pet Sitting, December 19 to 27 (8 nights)"
        line.amount_cents = line.unit_amount_cents * 8
        # a late cancellation: two hours' notice, so half the walk is charged
        late = self.visit("ryan_late", "ryan", WALK30, AMRIT, -9, settle=None, status="canceled")
        assert late is not None
        canceled = late.starts_at - timedelta(hours=2)
        late.canceled_at = late.updated_at = canceled
        fee = self.invoice(
            "ryan_late",
            "ryan",
            canceled + timedelta(hours=4),
            canceled + timedelta(hours=3),
            "Cancelled two hours before the walk; half the walk price, under the 24-hour "
            "cancellation terms.",
        )
        self.ctx.add(
            Line(
                id=f"ln_{fee.id}_0",
                business_id=self.spec.id,
                invoice_id=fee.id,
                item_id=WALK30,
                description="Late cancellation, Dog Walk, 30 minutes (half price)",
                quantity=1,
                unit_amount_cents=1600,
                amount_cents=1600,
                tax_class="federal_only",
                position=0,
                created_at=fee.created_at,
                updated_at=fee.created_at,
            )
        )
        self.settle(fee, "ryan", "card")
        # a no-show: the lockbox code had changed, so the walk is charged in full
        missed = self.visit(
            "derek_missed", "derek", WALK30, AMRIT, -33, settle=None, status="no_show"
        )
        assert missed is not None
        self.note(
            missed.id,
            "booking",
            "Lockbox code didn't work and Derek wasn't answering. Waited 15 minutes. He has "
            "since sent the new code.",
            missed.starts_at + timedelta(minutes=20),
        )
        charged = self.invoice(
            "derek_missed",
            "derek",
            missed.starts_at + timedelta(hours=3),
            missed.starts_at + timedelta(hours=2),
            "We couldn't get in for the walk, so it's charged in full under the cancellation "
            "terms.",
        )
        self.line(charged.id, WALK30, charged.created_at)
        self.settle(charged, "derek", "etransfer")
        # Tap to Pay at the door: Hugo's walk and a collar light for the dark evenings
        hugo = self.visit("hugo", "hugo", WALK60, BOSS, -6, settle=None)
        assert hugo is not None and hugo.completed_at is not None
        self.sale(
            "hugo",
            "hugo",
            BOSS,
            Quote(WALK60, ((LIGHT, 1),)),
            hugo,
            hugo.created_at,
            hugo.completed_at + timedelta(minutes=4),
        )
        # gift cards: one partly used for cat visits, one still to be spent
        card = self.gift_card(
            "paul", "catherine", GIFT, 10000, self.at(-62, 13), recipient="Paul Dubois"
        )
        self.redeem(card, 6300, self.at(-50, 17))
        self.gift_card("kate", "olivia", GIFT, 7500, self.at(-20, 19), recipient="Kate Bennett")
        # tips on a few walks
        for key, client_key, staff, day, tip in (
            ("isabel_tip", "isabel", TESSA, -16, 1000),
            ("catherine_tip", "catherine", AMRIT, -27, 500),
            ("kenji_tip", "kenji", BOSS, -44, 800),
        ):
            self.visit(key, client_key, WALK60, staff, day, tip=(staff, tip))
        # the plan terms: one client is still deciding, one turned it down
        self.sign("tyler_plan", "tyler", PLAN_TERMS, self.at(-12, 10), None, status="declined")
        self.sign("hamid_plan", "hamid", PLAN_TERMS, self.at(-2, 16), None, status="pending")

    def history(self) -> None:
        ctx = self.ctx
        long_time = [h for h in HOMES if h.since <= -240 and h.key not in {"daniel", "wen"}]
        for index, home in enumerate(sorted(long_time, key=lambda h: h.key)):
            self.meet(home, -330 + index * 2)
        for home in HOMES:
            if -240 < home.since < 0 and home.key != "wen":
                self.meet(home, home.since)
        # first-time clients: a walk or two since their meet and greet
        for key, days in (
            ("fatemeh", (-17, -10, -3, 4)),
            ("lena", (-8, 5)),
            ("omar", (-31, -24, -17, -10, -3, 4)),
            ("thomas", (6,)),
            ("hamid", (-73, -60, -46, -32, -18, -4, 9)),
            ("tasha", (-140, -126, -112, -98, -84, -70, -56, -42)),
        ):
            for index, day in enumerate(days):
                self.visit(
                    f"{key}_walk_{index}",
                    key,
                    WALK30 if index % 2 else WALK60,
                    TESSA if index % 2 else BOSS,
                    day,
                    settle=SETTLEMENTS[index % len(SETTLEMENTS)],
                )
        made = self.fill([h for h in SOLO])
        for index, booking in enumerate(made):
            # treats and collar lights sold at the door, on the walk's invoice
            product = TREATS if index % 13 == 3 else LIGHT if index % 41 == 8 else None
            if booking.invoice_id and product is not None:
                created = ctx.get(Invoice, booking.invoice_id).created_at
                self.line(booking.invoice_id, product, created, 1)

    def engagement(self) -> None:
        self.consents()
        self.withdraw("liam", "email", self.now - timedelta(days=40))
        self.broadcast(
            "holidays",
            "Holiday sitting dates",
            "Our December calendar is open. Leila is taking overnight stays from December 18 to "
            "January 3, and walks and cat visits run as usual except on December 25 and January "
            "1. Holiday stays fill up by mid-November, so reply to this email or message us with "
            "your dates. Stays over the holidays need 14 days' notice to cancel.",
            self.at(-6, 10),
        )
        self.broadcast(
            "smoke",
            "Walks during smoke advisories",
            "While Metro Vancouver is under a smoke advisory, we'll keep walks to 20 minutes on "
            "quiet streets and spend the rest of each visit playing indoors. Shortened 60-minute "
            "walks are billed at the 30-minute price, and we'll message you if your dog's walk "
            "changes.",
            self.at(-58, 7),
        )
        self.feedback()
        self.conversations()

    def feedback(self) -> None:
        reviews: tuple[tuple[str, str, int, str, str | None], ...] = (
            (
                "isabel",
                "bk_cc_isabel_tip",
                5,
                "Tessa sends a photo from every walk, and Luna comes home tired and happy. "
                "She waits by the door at 2 o'clock now.",
                None,
            ),
            (
                "callum",
                "bk_cc_callum_stay",
                4,
                "Barley clearly had a great time, and Leila kept to his routine. He did come "
                "home soaked and muddy to the elbows after the Pacific Spirit walk and went "
                "straight onto the couch.",
                "A towel-down at the door before he comes inside, please.",
            ),
            (
                "sanjay",
                "bk_cc_sanjay_stay",
                5,
                "Nine nights and we didn't worry once. The daily photos and notes were "
                "lovely, and the house was tidier than we left it.",
                None,
            ),
            (
                "catherine",
                "bk_cc_catherine_tip",
                5,
                "Amrit is so patient with Dot, who is slow these days. He lets her sniff "
                "everything.",
                None,
            ),
            (
                "kenji",
                "bk_cc_kenji_tip",
                5,
                "Rowan worked out a quiet route for Hachi that avoids the dog park. Thank you.",
                None,
            ),
            (
                "maria",
                "bk_cc_maria_stay",
                5,
                "Leila was flexible when our flight changed, and Coco was relaxed when we got "
                "home.",
                None,
            ),
        )
        for key, booking_id, rating, went_well, improve in reviews:
            booking = self.ctx.get(Booking, booking_id)
            if booking.completed_at is None:
                continue
            answers: dict[str, object] = {"rating": rating, "went_well": went_well, "share": True}
            if improve:
                answers["improve"] = improve
            submitted = booking.completed_at + timedelta(hours=26)
            self.response(
                "feedback",
                key,
                FEEDBACK_FORM,
                booking,
                answers,
                submitted,
                created=booking.completed_at + timedelta(hours=2),
            )
            self.review(booking_id.removeprefix("bk_cc_"))

    def conversations(self) -> None:
        ctx = self.ctx
        meet = ctx.get(Booking, "bk_cc_daniel_meet")
        when = meet.created_at + timedelta(minutes=40)
        thread = self.thread("daniel", "email", when)
        self.say(
            thread,
            "Hi, I booked a meet and greet for Juno. She's a year old and still pulls a lot. "
            "Is that a problem for group walks?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Thanks, Daniel. Not a problem. We'll start Juno on solo walks with a front-clip "
            "harness, and once she's settled we can try her with one or two calm dogs. The "
            "intake form is in your email; the vet and how we get in are the important parts.",
            min(when + timedelta(minutes=50), self.now - timedelta(minutes=30)),
        )
        callum = ctx.get(Booking, "bk_cc_callum_stay")
        assert callum.completed_at is not None
        when = callum.completed_at + timedelta(hours=30)
        thread = self.thread("callum", "sms", when)
        self.say(
            thread,
            "Thanks for the feedback, Callum, and sorry about the couch. We've added a towel "
            "and a paw wipe at the door to Barley's notes, so whoever has him dries him off "
            "before he goes inside.",
            when,
        )
        self.say(
            thread,
            "Perfect, thank you. He'd go back tomorrow if he could.",
            when + timedelta(minutes=35),
            sender=None,
        )
        self.note(
            "cl_cc_callum",
            "client",
            "Towel-down and paw wipe at the door before Barley goes inside. Towels are in the "
            "basket by the back door.",
            when,
        )
        when = self.now - timedelta(days=3)
        thread = self.thread("ben", "email", when)
        self.say(
            thread,
            "Hi Rowan, we're away from December 19 to 27 this year. Could Leila stay with "
            "Murphy and Pickles again? Pickles will need her eye drops twice a day.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Hi Ben, yes, Leila has those dates free. I've sent a quote for eight nights, with "
            "midday walks for Murphy as an option. Accept it from the email and the dates are "
            "yours.",
            when + timedelta(hours=20),
        )
        late = ctx.get(Booking, "bk_cc_ryan_late")
        assert late.canceled_at is not None
        when = late.canceled_at
        thread = self.thread("ryan", "sms", when)
        self.say(
            thread,
            "Need to cancel today's walk, my meeting got moved and I'm home.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "No problem, Ryan, we've cancelled it. As it's inside 24 hours, half the walk is "
            "charged under our cancellation terms. The invoice is in your email.",
            when + timedelta(minutes=12),
        )
        chloe = ctx.get(Booking, "bk_cc_chloe_today")
        when = chloe.created_at + timedelta(hours=2)
        thread = self.thread("chloe", "sms", when)
        self.say(
            thread,
            "Could we move Maple's walk from Monday to today this week? I'm out of town Monday.",
            when,
            sender=None,
        )
        self.say(
            thread, "Done, Chloé. Tessa will be there today instead.", when + timedelta(minutes=18)
        )
        aiko = ctx.get(Booking, "bk_cc_aiko_trip_0")
        if aiko.completed_at is not None:
            when = aiko.completed_at + timedelta(minutes=5)
            thread = self.thread("aiko", "sms", when)
            self.say(
                thread,
                "Hi Aiko, Nori came out to say hello and Kabocha ate all his renal food. "
                "Litter is done and the mail is on the table. Photos attached in the app.",
                when,
                sender=LEILA_USER,
            )
            self.say(
                thread,
                "Thank you, Leila. Lovely to see them.",
                when + timedelta(hours=3),
                sender=None,
            )
        isabel = ctx.get(Booking, "bk_cc_isabel_tip")
        if isabel.completed_at is not None:
            when = isabel.completed_at + timedelta(hours=1)
            thread = self.thread("isabel", "email", when)
            self.say(
                thread, "Thank you both for being so good with Luna this summer.", when, sender=None
            )
            self.say(
                thread,
                "Thanks, Isabel. Tessa says Luna is the best at waiting at crosswalks.",
                when + timedelta(hours=2),
            )


def _email(name: str) -> str:
    plain = (
        name.lower()
        .replace("é", "e")
        .replace("í", "i")
        .replace("ü", "u")
        .replace("'", "")
        .replace("-", "")
    )
    return ".".join(plain.split())


EDITION = Cedar
