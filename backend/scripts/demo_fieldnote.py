"""Fieldnote Photography: a portrait and wedding studio in Hamilton, built on the demo engine."""

import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.catalog import Item, ItemKind
from clientbridge.models.clients import Client
from clientbridge.models.documents import FormResponse
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, BookingStatus, Slot
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

FIELDNOTE = "bz_fieldnote"
FIELDNOTE_OWNER = "us_fn_owner"

AMARA, JULIAN, IVY = "st_fn_owner", "st_fn_julian", "st_fn_ivy"
FAMILY, HEADSHOT, NEWBORN, ENGAGEMENT = (
    "it_fn_family",
    "it_fn_headshot",
    "it_fn_newborn",
    "it_fn_engagement",
)
WEDDING, EVENT, SECOND, EXTRA_HOUR = (
    "it_fn_wedding",
    "it_fn_event",
    "it_fn_second_shooter",
    "it_fn_extra_hour",
)
MINI, ORDERING = "it_fn_mini", "it_fn_ordering"
PRINT, CANVAS, ALBUM, USB, PRINT_BOX = (
    "it_fn_print",
    "it_fn_canvas",
    "it_fn_album",
    "it_fn_usb",
    "it_fn_print_box",
)
TEAM, GIFT = "it_fn_headshot_pack", "it_fn_gift"
QUESTIONNAIRE, PLANNING, RELEASE, FEEDBACK = (
    "frm_fn_questionnaire",
    "frm_fn_planning",
    "frm_fn_release",
    "frm_fn_feedback",
)
AGREEMENT, EVENT_AGREEMENT = "con_fn_wedding", "con_fn_event"

# id, kind, name, price, minutes, category, description
ITEMS: tuple[tuple[str, ItemKind, str, int, int | None, str, str], ...] = (
    (
        FAMILY,
        "service",
        "Family session",
        39500,
        60,
        "Portraits",
        "An hour outdoors or at your home for up to six people. You get an online gallery of "
        "at least 40 edited photos within three weeks. A $100 deposit holds the date.",
    ),
    (
        HEADSHOT,
        "service",
        "Headshot session",
        22500,
        30,
        "Portraits",
        "Thirty minutes in the James Street North studio with two outfit changes. You choose "
        "two retouched photos from the session, and more can be added for $40 each.",
    ),
    (
        NEWBORN,
        "service",
        "Newborn session",
        52500,
        180,
        "Portraits",
        "A relaxed session in the warm studio, best in the baby's first two weeks. We book "
        "around your due date and move the session once the baby arrives. Parents and "
        "siblings are welcome in the photos.",
    ),
    (
        ENGAGEMENT,
        "service",
        "Engagement session",
        45000,
        90,
        "Portraits",
        "Ninety minutes at a place you choose in the Hamilton area, with about 50 edited "
        "photos. It's also a chance to get used to the camera before the wedding.",
    ),
    (
        WEDDING,
        "service",
        "Wedding coverage, 8 hours",
        380000,
        480,
        "Weddings and events",
        "Eight hours with Amara, usually from getting ready to the first dance. Includes a "
        "planning call, a sneak peek within a week and the full edited gallery within eight "
        "weeks. A 30% retainer books the date.",
    ),
    (
        EVENT,
        "service",
        "Corporate event coverage, 3 hours",
        105000,
        180,
        "Weddings and events",
        "Three hours at a conference, launch or staff party: speakers, the room, candid "
        "moments and group photos. Edited photos are delivered within five business days. A "
        "30% retainer books the date.",
    ),
    (
        SECOND,
        "service",
        "Second shooter",
        60000,
        360,
        "Weddings and events",
        "A second photographer for six hours, usually from the ceremony through the "
        "reception. They cover the other side of the aisle, guests and the details.",
    ),
    (
        EXTRA_HOUR,
        "service",
        "Extra hour of coverage",
        35000,
        60,
        "Weddings and events",
        "One more hour on a wedding or event, added to the end of the day or earlier for "
        "getting ready.",
    ),
    (
        MINI,
        "class",
        "Mini session, 20 minutes",
        19500,
        20,
        "Mini sessions",
        "A short outdoor session for up to six people on one of our seasonal mini-session "
        "days, with 10 edited photos. A $100 deposit holds your time, and the rest is due on "
        "the day.",
    ),
    (
        ORDERING,
        "service",
        "Viewing and ordering appointment",
        0,
        60,
        "Portraits",
        "An hour at the studio to see your gallery on the big screen and choose prints, "
        "wall art or an album. There's no charge for the appointment.",
    ),
    (
        PRINT,
        "product",
        "Fine art print, 8 x 10",
        4500,
        None,
        "Prints and albums",
        "Printed on matte cotton rag paper by our lab in Toronto, ready in about ten days.",
    ),
    (
        CANVAS,
        "product",
        "Canvas wrap, 16 x 24",
        29500,
        None,
        "Prints and albums",
        "Gallery-wrapped canvas on a 1.5 inch frame, ready to hang. Made to order in about "
        "two weeks.",
    ),
    (
        ALBUM,
        "product",
        "Lay-flat album, 10 x 10",
        115000,
        None,
        "Prints and albums",
        "A lay-flat album with a velvet or linen cover and 30 spreads. We design it, you "
        "approve the layout, and it arrives about six weeks later.",
    ),
    (
        USB,
        "product",
        "Walnut USB keepsake",
        6500,
        None,
        "Prints and albums",
        "A glass USB drive in a walnut box, loaded with your full-resolution gallery.",
    ),
    (
        PRINT_BOX,
        "product",
        "Keepsake print box, 25 prints",
        25000,
        None,
        "Prints and albums",
        "Twenty-five 5 x 7 prints of your choice in a keepsake box, for sharing or framing later.",
    ),
    (
        TEAM,
        "package",
        "Team headshots, 5 sessions",
        97500,
        None,
        "Portraits",
        "Five headshot sessions for your team at the studio, booked whenever suits each "
        "person within a year. The same lighting and backdrop keep the set consistent.",
    ),
    (
        GIFT,
        "gift",
        "Session gift card",
        0,
        None,
        "Gift cards",
        "A gift card in any amount, good toward any session, print or album.",
    ),
)
COLORS = {
    FAMILY: "#7D8F5A",
    HEADSHOT: "#3F6E73",
    NEWBORN: "#C49A8A",
    ENGAGEMENT: "#A3594A",
    WEDDING: "#6B4F3A",
    EVENT: "#4A5A78",
    SECOND: "#8C7A5B",
    EXTRA_HOUR: "#B08850",
    MINI: "#C47A3A",
    ORDERING: "#5E7391",
}
DEPOSITS: dict[str, tuple[str, int]] = {
    FAMILY: ("fixed", 10000),
    NEWBORN: ("fixed", 15000),
    ENGAGEMENT: ("fixed", 10000),
    MINI: ("fixed", 10000),
    WEDDING: ("percent", 30),
    EVENT: ("percent", 30),
}
BUFFERS = {
    FAMILY: 30,
    HEADSHOT: 15,
    NEWBORN: 30,
    ENGAGEMENT: 30,
    WEDDING: 60,
    EVENT: 30,
    SECOND: 60,
    MINI: 10,
    ORDERING: 15,
}
# unit cost, SKU and, for what we keep on the shelf, on hand today and the low-stock line
PRODUCTS: dict[str, tuple[int, str, tuple[int, int] | None]] = {
    PRINT: (700, "FN-PR-0810", None),
    CANVAS: (8500, "FN-CV-1624", None),
    ALBUM: (34000, "FN-AL-1010", None),
    USB: (2100, "FN-USB-WAL", (18, 6)),
    PRINT_BOX: (6800, "FN-BOX-57", (9, 4)),
}
WEEKDAY_HOURS = (time(9, 0), time(18, 0))
HOURS: dict[str, dict[int, tuple[time, time]]] = {
    AMARA: {
        1: WEEKDAY_HOURS,
        2: WEEKDAY_HOURS,
        3: WEEKDAY_HOURS,
        4: (time(9, 0), time(22, 30)),
        5: (time(9, 0), time(22, 30)),
    },
    JULIAN: {
        **{d: (time(11, 0), time(21, 0)) for d in (2, 3, 4)},
        5: (time(9, 0), time(22, 30)),
        6: (time(10, 0), time(17, 0)),
    },
}
# the agreement's version 2 took effect this many days ago; earlier couples signed version 1
AGREEMENT_REVISED = 150

