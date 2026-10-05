from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Line
from clientbridge.services.business import business_province, business_tax_registered

_PRECISE: dict[str, Decimal] = {"QST": Decimal("0.09975")}
_FEDERAL = frozenset({"GST", "HST"})


def effective_rate(jurisdiction: str, rate_bps: int) -> Decimal:
    """The exact decimal rate for a jurisdiction (QST is 9.975%, finer than a whole basis point)."""
    return _PRECISE.get(jurisdiction, Decimal(rate_bps) / Decimal(10000))


def _cents(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class TaxComponent:
    jurisdiction: str
    rate_bps: int


@dataclass(frozen=True)
class TaxLine:
    amount_cents: int
    taxable: bool = True
    tax_class: str = "standard"  # standard · federal_only (GST/HST, no PST/QST) · exempt


@dataclass(frozen=True)
class LineTax:
    base_cents: int
    tax_cents: int
    by_jurisdiction: dict[str, int]


@dataclass(frozen=True)
class TaxResult:
    subtotal_cents: int
    tax_total_cents: int
    total_cents: int
    by_jurisdiction: dict[str, int]
    lines: list[LineTax]


def compute_tax(
    lines: Sequence[TaxLine],
    rates: Sequence[TaxComponent],
    *,
    registered: bool = True,
    prices_include_tax: bool = False,
) -> TaxResult:
    """Compute per-line and invoice tax. `registered=False` (small supplier) collects no tax."""
    active = list(rates) if registered else []
    results = [_line(line, active, prices_include_tax) for line in lines]
    subtotal = sum(r.base_cents for r in results)
    tax_total = sum(r.tax_cents for r in results)
    by_jur: dict[str, int] = {}
    for r in results:
        for jurisdiction, cents in r.by_jurisdiction.items():
            by_jur[jurisdiction] = by_jur.get(jurisdiction, 0) + cents
    return TaxResult(subtotal, tax_total, subtotal + tax_total, by_jur, results)


def _line(line: TaxLine, all_rates: Sequence[TaxComponent], inclusive: bool) -> LineTax:
    if line.tax_class == "federal_only":
        rates: Sequence[TaxComponent] = [r for r in all_rates if r.jurisdiction in _FEDERAL]
    else:
        rates = all_rates
    if not line.taxable or line.tax_class == "exempt" or not rates:
        return LineTax(line.amount_cents, 0, {})

    if inclusive:
        total_rate = Decimal(0)
        for r in rates:
            total_rate += effective_rate(r.jurisdiction, r.rate_bps)
        base = Decimal(line.amount_cents) / (Decimal(1) + total_rate)
        by_jur = {
            r.jurisdiction: _cents(base * effective_rate(r.jurisdiction, r.rate_bps)) for r in rates
        }
        tax = sum(by_jur.values())
        return LineTax(line.amount_cents - tax, tax, by_jur)

    by_jur = {
        r.jurisdiction: _cents(
            Decimal(line.amount_cents) * effective_rate(r.jurisdiction, r.rate_bps)
        )
        for r in rates
    }
    tax = sum(by_jur.values())
    return LineTax(line.amount_cents, tax, by_jur)


# province → [(jurisdiction, rate_bps, name)]
PROVINCE_TAX_RATES: dict[str, list[tuple[str, int, str]]] = {
    "BC": [("GST", 500, "GST 5%"), ("PST", 700, "PST (BC) 7%")],
    "AB": [("GST", 500, "GST 5%")],
    "SK": [("GST", 500, "GST 5%"), ("PST", 600, "PST (SK) 6%")],
    "MB": [("GST", 500, "GST 5%"), ("PST", 700, "PST (MB) 7%")],
    "ON": [("HST", 1300, "HST (ON) 13%")],
    "QC": [("GST", 500, "GST 5%"), ("QST", 998, "QST 9.975%")],
    "NB": [("HST", 1500, "HST 15%")],
    "NS": [("HST", 1500, "HST 15%")],
    "NL": [("HST", 1500, "HST 15%")],
    "PE": [("HST", 1500, "HST 15%")],
    "YT": [("GST", 500, "GST 5%")],
    "NT": [("GST", 500, "GST 5%")],
    "NU": [("GST", 500, "GST 5%")],
}


@dataclass(frozen=True)
class ProvinceRate:
    """One sales-tax component (e.g. BC PST 7%) — what the tax engine and `/v1/tax-rates` use."""

    jurisdiction: str
    province: str
    rate_bps: int
    name: str

    @property
    def id(self) -> str:
        return f"{self.province}_{self.jurisdiction}"  # synthetic key for the API/UI list


def rates_for_province(province: str | None) -> list[ProvinceRate]:
    """The sales-tax components for a province (empty if unknown/unset)."""
    if province is None:
        return []
    return [
        ProvinceRate(jurisdiction=jurisdiction, province=province, rate_bps=rate_bps, name=name)
        for jurisdiction, rate_bps, name in PROVINCE_TAX_RATES.get(province, [])
    ]


async def rates_for_business(db: AsyncSession, business_id: str) -> Sequence[ProvinceRate]:
    """The rates a business collects — derived from its province."""
    return rates_for_province(await business_province(db, business_id))


async def tax_for_amount(db: AsyncSession, business_id: str, amount_cents: int) -> TaxResult:
    """Tax for a single taxable amount, through the line engine."""
    return await tax_for_lines(db, business_id, [Line(amount_cents=amount_cents)])


async def tax_breakdown(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """The tax engine's result for these lines, without writing anything back."""
    rates = await rates_for_business(db, business_id)
    registered = await business_tax_registered(db, business_id)
    return compute_tax(
        [
            TaxLine(amount_cents=ln.amount_cents, tax_class=ln.tax_class or "standard")
            for ln in lines
        ],
        [TaxComponent(jurisdiction=r.jurisdiction, rate_bps=r.rate_bps) for r in rates],
        registered=registered,
    )


async def tax_for_lines(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """Run the tax engine over a parent's lines, writing each line's tax."""
    result = await tax_breakdown(db, business_id, lines)
    for ln, line_tax in zip(lines, result.lines, strict=True):
        ln.tax_amount_cents = line_tax.tax_cents
    return result
