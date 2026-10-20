from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from clientbridge.core.db import Base

DEMO_VERSION = "2026-10-20.1"
DEMO_PASSWORD = "demo1234"  # every seeded user logs in with this
BUSINESS_TIMEZONE = ZoneInfo("America/Vancouver")


@dataclass(frozen=True)
class LegalAddress:
    street_number: str
    street_name: str
    city: str
    province: str
    postal_code: str
    legal_phone: str


@dataclass(frozen=True)
class SubjectRule:
    """A service that suits only some subjects, such as a cat groom or a small-dog weight limit."""

    items: tuple[str, ...]
    attribute: str
    equals: str | None = None
    differs: str | None = None
    at_most: float | None = None

    def fits(self, attributes: dict[str, object]) -> bool:
        value = attributes.get(self.attribute)
        if self.equals is not None and value != self.equals:
            return False
        if self.differs is not None and value == self.differs:
            return False
        return self.at_most is None or float(str(value or 0)) <= self.at_most


@dataclass(frozen=True)
class Showcase:
    """The rows the marketing site's demo snapshot shows, picked from one business."""

    staff_id: str
    invoices: tuple[str, ...]
    services: tuple[str, ...]
    stock: tuple[str, ...]
    shop: tuple[str, ...]
    tap_item: str
    tap_client: str


@dataclass(frozen=True)
class DemoBusiness:
    id: str
    name: str
    email: str
    first_name: str
    last_name: str
    product_description: str
    primary_color: str
    legal: LegalAddress
    owner_login: str
    url: str | None = None
    timezone: str = "America/Vancouver"
    # the module that builds it on the demo engine, which exposes EDITION
    edition: str | None = None
    rules: tuple[SubjectRule, ...] = ()
    showcase: Showcase | None = None

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


DEMO_BUSINESSES = (
    DemoBusiness(
        id="bz_birchbark",
        name="Birchbark Pet Studio",
        email="hello@birchbark.example",
        first_name="Hannah",
        last_name="Wong",
        product_description="Pet grooming and daycare",
        primary_color="#2E4A3F",
        url="https://birchbarkpets.ca",
        legal=LegalAddress(
            "1207", "Government Street", "Victoria", "BC", "V8W 1Y9", "+12505550110"
        ),
        owner_login="hannah@birchbark.example",
        rules=(
            SubjectRule(("it_cat",), "species", equals="cat"),
            SubjectRule(("it_groom_sm", "it_groom_lg"), "species", differs="cat"),
            SubjectRule(("it_groom_sm",), "weight_kg", at_most=11.34),
        ),
        showcase=Showcase(
            staff_id="st_owner",
            invoices=("inv_1001", "inv_1002", "inv_1003", "inv_1004", "inv_1005", "inv_draft"),
            services=("it_groom_lg", "it_bath", "it_cat", "it_nails"),
            stock=("it_shampoo", "it_brush", "it_nails"),
            shop=("it_shampoo", "it_brush"),
            tap_item="it_groom_sm",
            tap_client="cl_amelie",
        ),
    ),
    DemoBusiness(
        id="bz_demo_second",
        name="Cedar Coast Pet Care",
        email="owner@cedarcoast.example.test",
        first_name="Rowan",
        last_name="Ellis",
        product_description="Dog walking and drop-in pet care",
        primary_color="#35576B",
        legal=LegalAddress("455", "Granville Street", "Vancouver", "BC", "V6C 1T1", "+16045550120"),
        owner_login="owner@cedarcoast.example.test",
    ),
    DemoBusiness(
        id="bz_northlight",
        name="Northlight Security",
        email="hello@northlight.example",
        first_name="Erik",
        last_name="Lindqvist",
        product_description="Security camera installation and service",
        primary_color="#1F2F4A",
        legal=LegalAddress("2860", "Quadra Street", "Victoria", "BC", "V8T 4E7", "+12505550198"),
        owner_login="owner@northlight.example",
        edition="scripts.demo_northlight",
    ),
    DemoBusiness(
        id="bz_brightwater",
        name="Brightwater Home Cleaning",
        email="hello@brightwater.example",
        first_name="Leah",
        last_name="Tran",
        product_description="House and condo cleaning",
        primary_color="#1E6A73",
        legal=LegalAddress("1324", "9 Avenue SE", "Calgary", "AB", "T2G 0T2", "+14035550198"),
        owner_login="owner@brightwater.example",
        timezone="America/Edmonton",
        edition="scripts.demo_brightwater",
    ),
    DemoBusiness(
        id="bz_ridgeline",
        name="Ridgeline Strength Studio",
        email="hello@ridgeline.example",
        first_name="Jenna",
        last_name="Kowalchuk",
        product_description="Personal training and small group fitness classes",
        primary_color="#9C4221",
        legal=LegalAddress("10418", "82 Avenue NW", "Edmonton", "AB", "T6E 2A2", "+17805550198"),
        owner_login="owner@ridgeline.example",
        timezone="America/Edmonton",
        edition="scripts.demo_ridgeline",
    ),
    DemoBusiness(
        id="bz_lakeside",
        name="Lakeside Learning Studio",
        email="hello@lakeside.example",
        first_name="Nadia",
        last_name="Haddad",
        product_description="Tutoring and music lessons",
        primary_color="#24506B",
        legal=LegalAddress("512", "Preston Street", "Ottawa", "ON", "K1R 7P8", "+16135550198"),
        owner_login="owner@lakeside.example",
        timezone="America/Toronto",
        edition="scripts.demo_lakeside",
    ),
)
DEMO_IDS = tuple(business.id for business in DEMO_BUSINESSES)
# the business the web, Connect and end-to-end fixtures target unless told otherwise
FIXTURE_BUSINESS = "bz_birchbark"


def demo_business(business_id: str) -> DemoBusiness:
    return next(business for business in DEMO_BUSINESSES if business.id == business_id)


@dataclass
class DemoContext:
    now: datetime
    business_id: str
    owner_id: str
    rows: list[Base] = field(default_factory=list)
    zone: ZoneInfo = BUSINESS_TIMEZONE

    def at(self, days: float, hour: int = 9, minute: int = 0) -> datetime:
        local = self.now.astimezone(self.zone) + timedelta(days=days)
        return local.replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(UTC)

    def all[T: Base](self, model: type[T]) -> list[T]:
        return [
            row
            for row in self.rows
            if isinstance(row, model)
            and getattr(row, "business_id", None) in {None, self.business_id}
        ]

    def get[T: Base](self, model: type[T], row_id: str) -> T:
        return next(row for row in self.all(model) if getattr(row, "id", None) == row_id)

    def add(self, *rows: Base) -> None:
        self.rows.extend(rows)