AGREEMENT_V1 = (
    "Fieldnote Photography will photograph your wedding for the hours and with the extras "
    "listed on your accepted estimate. A retainer of 30% of the coverage fee is due when you "
    "sign and is not refundable, because we turn away other couples for your date. The "
    "balance is invoiced after the wedding and is due within 14 days. Your full gallery is "
    "delivered within six weeks of the wedding once the balance is paid. If we can't attend "
    "because of illness or an emergency, we'll send a trusted photographer in our place or "
    "refund everything you've paid."
)
AGREEMENT_BODY = "\n\n".join(
    (
        "This agreement covers the wedding photography Fieldnote Photography provides on the "
        "date and at the places named on your accepted estimate and planning form. It is demo "
        "text for a fictional business, not legal advice.",
        "Coverage\nWe photograph the day for the hours on your estimate, starting at the time "
        "we agree on the planning call. Extra hours can be added on the day at the hourly rate "
        "on the estimate, and are added to the balance invoice.",
        "Retainer and balance\nA retainer of 30% of the coverage fee is due when you sign. It "
        "holds your date and is not refundable, because we turn away other couples for it. The "
        "balance, including albums, prints and any extra hours, is invoiced after the wedding "
        "and is due within 14 days. You can pay by card from the invoice link or by e-Transfer.",
        "Delivery\nYou'll receive a sneak peek of about 20 photos within a week. The full "
        "edited gallery is delivered within eight weeks of the wedding once the balance is "
        "paid; weddings from June to October can take up to ten weeks. Albums are designed "
        "after you choose your photos and arrive about six weeks after you approve the layout.",
        "Travel\nCoverage within 50 km of Hamilton is included. For weddings further away, "
        "travel and any overnight stay are quoted on the estimate before you sign.",
        "Meals and breaks\nFor coverage of six hours or more, please plan a meal for each "
        "photographer at the same time as your guests, so we're ready when the speeches start.",
        "Image use\nYou own your prints and may share your photos for personal use. We keep "
        "the copyright and may show photos from your wedding in our portfolio only if you've "
        "signed our model release.",
        "Changes and cancellation\nIf you move your wedding to a date we have free, the "
        "retainer moves with it. If you cancel, the retainer is kept and nothing more is owed. "
        "If we can't attend because of illness or an emergency, we'll send a trusted "
        "photographer in our place or refund everything you've paid.",
        "Liability\nWe carry backup cameras and record to two memory cards at once. If photos "
        "are lost despite that, our liability is limited to the amount you paid us.",
    )
)
EVENT_BODY = "\n\n".join(
    (
        "This agreement covers event photography for the date, place and hours on your "
        "accepted estimate. It is demo text for a fictional business, not legal advice.",
        "Coverage\nWe photograph speakers, the room, candid moments and any group photos you "
        "list for us. Please send a run of show and a contact for the day at least a week "
        "before the event.",
        "Retainer and balance\nA retainer of 30% of the coverage fee is due when you sign and "
        "is applied to the final invoice. The balance is invoiced after the event and is due "
        "within 14 days.",
        "Delivery\nEdited photos are delivered in an online gallery within five business days, "
        "licensed for your organisation's website, social media, newsletters and press use.",
        "People in the photos\nYou're responsible for telling attendees that the event will "
        "be photographed. We'll avoid photographing anyone who asks us not to.",
        "Cancellation\nYou can move or cancel the event at no charge up to 14 days before it. "
        "After that, the retainer is kept.",
    )
)
QUESTIONNAIRE_FIELDS: tuple[DocField, ...] = (
    (
        "session_type",
        "select",
        "What kind of session is this?",
        None,
        True,
        ("Family", "Newborn", "Headshots", "Engagement", "Mini session"),
    ),
    ("people", "number", "How many people will be in the photos?", None, True, ()),
    (
        "names_ages",
        "longtext",
        "Names and ages of everyone coming",
        "Include pets if they're joining.",
        False,
        (),
    ),
    (
        "location",
        "select",
        "Where would you like the session?",
        None,
        True,
        (
            "In the studio",
            "At home",
            "Outdoors, at a park or trail",
            "Somewhere that means something to us",
        ),
    ),
    ("location_detail", "text", "If it's outdoors or somewhere special, where?", None, False, ()),
    (
        "photo_use",
        "multiselect",
        "How will you use the photos?",
        None,
        False,
        (
            "Prints and wall art",
            "An album",
            "Holiday cards",
            "Sharing online",
            "Work profile or website",
        ),
    ),
    (
        "outfits",
        "longtext",
        "What are you planning to wear?",
        "We're happy to look at outfit options by email before the day.",
        False,
        (),
    ),
    (
        "comfort",
        "longtext",
        "Anything that helps everyone feel comfortable?",
        "For example a child who warms up slowly, a mobility need or a pet that needs breaks.",
        False,
        (),
    ),
    ("must_have", "longtext", "Any photos you especially want?", None, False, ()),
    (
        "heard_from",
        "select",
        "How did you hear about us?",
        None,
        False,
        ("A friend or family member", "Google", "Instagram", "A wedding or event we photographed"),
    ),
)
PLANNING_FIELDS: tuple[DocField, ...] = (
    ("wedding_date", "date", "Wedding date", None, True, ()),
    ("couple", "text", "Both of your names, as you'd like them on the gallery", None, True, ()),
    ("getting_ready", "address", "Where are you getting ready?", None, False, ()),
    ("ceremony_venue", "address", "Ceremony venue address", None, True, ()),
    ("ceremony_time", "time", "Ceremony start time", None, True, ()),
    (
        "reception_venue",
        "address",
        "Reception venue address",
        "Leave this blank if it's the same as the ceremony.",
        False,
        (),
    ),
    (
        "timeline",
        "longtext",
        "Timeline for the day",
        "A rough plan is fine. We'll go through it together on the planning call four weeks "
        "before.",
        True,
        (),
    ),
    (
        "first_look",
        "select",
        "Are you planning a first look?",
        None,
        False,
        ("Yes", "No", "Not sure yet"),
    ),
    ("must_have", "longtext", "Must-have shots", None, True, ()),
    (
        "family_list",
        "longtext",
        "Family photo list",
        "List each group, such as 'Couple with both sets of parents', and name someone who "
        "can help gather everyone.",
        True,
        (),
    ),
    ("guests", "number", "Number of guests", None, False, ()),
    (
        "unplugged",
        "select",
        "Is the ceremony unplugged?",
        None,
        False,
        ("Yes, guests will put phones away", "No", "Not sure yet"),
    ),
    (
        "customs",
        "longtext",
        "Cultural or religious traditions we should know about",
        None,
        False,
        (),
    ),
    ("coordinator", "text", "Planner or day-of coordinator", None, False, ()),
    ("coordinator_phone", "phone", "Their phone number", None, False, ()),
    ("vendor_meal", "checkbox", "A meal is planned for the photographers", None, False, ()),
)
RELEASE_FIELDS: tuple[DocField, ...] = (
    (
        "uses",
        "multiselect",
        "Fieldnote Photography may use photos from my session in",
        "Leave everything unticked if you'd like your photos kept private.",
        False,
        (
            "The studio website and portfolio",
            "Instagram and Facebook",
            "Printed samples in the studio",
            "Photography awards and publications",
        ),
    ),
    (
        "children",
        "select",
        "Photos of children",
        None,
        True,
        ("Show their faces", "Don't show their faces", "No children in the session"),
    ),
    (
        "naming",
        "select",
        "When we share a photo, may we name or tag you?",
        None,
        True,
        ("Yes, name or tag me", "Share it without my name"),
    ),
    (
        "withdraw",
        "checkbox",
        "I understand I can withdraw this release by email at any time, and that photos "
        "already printed or published can't be recalled",
        None,
        True,
        (),
    ),
    ("signed_on", "date", "Date", None, True, ()),
)
FEEDBACK_FIELDS: tuple[DocField, ...] = (
    ("rating", "rating", "How was your experience with us?", None, True, ()),
    ("liked", "longtext", "What went well?", None, False, ()),
    ("improve", "longtext", "What could we do better?", None, False, ()),
    (
        "recommend",
        "select",
        "Would you recommend us to a friend?",
        None,
        False,
        ("Yes", "Maybe", "No"),
    ),
    ("quote", "checkbox", "You may quote my feedback on the website", None, False, ()),
)


@dataclass(frozen=True)
class Contact:
    key: str
    name: str
    photo: bool = False
    tags: tuple[str, ...] = ()
    since: int | None = None
    email: str | None = None


