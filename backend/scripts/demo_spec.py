"""The declarative shape of a demo business that the demo engine builds."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import time
from typing import Literal

from clientbridge.models.business import Plan, RateType, StaffRole, SubjectKind
from clientbridge.models.catalog import DepositType, Frequency, ItemKind, TaxClass
from clientbridge.models.documents import FieldInput, SendOn
from scripts.demo_context import DemoBusiness

# name, input, label, help, required, options
type DocField = tuple[str, FieldInput, str, str | None, bool, tuple[str, ...]]
# weekday (Monday is 0) -> opening and closing time
type Weekly = Mapping[int, tuple[time, time]]
type Settle = Literal["card", "etransfer", "cheque", "cash", "open", "overdue"]
type Paid = Literal["card", "etransfer", "cheque", "cash"]


@dataclass(frozen=True)
class Person:
    user_id: str
    staff_id: str
    login: str
    name: str
    phone: str
    role: StaffRole
    title: str
    color: str
    hours: Weekly = field(default_factory=dict[int, tuple[time, time]])
    payee: bool = False
    bookable_online: bool = True
    rate_type: RateType | None = None
    rate_bps: int | None = None
    rate_cents: int | None = None
    photo: bool = True


@dataclass(frozen=True)
class Stock:
    on_hand: int
    low_at: int


@dataclass(frozen=True)
class Offering:
    """One catalog item; `ref` names its subscriptions and packages in demo ids."""

    id: str
    kind: ItemKind
    name: str
    price_cents: int
    category: str
    description: str
    tax_class: TaxClass
    minutes: int | None = None
    color: str = "#5E7391"
    online_bookable: bool = False
    sell_online: bool = False
    capacity: int | None = None
    addon_for: tuple[str, ...] = ()
    buffer_after_min: int = 0
    deposit_type: DepositType = "none"
    deposit_value: int | None = None
    frequency: Frequency | None = None
    sku: str | None = None
    cost_cents: int | None = None
    stock: Stock | None = None
    sessions: int | None = None
    covers: str | None = None
    validity_days: int | None = None
    ref: str | None = None
    # a contract the client signs before the first charge of this subscription
    contract: str | None = None


@dataclass(frozen=True)
class FormSpec:
    id: str
    name: str
    field_prefix: str
    fields: tuple[DocField, ...]
    require_signature: bool = False
    send_on: SendOn = "manual"


@dataclass(frozen=True)
class ContractSpec:
    """A contract; clients who signed before `revised_day` signed `earlier_body` as version 1."""

    id: str
    name: str
    body: str
    version: int = 1
    earlier_body: str | None = None
    revised_day: int | None = None
    created_day: int | None = None


@dataclass(frozen=True)
class Stage:
    """One step of the vertical's workflow and the client seeded at it."""

    name: str
    client: str
    rows: tuple[str, ...] = ()


@dataclass(frozen=True)
class Pacing:
    """How busy the generated history is: visits per staff member each week, by month."""

    visits_per_week: Mapping[str, int]
    services: tuple[str, ...]
    weeks: int = 26
    ahead_weeks: int = 4
    # month (1 to 12) -> share of the usual week's visits
    seasonality: Mapping[int, float] = field(default_factory=dict[int, float])
    settlements: tuple[Settle, ...] = ("card", "card", "etransfer", "card", "cash")
    no_show_every: int = 0
    cancel_every: int = 0


@dataclass(frozen=True)
class BusinessSpec:
    listing: DemoBusiness
    code: str
    slug: str
    login_domain: str
    owner: str
    people: tuple[Person, ...]
    items: tuple[Offering, ...]
    brand: Mapping[str, object]
    booking_policy: Mapping[str, object]
    subject: SubjectKind | None
    sms_number: str
    gst_hst_number: str | None = None
    pst_number: str | None = None
    plan: Plan = "team"
    forms: tuple[FormSpec, ...] = ()
    contracts: tuple[ContractSpec, ...] = ()
    storyline: tuple[Stage, ...] = ()
    pacing: Pacing | None = None
    photo_clients: tuple[str, ...] = ()
    inbox_user: str | None = None
    # the prefix of its logo and catalog images in demo_assets, when it differs from the code
    assets: str | None = None
    founded_day: int = -640
    catalog_day: int = -300
    documents_day: int = -290
    restock_days: tuple[int, ...] = (-300, -240, -180, -120, -60, -20)
    payouts_from_day: int = -266
    failed_payout_day: int | None = None
    invoice_start: int = 2100
    estimate_start: int = 300
    cheque_start: int = 3100
    seed: int = 23

    @property
    def id(self) -> str:
        return self.listing.id

    @property
    def stripe_account_id(self) -> str:
        return f"acct_demo_{self.listing.id.removeprefix('bz_')}"