NAMED = (
    Contact("olivia", "Olivia Tran", True, ("wedding",)),
    Contact("sanjay", "Sanjay Desai", True, ("wedding",)),
    Contact("emma", "Emma Kowalski", False, ("wedding",)),
    Contact("kristen", "Kristen Bauer", False, ("wedding",)),
    Contact("aaliyah", "Aaliyah Simmons", True, ("wedding",)),
    Contact("james", "James Okoro", True),
    Contact("chloe", "Chloé Lefebvre", True, since=-560),
    Contact("fatima", "Fatima Haddad", True),
    Contact("wei", "Wei Ling Chen", True, since=-720),
    Contact("rohan", "Rohan Desai"),
    Contact("marco", "Marco Santoro", True, ("wedding",)),
    Contact("nicole", "Nicole Fernandes", True, ("wedding",)),
    Contact("anjali", "Anjali Sharma", True, ("wedding",)),
    Contact("tyler", "Tyler MacLeod", False, ("wedding",)),
    Contact("hana", "Hana Petrović", False, ("wedding",)),
    Contact("joseph", "Joseph Abara", True, ("wedding",)),
    Contact("lauren", "Lauren Kim", False, ("wedding",)),
    Contact("megan", "Megan Keane", True, ("wedding",)),
    Contact(
        "bartonhess",
        "Barton & Hess LLP",
        False,
        ("corporate",),
        email="office.bartonhess@example.test",
    ),
    Contact(
        "ferrovia",
        "Ferrovia Tech Collective",
        False,
        ("corporate",),
        email="events.ferrovia@example.test",
    ),
    Contact(
        "corktown",
        "Corktown Design Co.",
        False,
        ("corporate",),
        email="studio.corktown@example.test",
    ),
    Contact("gabriela", "Gabriela Silva", True, since=-500),
    Contact("piotr", "Piotr Zieliński"),
    Contact("leila", "Leila Shirazi", True, since=-640),
)
REGULARS = (
    Contact("giulia", "Giulia Romano", True, since=-690),
    Contact("ahmed", "Ahmed Hassan"),
    Contact("maria", "Maria Ferreira", since=-610),
    Contact("kevin", "Kevin Nguyen", True),
    Contact("sarah", "Sarah Lindsay"),
    Contact("rajiv", "Rajiv Patel", since=-540),
    Contact("ana", "Ana Ferreira"),
    Contact("ewa", "Ewa Nowicki"),
    Contact("daniel", "Daniel Nwosu", since=-470),
    Contact("mei", "Mei Wong", True, since=-650),
    Contact("jasmine", "Jasmine Ali"),
    Contact("luca", "Luca Bianchi"),
    Contact("natasha", "Natasha Kovač", since=-520),
    Contact("omar", "Omar Saleh"),
    Contact("emily", "Emily MacDonald"),
    Contact("hyunwoo", "Hyun-woo Lee", True),
    Contact("teresa", "Teresa Medeiros", since=-600),
    Contact("brandon", "Brandon Hill"),
    Contact("samira", "Samira Yusuf", True),
    Contact("ryan", "Ryan Murphy"),
    Contact("lina", "Lina Saleh"),
    Contact("marisa", "Marisa Costa", since=-480),
    Contact("andrew", "Andrew Chung"),
    Contact("deepika", "Deepika Rao"),
    Contact("kateryna", "Kateryna Bondar"),
    Contact("jordan", "Jordan Thomas", since=-450),
    Contact("simone", "Simone Baptiste"),
    Contact("arjun", "Arjun Gill"),
    Contact("rebecca", "Rebecca Stewart", since=-530),
    Contact("thanh", "Thanh Le"),
    Contact("aisha", "Aisha Abdi"),
    Contact("paolo", "Paolo Ricci"),
    Contact("claire", "Claire O'Neill"),
    Contact("ibrahim", "Ibrahim Diallo", True, since=-580),
    Contact("sofia", "Sofia Morales"),
    Contact("nathan", "Nathan Cardinal"),
    Contact("victoria", "Victoria Adeyemi"),
    Contact("grace", "Grace Mwangi", True),
    Contact("liam", "Liam Doherty", True, since=-505),
    Contact("isabel", "Isabel Duarte"),
    Contact("kofi", "Kofi Mensah"),
    Contact("zara", "Zara Hussain", True),
    Contact("tomas", "Tomás Herrera"),
    Contact("yuki", "Yuki Morimoto", True, since=-560),
    Contact("erin", "Erin Doherty"),
    Contact("hamid", "Hamid Karimi"),
    Contact("rosa", "Rosa Esposito", since=-660),
    Contact("chantal", "Chantal Pierre"),
    Contact("dmitri", "Dmitri Volkov"),
    Contact("amira", "Amira Nasser"),
    Contact("ben", "Ben Goldberg"),
    Contact("priscila", "Priscila Rocha"),
    Contact("gurpreet", "Gurpreet Sandhu", True, since=-610),
)
CONTACTS = (*NAMED, *REGULARS)
SPRING_MINI = (
    "maria",
    "sarah",
    "ana",
    "ewa",
    "jasmine",
    "natasha",
    "emily",
    "teresa",
    "marisa",
    "kateryna",
    "simone",
    "rebecca",
)
# the fall mini day's clients, in slot order; None is a slot still open
FALL_MINI = (
    "chloe",
    "giulia",
    "kevin",
    "mei",
    "samira",
    "sofia",
    "claire",
    None,
    "deepika",
    "thanh",
    "aisha",
    None,
)
MINI_SLOTS = 12
SETTLEMENTS: tuple[Settle, ...] = ("card", "etransfer", "card", "cash", "card")
FULL = Quote(WEDDING, ((SECOND, 1), (ALBUM, 1), (USB, 1)))
WITH_SECOND = Quote(WEDDING, ((SECOND, 1), (USB, 1)))
BASIC = Quote(WEDDING, ((USB, 1),))
LONGER = Quote(WEDDING, ((SECOND, 1), (EXTRA_HOUR, 2), (USB, 1)))
WITH_BOX = Quote(WEDDING, ((SECOND, 1), (PRINT_BOX, 1), (USB, 1)))


@dataclass(frozen=True)
class Wedding:
    key: str
    partner: str
    quote: Quote
    day: int
    settle: Settle
    venue: str
    reception: str | None = None
    weekday: int = 5
    booked_before: int = 300


CHAPEL = "Glenwood Chapel, 520 Sanatorium Road, Hamilton, ON L9C 1Y5"
FOUNDRY = "The Foundry Hall, 270 Sherman Avenue North, Hamilton, ON L8L 6N4"
ORCHARD = "Cedar Orchard Estate, 1180 Guyatt Road, Binbrook, ON L0R 1C0"
WATERFRONT = "Harbour Pavilion, 47 Discovery Drive, Hamilton, ON L8L 8K4"
GARDENS = "Westdale Gardens, 1100 King Street West, Hamilton, ON L8S 1L8"
LOFT = "The Linden Loft, 41 Ferguson Avenue South, Hamilton, ON L8N 2S6"
WEDDINGS = (
    Wedding("marco", "Elena Russo", WITH_SECOND, -176, "card", CHAPEL, FOUNDRY),
    Wedding("anjali", "Dev Kapoor", FULL, -134, "etransfer", ORCHARD),
    Wedding("aaliyah", "Marcus Bell", FULL, -120, "etransfer", GARDENS, LOFT),
    Wedding("tyler", "Jessica Nolan", BASIC, -106, "card", WATERFRONT),
    Wedding("hana", "Luka Babić", WITH_BOX, -92, "etransfer", CHAPEL, WATERFRONT),
    Wedding("joseph", "Adaeze Nwosu", LONGER, -78, "card", ORCHARD),
    Wedding("nicole", "Rui Almeida", FULL, -64, "card", GARDENS, FOUNDRY),
    Wedding("lauren", "Daniel Cho", WITH_SECOND, -57, "etransfer", LOFT, weekday=4),
    Wedding("kristen", "Matt Sullivan", FULL, -50, "overdue", ORCHARD),
    Wedding("emma", "Jakub Nowak", WITH_SECOND, -9, "open", CHAPEL, FOUNDRY, booked_before=240),
    Wedding("sanjay", "Meera Iyer", FULL, 18, "open", WATERFRONT, booked_before=245),
    Wedding("megan", "Connor Walsh", WITH_SECOND, 32, "open", GARDENS, LOFT, booked_before=150),
)


def _ascii(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()


def _email(contact: Contact) -> str:
    if contact.email is not None:
        return contact.email
    first, last = contact.name.split(" ", 1)
    clean = "".join(c for c in _ascii(last) if c.isalnum())
    return f"{''.join(c for c in _ascii(first) if c.isalnum())}.{clean}@example.test"


def _offering(row: tuple[str, ItemKind, str, int, int | None, str, str]) -> Offering:
    item_id, kind, name, price, minutes, category, description = row
    product = PRODUCTS.get(item_id)
    deposit = DEPOSITS.get(item_id)
    shelf = product[2] if product else None
    return Offering(
        id=item_id,
        kind=kind,
        name=name,
        price_cents=price,
        category=category,
        description=description,
        tax_class="exempt" if kind == "gift" else "standard",
        minutes=minutes,
        color=COLORS.get(item_id, "#6B4F3A"),
        online_bookable=item_id in {FAMILY, HEADSHOT, NEWBORN, ENGAGEMENT, MINI},
        capacity=1 if kind == "class" else None,
        addon_for=(WEDDING, ORDERING, FAMILY, NEWBORN) if kind == "product" else (),
        buffer_after_min=BUFFERS.get(item_id, 0),
        deposit_type="fixed"
        if deposit and deposit[0] == "fixed"
        else "percent"
        if deposit
        else "none",
        deposit_value=deposit[1] if deposit else None,
        sku=product[1] if product else None,
        cost_cents=product[0] if product else None,
        stock=Stock(*shelf) if shelf else None,
        sessions=5 if kind == "package" else None,
        covers=HEADSHOT if kind == "package" else None,
        validity_days=365 if kind == "package" else None,
        ref="team" if kind == "package" else None,
    )


SPEC = BusinessSpec(
    listing=demo_business(FIELDNOTE),
    code="fn",
    slug="fieldnote",
    login_domain="fieldnote.example",
    owner=FIELDNOTE_OWNER,
    people=(
        Person(
            FIELDNOTE_OWNER,
            AMARA,
            "owner",
            "Amara Osei",
            "+19055550190",
            "owner",
            "Owner and lead photographer",
            "#6B4F3A",
            HOURS[AMARA],
        ),
        Person(
            "us_fn_julian",
            JULIAN,
            "julian",
            "Julian Moretti",
            "+19055550191",
            "staff",
            "Associate photographer and second shooter",
            "#3F6E73",
            HOURS[JULIAN],
            payee=True,
            rate_type="percent",
            rate_bps=4000,
        ),
        Person(
            "us_fn_ivy",
            IVY,
            "ivy",
            "Ivy Nguyen",
            "+19055550192",
            "admin",
            "Studio manager and photo editor",
            "#8A6F9E",
            bookable_online=False,
            rate_type="hourly",
            rate_cents=2600,
        ),
    ),
    items=tuple(_offering(row) for row in ITEMS),
    brand={
        "tagline": "Family, newborn and wedding photography in Hamilton, Ontario.",
        "about": (
            "Fieldnote Photography is a small studio on James Street North. Amara photographs "
            "weddings and families, Julian leads most portrait sessions and second "
            "shoots the weddings, and Ivy runs the studio and edits every gallery. Portrait "
            "galleries are delivered within three weeks and wedding galleries within eight. "
            "Prints and albums are made by a lab we've worked with for years, and you can "
            "choose them with us at the studio."
        ),
        "address": "214 James Street North, Hamilton, ON L8R 2L3",
        "phone": "+1 905-555-0198",
        "email": "hello@fieldnote.example",
        "neighbourhood": "James Street North",
    },
    booking_policy={
        "approve_new_clients": True,
        "lead_hours": 48,
        "step_min": 30,
        "cancel_cutoff_hours": 72,
        "reschedule_cutoff_hours": 72,
    },
    subject=None,
    sms_number="+19055550199",
    gst_hst_number="784512903RT0001",
    forms=(
        FormSpec(
            QUESTIONNAIRE,
            "Session questionnaire",
            "ff_fn_",
            QUESTIONNAIRE_FIELDS,
            send_on="booking",
        ),
        FormSpec(PLANNING, "Wedding planning form", "ff_fn_planning_", PLANNING_FIELDS),
        FormSpec(
            RELEASE, "Model release", "ff_fn_release_", RELEASE_FIELDS, require_signature=True
        ),
        FormSpec(FEEDBACK, "Session feedback", "ff_fn_feedback_", FEEDBACK_FIELDS),
    ),
    contracts=(
        ContractSpec(
            AGREEMENT,
            "Wedding photography agreement",
            AGREEMENT_BODY,
            version=2,
            earlier_body=AGREEMENT_V1,
            revised_day=-AGREEMENT_REVISED,
        ),
        ContractSpec(EVENT_AGREEMENT, "Event photography agreement", EVENT_BODY),
    ),
    storyline=(
        Stage(
            "Wedding inquiry with an estimate sent", "olivia", ("est_fn_olivia", "sig_fn_olivia")
        ),
        Stage(
            "Wedding booked: estimate accepted, agreement signed, retainer paid",
            "sanjay",
            ("est_fn_sanjay", "sig_fn_sanjay", "bk_fn_sanjay", "fr_fn_planning_sanjay"),
        ),
        Stage(
            "Wedding done, balance invoiced before the gallery is delivered",
            "emma",
            ("bk_fn_emma", "inv_fn_emma"),
        ),
        Stage("Balance invoice overdue, partly paid", "kristen", ("inv_fn_kristen",)),
        Stage(
            "Past wedding fully paid, with a five-star review",
            "aaliyah",
            ("inv_fn_aaliyah", "fr_fn_feedback_aaliyah"),
        ),
        Stage("Headshot session today", "james", ("bk_fn_james_today",)),
        Stage(
            "Family mini-session day, most slots booked",
            "chloe",
            ("ses_fn_fall_mini_00", "bk_fn_fall_mini_chloe"),
        ),
        Stage(
            "Newborn session booked around the due date",
            "fatima",
            ("bk_fn_fatima_newborn",),
        ),
        Stage(
            "Print order sold at the ordering appointment",
            "wei",
            ("bk_fn_wei_ordering", "ord_fn_wei"),
        ),
        Stage(
            "Four-star review about delivery time, with a reply",
            "rohan",
            ("fr_fn_feedback_rohan", "th_fn_rohan_email"),
        ),
        Stage("Team headshots on a 5-session package", "bartonhess", ("pkg_fn_team_bartonhess",)),
        Stage(
            "Corporate event paid, and a declined event estimate",
            "ferrovia",
            ("bk_fn_ferrovia", "est_fn_corktown"),
        ),
    ),
    pacing=Pacing(
        {AMARA: 1, JULIAN: 2},
        (FAMILY, HEADSHOT, FAMILY, FAMILY, HEADSHOT),
        weeks=30,
        ahead_weeks=5,
        seasonality={
            1: 0.5,
            2: 0.5,
            3: 0.7,
            4: 0.9,
            5: 1.1,
            6: 1.0,
            7: 0.8,
            8: 0.9,
            9: 1.4,
            10: 1.5,
            11: 1.2,
            12: 0.8,
        },
        settlements=SETTLEMENTS,
        cancel_every=23,
    ),
    photo_clients=tuple(c.key for c in CONTACTS if c.photo),
    inbox_user="us_fn_ivy",
    founded_day=-1500,
    catalog_day=-420,
    documents_day=-415,
    restock_days=(-410, -330, -250, -170, -90, -25),
    payouts_from_day=-230,
    invoice_start=1400,
    estimate_start=200,
    cheque_start=4400,
    seed=41,
)


class Fieldnote(Demo):
    spec = SPEC

    def __init__(self, now: datetime) -> None:
        super().__init__(now)
        self.partial: Payment | None = None

    def story(self) -> None:
        self.clients()
        self.time_off(
            "julian_away",
            JULIAN,
            datetime.combine(self.monday(-73), time(0, 0), self.ctx.zone).astimezone(UTC),
            datetime.combine(
                self.monday(-73) + timedelta(days=4), time(23, 59), self.ctx.zone
            ).astimezone(UTC),
            "Family visit in Italy",
        )
        self.minis()
        self.weddings()
        self.inquiry()
        self.today()
        self.portraits()
        self.corporate()
        self.fill([c.key for c in REGULARS])
        self.paid_promptly()
        self.held_deposits()
        self.engagement()

    def visit_note(self, item: Item, booking: Booking) -> str:
        day = self.local(booking.starts_at)
        return f"{item.name}, {day:%B} {day.day}."

    def bill(
        self, booking: Booking, settle: Settle, *, tip: tuple[str, int] | None = None
    ) -> Invoice | None:
        """Every portrait deposit is paid when the session is booked and applied at checkout."""
        if (
            booking.completed_at is not None
            and booking.deposit_amount_cents
            and booking.deposit_status == "none"
            and booking.price_cents
        ):
            self.deposit(booking, booking.created_at + timedelta(minutes=10))
        return super().bill(booking, settle, tip=tip)

    def finish(self) -> None:
        super().finish()
        if self.partial is not None:
            invoice = self.ctx.get(Invoice, self.partial.invoice_id or "")
            held = sum(
                b.deposit_amount_cents for b in self.ctx.all(Booking) if b.invoice_id == invoice.id
            )
            self.partial.amount_cents = (invoice.total_cents - held) // 2

    def monday(self, day: int) -> date:
        local = self.local(self.at(day)).date()
        return local - timedelta(days=local.weekday())

    def weekday_near(self, day: int, weekday: int) -> date:
        """The given weekday on or before `day`, or on or after it for a future day."""
        local = self.local(self.at(day)).date()
        if day > 0:
            return local + timedelta(days=(weekday - local.weekday()) % 7)
        return local - timedelta(days=(local.weekday() - weekday) % 7)

    def on(self, day: date, at: time) -> datetime:
        return datetime.combine(day, at, self.ctx.zone).astimezone(UTC)

    def clients(self) -> None:
        for index, contact in enumerate(CONTACTS):
            corporate = "corporate" in contact.tags
            self.client(
                contact.key,
                contact.name,
                _email(contact),
                f"+1905555{100 + index:04}",
                tags=list(contact.tags),
                channel="email"
                if corporate or "wedding" in contact.tags or index % 3 == 0
                else "sms",
                fields={"source": ("referral", "google", "instagram", "wedding guest")[index % 4]},
                since=self.at(contact.since, 11) if contact.since is not None else None,
            )
        self.photos()

    def fits(self, staff: str, start: datetime, minutes: int, after: int = 0) -> bool:
        end = start + timedelta(minutes=minutes)
        return self.within_hours(staff, start, end) and self.free(staff, None, start, end, 0, after)

    def minis(self) -> None:
        """A spring mini-session day that has run and a fall one this coming Saturday."""
        for prefix, day, roster in (
            ("spring_mini", self.weekday_near(-157, 5), SPRING_MINI),
            ("fall_mini", self.weekday_near(3, 5), FALL_MINI),
        ):
            past = day < self.local(self.now).date()
            opened = self.on(day, time(9, 0)) - timedelta(days=30)
            for index in range(MINI_SLOTS):
                start = self.on(day, time(9, 0)) + timedelta(minutes=30 * index)
                session = self.session(f"{prefix}_{index:02}", MINI, AMARA, start)
                session.created_at = min(opened, self.now - timedelta(days=1))
                key = roster[index] if index < len(roster) else None
                if key is None:
                    continue
                created = min(
                    opened + timedelta(days=1 + index % 9, hours=index),
                    self.now - timedelta(hours=6 + index),
                )
                booking = self.book(
                    f"{prefix}_{key}",
                    key,
                    MINI,
                    AMARA,
                    start,
                    "completed" if past else "confirmed",
                    created,
                    source="online",
                    slot=session,
                )
                self.deposit(booking, created + timedelta(minutes=10))
                if past:
                    self.bill(booking, "cash" if index % 3 == 0 else "card")
        self.response(
            "release",
            "chloe",
            RELEASE,
            self.ctx.get(Booking, "bk_fn_fall_mini_chloe"),
            {},
            None,
        )
        self.response(
            "questionnaire",
            "chloe",
            QUESTIONNAIRE,
            self.ctx.get(Booking, "bk_fn_fall_mini_chloe"),
            {
                "session_type": "Mini session",
                "people": 4,
                "names_ages": "Chloé and Mathieu, Léa (6), Noah (3), and our dog Biscuit",
                "location": "Outdoors, at a park or trail",
                "photo_use": ["Holiday cards", "Prints and wall art"],
                "outfits": "Cream, rust and denim. Léa insists on her yellow boots.",
                "comfort": "Noah is shy for the first few minutes, so a slow start helps.",
                "heard_from": "A friend or family member",
            },
            min(
                self.ctx.get(Booking, "bk_fn_fall_mini_chloe").created_at + timedelta(hours=3),
                self.now - timedelta(hours=2),
            ),
        )

    def weddings(self) -> None:
        for wedding in WEDDINGS:
            self.wedding(wedding)

    def wedding(self, wedding: Wedding) -> Booking:
        key, quote = wedding.key, wedding.quote
        day = self.weekday_near(wedding.day, wedding.weekday)
        extra = sum(qty for part, qty in quote.parts if part == EXTRA_HOUR)
        start = self.on(day, time(13 - extra, 0))
        minutes = 480 + 60 * extra
        past = start + timedelta(minutes=minutes) < self.now
        if not self.fits(AMARA, start, minutes, 60):
            raise ValueError(f"{key}: the wedding doesn't fit Amara's calendar")
        sent = max(self.at(wedding.day - wedding.booked_before, 10), self.at(-405, 10))
        self.joined(key, sent - timedelta(days=2))
        accepted = sent + timedelta(days=3, hours=5)
        estimate = self.estimate(
            key,
            key,
            quote,
            sent,
            status="accepted",
            decided=accepted,
            note=self.quote_note(quote),
        )
        self.sign(key, key, AGREEMENT, accepted + timedelta(minutes=25), None)
        booked = accepted + timedelta(minutes=40)
        status: BookingStatus = "completed" if past else "confirmed"
        booking = self.book(key, key, WEDDING, AMARA, start, status, booked)
        if extra:
            self.stretch(booking, minutes)
        self.deposit(booking, booked + timedelta(minutes=10))
        second: Booking | None = None
        if any(part == SECOND for part, _ in quote.parts):
            second_start = start + timedelta(minutes=60 + 60 * extra)
            if not self.fits(JULIAN, second_start, 360, 60):
                raise ValueError(f"{key}: Julian can't second shoot")
            second = self.book(
                f"{key}_second", key, SECOND, JULIAN, second_start, status, booked, price=0
            )
        client = self.ctx.get(Client, self.client_id(key))
        first = client.name.split(" ")[0]
        self.note(
            client.id,
            "client",
            f"{first} and {wedding.partner}, married {day:%B} {day.day}, {day.year}. Ceremony at "
            f"{wedding.venue.split(',')[0]}"
            + (f", reception at {wedding.reception.split(',')[0]}." if wedding.reception else "."),
            booked,
        )
        self.planning(wedding, booking, day, f"{first} and {wedding.partner}")
        if not past:
            # booking an estimate carries its product lines only, as the product does
            products = tuple(p for p in quote.parts if self.items[p[0]].kind == "product")
            self.addons(booking, estimate, Quote(quote.service, products))
            return booking
        assert booking.completed_at is not None
        issued = min(self.on(day + timedelta(days=2), time(10, 0)), self.now - timedelta(hours=2))
        paid_on = self.local(booked + timedelta(minutes=10)).date()
        invoice = self.invoice(
            key,
            key,
            issued,
            booked,
            f"Balance for wedding coverage on {day:%B} {day.day}, {day.year}. The retainer paid "
            f"on {paid_on:%B} {paid_on.day}, {paid_on.year} is applied. Your full gallery is "
            "delivered once the balance is paid.",
        )
        booking.invoice_id = estimate.converted_invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booked, booking=booking)
        if second is not None:
            position = 1 + [part for part, _ in quote.parts].index(SECOND)
            line = self.ctx.get(Line, f"ln_{invoice.id}_{position}")
            line.booking_id, line.staff_id = second.id, JULIAN
            second.invoice_id = invoice.id
        if wedding.settle == "overdue":
            issued = self.on(day + timedelta(days=2), time(10, 0))
            invoice.issued_at = invoice.updated_at = issued
            invoice.due_at = issued + timedelta(days=14)
            self.settle(invoice, key, "overdue")
            self.partial = self.payment(
                key,
                issued + timedelta(days=33, hours=3),
                "etransfer",
                invoice_id=invoice.id,
                size="balance",
            )
        else:
            self.settle(invoice, key, wedding.settle)
        return booking

    def stretch(self, booking: Booking, minutes: int) -> None:
        """A wedding with extra hours booked runs past the coverage item's eight hours."""
        slot = self.ctx.get(Slot, booking.slot_id)
        end = slot.starts_at + timedelta(minutes=minutes)
        self.busy = [
            (s, sj, st, end if (s, st) == (slot.staff_id, slot.starts_at) else en, b, a)
            for s, sj, st, en, b, a in self.busy
        ]
        slot.ends_at = end
        if booking.completed_at is not None:
            booking.completed_at = end

    def quote_note(self, quote: Quote) -> str:
        parts = {part for part, _ in quote.parts}
        extras = [
            text
            for item_id, text in (
                (SECOND, "a second shooter from the ceremony to the first dance"),
                (EXTRA_HOUR, "two extra hours for the send-off"),
                (ALBUM, "a lay-flat album"),
                (PRINT_BOX, "a keepsake print box"),
            )
            if item_id in parts
        ]
        if not extras:
            return "Eight hours of coverage, and your gallery on a walnut USB keepsake."
        listed = extras[0] if len(extras) == 1 else ", ".join(extras[:-1]) + " and " + extras[-1]
        return f"Eight hours of coverage with {listed}, and your gallery on a walnut USB keepsake."

    def planning(self, wedding: Wedding, booking: Booking, day: date, couple: str) -> None:
        submitted = self.on(day - timedelta(days=35), time(20, 15))
        if submitted >= self.now - timedelta(hours=2):
            submitted = min(booking.created_at + timedelta(days=60), self.now - timedelta(hours=3))
        index = sum(map(ord, wedding.key))
        ceremony = time(14, 0) if wedding.weekday == 5 else time(15, 30)
        answers: dict[str, object] = {
            "wedding_date": day.isoformat(),
            "couple": couple,
            "getting_ready": (
                "Hotel on King Street East, suite 1204, Hamilton, ON L8N 1A1",
                "Parents' house, 88 Rosslyn Avenue South, Hamilton, ON L8M 3J1",
                "Airbnb on Locke Street South, Hamilton, ON L8P 4B2",
            )[index % 3],
            "ceremony_venue": wedding.venue,
            "ceremony_time": ceremony.isoformat(timespec="minutes"),
            "timeline": "1:00 getting ready and details. 2:00 ceremony, then family photos on "
            "the steps. 3:00 couple photos. 5:00 cocktails. 6:00 dinner and speeches. 8:30 "
            "first dance and open dance floor.",
            "first_look": ("Yes", "No", "Not sure yet")[index % 3],
            "must_have": "The two of us with both grandmothers. Rings with the invitations. "
            "Our dog with the wedding party before the ceremony.",
            "family_list": "1. Couple with both sets of parents. 2. Each side's immediate "
            "family. 3. Grandparents. 4. Cousins on the steps. My sister Priya will gather "
            "everyone.",
            "guests": 80 + index % 90,
            "unplugged": "Yes, guests will put phones away" if index % 2 else "Not sure yet",
            "vendor_meal": True,
        }
        if wedding.reception:
            answers["reception_venue"] = wedding.reception
        if wedding.key in {"anjali", "sanjay"}:
            answers["customs"] = (
                "A haldi in the morning at home and the baraat before the ceremony. Our aunt "
                "will tell you when the pheras start."
            )
        if index % 2 == 0:
            answers["coordinator"] = "Rachel at Bay Events"
            answers["coordinator_phone"] = "+19055550197"
        self.response(
            "planning",
            wedding.key,
            PLANNING,
            booking,
            answers,
            submitted,
            created=min(submitted - timedelta(days=4), booking.created_at + timedelta(days=30)),
        )

    def inquiry(self) -> None:
        sent = self.at(-4, 11)
        self.joined("olivia", sent - timedelta(days=4))
        self.estimate(
            "olivia",
            "olivia",
            BASIC,
            sent,
            status="sent",
            note="Eight hours of coverage, from getting ready at the house to the first dance. The "
            "second shooter, extra hours, album and print box are optional, so add any of them "
            "when you accept.",
            optional=(
                (SECOND, 1, "Second shooter, ceremony to first dance", 60000),
                (EXTRA_HOUR, 2, "Two extra hours, to cover the send-off", 35000),
                (ALBUM, 1, "Lay-flat album, 10 x 10, 30 spreads", 115000),
                (PRINT_BOX, 1, "Keepsake print box, 25 prints", 25000),
            ),
        )
        self.sign(
            "olivia", "olivia", AGREEMENT, sent + timedelta(minutes=5), None, status="pending"
        )
        corktown_sent = self.at(-33, 10)
        self.joined("corktown", corktown_sent - timedelta(days=2))
        declined = self.estimate(
            "corktown",
            "corktown",
            Quote(EVENT, ((EXTRA_HOUR, 1),)),
            corktown_sent,
            status="declined",
            decided=corktown_sent + timedelta(days=6),
            note="Four hours at your open studio night: the room, the speakers and portraits of "
            "the team by the windows.",
        )
        declined.decline_reason = (
            "We've decided to have someone on the team take photos this year. Thanks for the "
            "quick quote."
        )

    def today(self) -> None:
        local = self.local(self.now)
        floor = local.replace(minute=local.minute // 15 * 15, second=0, microsecond=0)
        start = (floor + timedelta(minutes=45)).astimezone(UTC)
        if not self.fits(AMARA, start, 30, 15):
            found = self.place(AMARA, HEADSHOT, 1, None, past=False)
            assert found is not None
            start = found
        booking = self.book(
            "james_today",
            "james",
            HEADSHOT,
            AMARA,
            start,
            "confirmed",
            self.at(-9, 15),
            source="online",
        )
        booking.manage_token = "manage_bk_fn_james_today"
        self.note(
            booking.id,
            "booking",
            "New LinkedIn and firm website photos. Bringing a navy suit and a grey sweater. Use "
            "the grey backdrop to match last year's partner photos.",
            booking.created_at,
        )
        self.response(
            "questionnaire",
            "james",
            QUESTIONNAIRE,
            booking,
            {
                "session_type": "Headshots",
                "people": 1,
                "location": "In the studio",
                "photo_use": ["Work profile or website"],
                "outfits": "A navy suit with a white shirt, and a grey crewneck for a more "
                "relaxed option.",
                "must_have": "One with a slight smile and one more serious for the firm's site.",
                "heard_from": "Google",
            },
            booking.created_at + timedelta(hours=4),
        )

    def portraits(self) -> None:
        ctx = self.ctx
        # newborn booked around the due date, to be moved once the baby arrives
        due = self.weekday_near(23, 2)
        fatima = self.book(
            "fatima_newborn",
            "fatima",
            NEWBORN,
            AMARA,
            self.on(due, time(10, 0)),
            "confirmed",
            self.at(-26, 14),
            source="online",
        )
        fatima.manage_token = "manage_bk_fn_fatima_newborn"
        self.deposit(fatima, fatima.created_at + timedelta(minutes=10))
        due_date = self.weekday_near(14, 6)
        self.note(
            fatima.id,
            "booking",
            f"Due {due_date:%B} {due_date.day}. This date is a placeholder about ten days after "
            "the due date; Fatima will text when the baby arrives and we'll move it into the "
            "first two weeks. Second baby, big brother Yusuf (4) joins for the family photos.",
            fatima.created_at + timedelta(minutes=20),
        )
        self.response("questionnaire", "fatima", QUESTIONNAIRE, fatima, {}, None)
        # a newborn session done this summer, with a release that keeps the baby's face private
        leila = self.visit("leila_newborn", "leila", NEWBORN, AMARA, -45, settle="etransfer")
        assert leila is not None and leila.completed_at is not None
        self.release("leila", leila, ["The studio website and portfolio"], "Don't show their faces")
        # the print order: a family session, then the ordering appointment paid by Tap to Pay
        family = self.visit("wei_family", "wei", FAMILY, JULIAN, -19, settle="card")
        assert family is not None and family.completed_at is not None
        self.release("wei", family, ["The studio website and portfolio", "Instagram and Facebook"])
        ordering = self.visit("wei_ordering", "wei", ORDERING, AMARA, -4, settle=None)
        assert ordering is not None and ordering.completed_at is not None
        self.sale(
            "wei",
            "wei",
            AMARA,
            Quote(ORDERING, ((PRINT, 4), (CANVAS, 1), (USB, 1))),
            ordering,
            ordering.created_at,
            ordering.completed_at + timedelta(minutes=5),
        )
        self.note(
            ordering.id,
            "booking",
            "Chose the canvas from the bench photo by the creek, four 8 x 10s for the "
            "grandparents and the USB. The lab order goes in on Monday.",
            ordering.completed_at,
        )
        # the four-star review about delivery time
        rohan = self.visit("rohan_family", "rohan", FAMILY, JULIAN, -48, settle="card")
        assert rohan is not None
        # engagement sessions for couples who booked one
        for key, staff, day in (("lauren", AMARA, -150), ("sanjay", JULIAN, -62)):
            self.visit(f"{key}_engagement", key, ENGAGEMENT, staff, day, settle="card")
        megan = self.visit("megan_engagement", "megan", ENGAGEMENT, AMARA, 9)
        assert megan is not None
        self.deposit(megan, megan.created_at + timedelta(minutes=10))
        self.note(
            megan.id,
            "booking",
            "Dundas Peak at sunrise if the trail is open, otherwise the Christie Lake trails.",
            megan.created_at,
        )
        # a session cut short by rain, half refunded
        piotr = self.visit("piotr_family", "piotr", FAMILY, JULIAN, -128, settle="card")
        assert piotr is not None and piotr.invoice_id is not None
        paid = next(p for p in ctx.all(Payment) if p.invoice_id == piotr.invoice_id)
        assert paid.paid_at is not None
        self.refund(
            paid,
            17300,
            paid.paid_at + timedelta(days=1, hours=1),
            "Heavy rain ended the session after 25 minutes; half of the session fee refunded",
        )
        # a tip for Julian, a gift card redeemed on a session, and one still unspent
        self.visit("joseph_headshot", "joseph", HEADSHOT, JULIAN, -30, tip=(JULIAN, 3000))
        self.joined("ahmed", self.at(-97, 12))
        card = self.gift_card(
            "lina", "ahmed", GIFT, 45000, self.at(-96, 18), recipient="Lina Saleh"
        )
        lina = self.visit(
            "lina_gift",
            "lina",
            FAMILY,
            JULIAN,
            -61,
            price=0,
            settle=None,
            note=f"Paid with gift card {card.code} from Ahmed.",
        )
        assert lina is not None and lina.completed_at is not None
        self.redeem(card, 44635, lina.completed_at + timedelta(minutes=20))
        self.gift_card(
            "romano", "giulia", GIFT, 25000, self.at(-21, 12), recipient="Rosa and Enzo Romano"
        )
        self.gift_card("silva", "gabriela", GIFT, 40000, self.at(-8, 19), recipient="Mariana Silva")
        for key, staff, day in (("aaliyah", JULIAN, -40), ("gabriela", JULIAN, -27)):
            self.visit(f"{key}_family", key, FAMILY, staff, day, settle="etransfer")
        self.visit("brandon_moved", "brandon", FAMILY, JULIAN, 6)

    def release(
        self,
        key: str,
        booking: Booking,
        uses: list[str],
        children: str = "Show their faces",
    ) -> None:
        assert booking.completed_at is not None
        client = self.ctx.get(Client, booking.client_id)
        signed = booking.completed_at + timedelta(minutes=15)
        self.response(
            "release",
            key,
            RELEASE,
            booking,
            {
                "uses": uses,
                "children": children,
                "naming": "Yes, name or tag me" if len(key) % 2 else "Share it without my name",
                "withdraw": True,
                "signed_on": self.local(signed).date().isoformat(),
            },
            signed,
            created=booking.created_at + timedelta(minutes=8),
            signature={"name": client.name, "strokes": None, "ip": "192.0.2.61"},
        )

    def corporate(self) -> None:
        self.joined("bartonhess", self.at(-158, 10))
        pack = self.package("bartonhess", TEAM, self.at(-152, 14))
        for index, (day, person) in enumerate(
            (
                (-141, "Deborah Hess"),
                (-98, "Aaron Mitchell"),
                (-61, "Priyanka Bose"),
                (12, "Tom Ferreira"),
            )
        ):
            booking = self.visit(
                f"bartonhess_{index}",
                "bartonhess",
                HEADSHOT,
                AMARA,
                day,
                package_id=pack.id,
                note=f"Headshot for {person}, on the firm's 5-session package.",
            )
            assert booking is not None
        sent = self.at(-71, 10)
        self.joined("ferrovia", sent - timedelta(days=3))
        quote = Quote(EVENT, ())
        estimate = self.estimate(
            "ferrovia",
            "ferrovia",
            quote,
            sent,
            status="accepted",
            decided=sent + timedelta(days=2),
            note="Three hours at the fall demo night: the talks, the demo tables and a group "
            "photo of the members before the doors open.",
        )
        self.sign(
            "ferrovia", "ferrovia", EVENT_AGREEMENT, sent + timedelta(days=2, minutes=20), None
        )
        booked = sent + timedelta(days=2, hours=1)
        day = self.weekday_near(-40, 3)
        start = self.on(day, time(17, 30))
        if not self.fits(JULIAN, start, 180, 30):
            raise ValueError("ferrovia: the event doesn't fit the calendar")
        event = self.book("ferrovia", "ferrovia", EVENT, JULIAN, start, "completed", booked)
        self.deposit(event, booked + timedelta(minutes=15))
        assert event.completed_at is not None
        invoice = self.invoice(
            "ferrovia",
            "ferrovia",
            event.completed_at + timedelta(days=4, hours=14),
            booked,
            f"Event coverage, {day:%B} {day.day}. The 30% retainer is applied. The edited photos "
            "were delivered today.",
        )
        event.invoice_id = estimate.converted_invoice_id = invoice.id
        self.lines("invoice", invoice.id, quote, booked, booking=event)
        self.settle(invoice, "ferrovia", "card")

    def paid_promptly(self) -> None:
        """Pictured clients pay a portrait invoice by card from the link on the day it's sent."""
        pictured = {self.client_id(c.key) for c in CONTACTS if c.photo}
        paid = {p.invoice_id for p in self.ctx.all(Payment) if p.invoice_id}
        for invoice in self.ctx.all(Invoice):
            if invoice.client_id not in pictured or invoice.id in paid:
                continue
            issued = min(invoice.issued_at or self.now, self.now - timedelta(minutes=30))
            invoice.issued_at = invoice.updated_at = issued
            invoice.due_at = issued + timedelta(days=14)
            self.payment(
                invoice.client_id.removeprefix("cl_fn_"),
                issued + timedelta(minutes=20),
                "card",
                invoice_id=invoice.id,
                size="balance",
            )

    def held_deposits(self) -> None:
        """Clients pay the deposit when they book; a few recent online bookings still owe it."""
        waiting = 0
        for booking in sorted(self.ctx.all(Booking), key=lambda b: b.created_at):
            if booking.deposit_status != "pending":
                continue
            if booking.created_at > self.now - timedelta(days=3) and waiting < 2:
                waiting += 1
                continue
            self.deposit(booking, booking.created_at + timedelta(minutes=10))

    def latest(self, key: str) -> Booking:
        return max(
            (
                b
                for b in self.ctx.all(Booking)
                if b.client_id == self.client_id(key)
                and b.status == "completed"
                and (b.completed_at or self.now) < self.now - timedelta(days=2)
                and not b.id.endswith("_second")
            ),
            key=lambda b: b.starts_at,
        )

    def feedback(
        self, key: str, booking: Booking, answers: dict[str, object], *, days: float = 1
    ) -> FormResponse:
        assert booking.completed_at is not None
        submitted = min(booking.completed_at + timedelta(days=days), self.now - timedelta(hours=3))
        return self.response(
            "feedback",
            key,
            FEEDBACK,
            booking,
            answers,
            submitted,
            created=booking.completed_at + timedelta(hours=20),
        )

    def engagement(self) -> None:
        self.consents()
        self.withdraw("brandon", "email", self.now - timedelta(days=50))
        mini = self.weekday_near(3, 5)
        self.broadcast(
            "fall_mini",
            "Fall mini sessions",
            f"Our fall mini sessions are on Saturday, {mini:%B} {mini.day}, at Gage Park, by the "
            "rose garden. Each session is 20 minutes for up to six people, with 10 edited photos "
            "in an online gallery within two weeks. A $100 deposit holds your time, and the rest "
            "is due on the day. Times are first come, first served, and you can book them "
            "online. Reply to this email with any questions.",
            self.at(-31, 10),
        )
        aaliyah = self.ctx.get(Booking, "bk_fn_aaliyah")
        self.feedback(
            "aaliyah",
            aaliyah,
            {
                "rating": 5,
                "liked": "Amara and Julian were calm all day and somehow everywhere at once. The "
                "family photos took ten minutes because Amara had the list ready, and the "
                "gallery came a week earlier than promised. My grandmother cried at the album.",
                "recommend": "Yes",
                "quote": True,
            },
            days=48,
        )
        rohan = self.ctx.get(Booking, "bk_fn_rohan_family")
        self.feedback(
            "rohan",
            rohan,
            {
                "rating": 4,
                "liked": "The photos are lovely and Julian was great with our kids, even when "
                "our youngest refused to stand still.",
                "improve": "The gallery took five weeks, which was longer than we expected. We'd "
                "hoped to have prints before my parents visited.",
                "recommend": "Yes",
            },
            days=36,
        )
        for key, booking in (
            ("marco", self.ctx.get(Booking, "bk_fn_marco")),
            ("nicole", self.ctx.get(Booking, "bk_fn_nicole")),
            ("joseph", self.latest("joseph")),
            ("leila", self.ctx.get(Booking, "bk_fn_leila_newborn")),
            ("wei", self.ctx.get(Booking, "bk_fn_wei_family")),
        ):
            self.feedback(key, booking, {"rating": 5, "recommend": "Yes"}, days=4)
        for key in (
            "bk_fn_aaliyah",
            "bk_fn_rohan_family",
            "bk_fn_marco",
            "bk_fn_nicole",
            "bk_fn_anjali",
            "bk_fn_hana",
            "bk_fn_leila_newborn",
            "bk_fn_wei_family",
            "bk_fn_gabriela_family",
            "bk_fn_spring_mini_teresa",
            "bk_fn_spring_mini_rebecca",
        ):
            self.review(key.removeprefix("bk_fn_"))
        self.review(self.latest("joseph").id.removeprefix("bk_fn_"))
        self.conversations()

    def conversations(self) -> None:
        ctx = self.ctx
        olivia = ctx.get(Estimate, "est_fn_olivia")
        when = olivia.created_at - timedelta(days=3, hours=2)
        thread = self.thread("olivia", "email", when)
        self.say(
            thread,
            "Hi Amara, we're getting married next August at a farm near Binbrook and love your "
            "work. Could you send a quote for coverage from getting ready to the first dance? "
            "We're also wondering whether we need a second photographer for about 120 guests.",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Congratulations, Olivia, and thank you for thinking of us. Your date is open. I'll "
            "put together an estimate with eight hours of coverage. For 120 guests a second "
            "shooter helps, mostly during the ceremony and the reception, so I'll add one as an "
            "optional line along with the album.",
            when + timedelta(hours=2),
            sender=FIELDNOTE_OWNER,
        )
        self.say(
            thread,
            "Your estimate is ready, along with our agreement. Everything marked optional can "
            "be added or left out when you accept. Signing the agreement and paying the 30% "
            "retainer holds the date.",
            olivia.created_at + timedelta(minutes=10),
            sender=FIELDNOTE_OWNER,
        )
        sanjay = ctx.get(Booking, "bk_fn_sanjay")
        when = min(sanjay.starts_at - timedelta(days=12), self.now - timedelta(hours=20))
        thread = self.thread("sanjay", "sms", when)
        self.say(
            thread,
            "Hi Amara, the haldi might start at 10 instead of noon. Is it OK if you come earlier "
            "and finish earlier?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Yes, that works. We'll start at 10 and wrap after the first dance as planned. Your "
            "eight hours can shift earlier at no charge, and if the evening runs long we can add "
            "an hour on the day.",
            when + timedelta(minutes=40),
            sender=FIELDNOTE_OWNER,
        )
        emma = ctx.get(Invoice, "inv_fn_emma")
        assert emma.issued_at is not None
        thread = self.thread("emma", "email", emma.issued_at)
        self.say(
            thread,
            "Hi Emma, thank you both again for Saturday. Your sneak peek is on its way this "
            "week. The balance invoice is attached, and once it's paid we'll deliver the full "
            "gallery.",
            emma.issued_at + timedelta(minutes=5),
            sender=FIELDNOTE_OWNER,
        )
        self.say(
            thread,
            "Thank you! We're still smiling. We'll pay it this week once the gift money is in.",
            min(emma.issued_at + timedelta(hours=6), self.now - timedelta(hours=1)),
            sender=None,
        )
        kristen = ctx.get(Invoice, "inv_fn_kristen")
        if kristen.overdue_notified_at is not None:
            when = kristen.overdue_notified_at + timedelta(hours=2)
            thread = self.thread("kristen", "email", when)
            self.say(
                thread,
                f"Hi Kristen, invoice {kristen.number} for the wedding balance is past due. You "
                "can pay by card from the invoice link or by e-Transfer to "
                "hello@fieldnote.example. Let us know if a payment plan would help.",
                when,
            )
            self.say(
                thread,
                "Sorry, the honeymoon cost more than we planned. Could we pay half now and the "
                "rest at the end of next month?",
                when + timedelta(days=1, hours=3),
                sender=None,
            )
            self.say(
                thread,
                "That's fine. Send the first half when you can, and we'll release the gallery "
                "once the second half is in.",
                when + timedelta(days=1, hours=5),
                sender=FIELDNOTE_OWNER,
            )
        response = ctx.get(FormResponse, "fr_fn_feedback_rohan")
        assert response.submitted_at is not None
        when = response.submitted_at + timedelta(hours=3)
        thread = self.thread("rohan", "email", when)
        self.say(
            thread,
            "Thanks for the honest feedback, Rohan, and I'm sorry the gallery took five weeks. "
            "Your session fell in our busiest stretch of weddings, and we should have told you "
            "the timing up front. We now send every family gallery within three weeks and say "
            "so when you book. I've added a free 8 x 10 to your account for your parents.",
            when,
            sender=FIELDNOTE_OWNER,
        )
        self.say(
            thread,
            "That's kind of you, thank you. We'll pick one this week.",
            min(when + timedelta(hours=5), self.now - timedelta(minutes=30)),
            sender=None,
        )
        feedback = ctx.get(FormResponse, "fr_fn_feedback_aaliyah")
        assert feedback.submitted_at is not None
        when = feedback.submitted_at + timedelta(hours=1)
        thread = self.thread("aaliyah", "email", when)
        self.say(
            thread,
            "Thank you, Aaliyah. The photo of your grandmother at the head table is one of our "
            "favourites this year. Congratulations again to you and Marcus.",
            when,
            sender=FIELDNOTE_OWNER,
        )
        fatima = ctx.get(Booking, "bk_fn_fatima_newborn")
        when = fatima.created_at + timedelta(hours=2)
        thread = self.thread("fatima", "sms", when)
        self.say(
            thread,
            "Hi, I booked the newborn session but I don't know when the baby will come. Is it "
            "OK that the date might change?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Yes, that's normal for newborns. We've held a date about ten days after your due "
            "date. Text us when the baby arrives and we'll move it into the first two weeks.",
            when + timedelta(minutes=25),
        )
        james = ctx.get(Booking, "bk_fn_james_today")
        when = min(james.starts_at - timedelta(hours=20), self.now - timedelta(hours=2))
        thread = self.thread("james", "email", when)
        later = self.local(james.starts_at).date() > self.local(when).date()
        day = "tomorrow" if later else "today"
        self.say(
            thread,
            f"Hi James, a reminder that your headshot session is at the studio {day}. Bring "
            "two or three tops in solid colours, and we'll steam them if needed.",
            when,
        )
        self.say(thread, "Thanks, see you then.", when + timedelta(minutes=50), sender=None)
        chloe = ctx.get(Booking, "bk_fn_fall_mini_chloe")
        when = chloe.created_at + timedelta(minutes=30)
        thread = self.thread("chloe", "email", when)
        self.say(
            thread,
            "We booked the 9:00 mini session. Is it all right if we bring our dog?",
            when,
            sender=None,
        )
        self.say(
            thread,
            "Of course, Chloé. Dogs are welcome on a leash. We'll start with a few of him and "
            "the kids while everyone settles in.",
            when + timedelta(hours=1),
        )
        brandon = ctx.get(Booking, "bk_fn_brandon_moved")
        when = min(brandon.created_at + timedelta(days=1), self.now - timedelta(hours=4))
        thread = self.thread("brandon", "sms", when)
        self.say(
            thread,
            "Hi, our youngest has a fever. Could we move our family session to the following week?",
            when,
            sender=None,
        )
        local = self.local(brandon.starts_at)
        self.say(
            thread,
            f"Sorry to hear that, Brandon. You're now booked for {local:%A, %B} {local.day} at "
            f"{local:%I:%M %p}".replace(" 0", " ")
            + ". The deposit carries over, and we hope she feels better soon.",
            when + timedelta(minutes=15),
        )
        wei = ctx.get(Booking, "bk_fn_wei_ordering")
        assert wei.completed_at is not None
        when = wei.completed_at + timedelta(hours=3)
        thread = self.thread("wei", "email", when)
        self.say(
            thread,
            "Thanks for coming in today, Wei Ling. Your canvas and prints go to the lab on "
            "Monday. The canvas takes about two weeks and the prints about ten days, and we'll "
            "text you when they're ready to pick up.",
            when,
        )


EDITION = Fieldnote
