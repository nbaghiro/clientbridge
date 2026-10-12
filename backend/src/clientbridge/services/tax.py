from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from math import floor

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Line
from clientbridge.services.business import business_province, business_tax_registered, business_tz

FEDERAL_CODES = ("GST", "HST")


@dataclass(frozen=True)
class Rate:
    """A tax a province charges from `valid_from` until a later row for the same code."""

    province: str
    code: str
    rate: Decimal
    valid_from: date


_GST_5 = date(2008, 1, 1)

# A row with a zero rate ends a code (a province leaving the HST); clients name taxes by code.
RATES: tuple[Rate, ...] = (
    Rate("AB", "GST", Decimal("0.05"), _GST_5),
    Rate("BC", "GST", Decimal("0.05"), _GST_5),
    Rate("BC", "PST", Decimal("0.07"), date(2013, 4, 1)),
    Rate("MB", "GST", Decimal("0.05"), _GST_5),
    Rate("MB", "PST", Decimal("0.07"), date(2019, 7, 1)),
    Rate("NB", "HST", Decimal("0.15"), date(2016, 7, 1)),
    Rate("NL", "HST", Decimal("0.15"), date(2016, 7, 1)),
    Rate("NS", "HST", Decimal("0.15"), date(2010, 7, 1)),
    Rate("NS", "HST", Decimal("0.14"), date(2025, 4, 1)),
    Rate("NT", "GST", Decimal("0.05"), _GST_5),
    Rate("NU", "GST", Decimal("0.05"), _GST_5),
    Rate("ON", "HST", Decimal("0.13"), date(2010, 7, 1)),
    Rate("PE", "HST", Decimal("0.15"), date(2016, 10, 1)),
    Rate("QC", "GST", Decimal("0.05"), _GST_5),
    Rate("QC", "QST", Decimal("0.09975"), date(2013, 1, 1)),
    Rate("SK", "GST", Decimal("0.05"), _GST_5),
    Rate("SK", "PST", Decimal("0.06"), date(2017, 3, 23)),
    Rate("YT", "GST", Decimal("0.05"), _GST_5),
)


def basis_points(rate: Decimal) -> int:
    """A rate in whole basis points, half up (QST's 9.975% is 998)."""
    return int((rate * 10000).quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class TaxComponent:
    jurisdiction: str
    rate: Decimal


@dataclass(frozen=True)
class ProvinceRate:
    """One sales-tax component (e.g. BC PST 7%) — what the tax engine and `/v1/tax-rates` use."""

    jurisdiction: str
    province: str
    rate: Decimal

    @property
    def id(self) -> str:
        return f"{self.province}_{self.jurisdiction}"  # synthetic key for the API/UI list

    @property
    def rate_bps(self) -> int:
        return basis_points(self.rate)


def rates_on(province: str | None, on: date) -> list[ProvinceRate]:
    """The sales-tax components a province charges on a date of supply (empty if unknown/unset)."""
    current: dict[str, Rate] = {}
    for row in RATES:
        if row.province != province or row.valid_from > on:
            continue
        if row.code not in current or row.valid_from > current[row.code].valid_from:
            current[row.code] = row
    return [
        ProvinceRate(jurisdiction=code, province=row.province, rate=row.rate)
        for code, row in current.items()
        if row.rate
    ]


def _cents(value: Fraction) -> int:
    whole = floor(abs(value) + Fraction(1, 2))
    return whole if value >= 0 else -whole


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
    return _total([_line(line, active, prices_include_tax) for line in lines])


def _total(results: list[LineTax]) -> TaxResult:
    subtotal = sum(r.base_cents for r in results)
    tax_total = sum(r.tax_cents for r in results)
    by_jur: dict[str, int] = {}
    for r in results:
        for jurisdiction, cents in r.by_jurisdiction.items():
            by_jur[jurisdiction] = by_jur.get(jurisdiction, 0) + cents
    return TaxResult(subtotal, tax_total, subtotal + tax_total, by_jur, results)


def _applied(tax_class: str, rates: Sequence[TaxComponent]) -> list[TaxComponent]:
    if tax_class == "exempt":
        return []
    if tax_class == "federal_only":
        return [r for r in rates if r.jurisdiction in FEDERAL_CODES]
    return list(rates)


def _line(line: TaxLine, all_rates: Sequence[TaxComponent], inclusive: bool) -> LineTax:
    rates = _applied(line.tax_class, all_rates)
    if not line.taxable or not rates:
        return LineTax(line.amount_cents, 0, {})
    divisor = 1 + sum((Fraction(r.rate) for r in rates), Fraction(0)) if inclusive else 1
    by_jur = {r.jurisdiction: _cents(line.amount_cents * Fraction(r.rate) / divisor) for r in rates}
    tax = sum(by_jur.values())
    return LineTax(line.amount_cents - tax if inclusive else line.amount_cents, tax, by_jur)


def split_fixed(lines: Sequence[tuple[TaxLine, int]], rates: Sequence[TaxComponent]) -> TaxResult:
    """Each line's tax as fixed at issue, split by code with the rates in force then."""
    results: list[LineTax] = []
    for line, fixed in lines:
        applied = _applied(line.tax_class, rates)
        if fixed == 0 or not applied:
            results.append(LineTax(line.amount_cents, fixed, {}))
            continue
        worked = _line(line, applied, inclusive=False)
        if worked.tax_cents != fixed:
            whole = sum((Fraction(r.rate) for r in applied), Fraction(0))
            parts = {r.jurisdiction: _cents(fixed * Fraction(r.rate) / whole) for r in applied}
            last = applied[-1].jurisdiction
            parts[last] += fixed - sum(parts.values())
            worked = LineTax(line.amount_cents, fixed, parts)
        results.append(worked)
    return _total(results)


async def supply_date(db: AsyncSession, business_id: str, at: datetime | None = None) -> date:
    """The business's calendar date at `at` (now when omitted): the date a supply is taxed on."""
    return (at or datetime.now(UTC)).astimezone(await business_tz(db, business_id)).date()


async def rates_for_business(
    db: AsyncSession, business_id: str, at: datetime | None = None
) -> list[ProvinceRate]:
    """The rates a business collects on the date of `at` — derived from its province."""
    province = await business_province(db, business_id)
    return rates_on(province, await supply_date(db, business_id, at))


async def _components(
    db: AsyncSession, business_id: str, at: datetime | None
) -> list[TaxComponent]:
    return [
        TaxComponent(r.jurisdiction, r.rate) for r in await rates_for_business(db, business_id, at)
    ]


async def tax_for_amount(
    db: AsyncSession,
    business_id: str,
    amount_cents: int,
    *,
    tax_class: str = "standard",
    at: datetime | None = None,
) -> TaxResult:
    """Tax for a single taxable amount, through the line engine."""
    return await tax_breakdown(
        db, business_id, [Line(amount_cents=amount_cents, tax_class=tax_class)], at
    )


async def tax_within(
    db: AsyncSession, business_id: str, total_cents: int, *, tax_class: str, at: datetime
) -> TaxResult:
    """The tax contained in a tax-inclusive total charged at `at`."""
    return compute_tax(
        [TaxLine(amount_cents=total_cents, tax_class=tax_class)],
        await _components(db, business_id, at),
        registered=await business_tax_registered(db, business_id),
        prices_include_tax=True,
    )


async def tax_breakdown(
    db: AsyncSession, business_id: str, lines: list[Line], at: datetime | None = None
) -> TaxResult:
    """The tax engine's result for these lines, without writing anything back."""
    return compute_tax(
        [TaxLine(amount_cents=ln.amount_cents, tax_class=ln.tax_class) for ln in lines],
        await _components(db, business_id, at),
        registered=await business_tax_registered(db, business_id),
    )


async def tax_for_lines(db: AsyncSession, business_id: str, lines: list[Line]) -> TaxResult:
    """Run the tax engine over a parent's lines at today's rates, writing each line's tax."""
    result = await tax_breakdown(db, business_id, lines)
    for ln, line_tax in zip(lines, result.lines, strict=True):
        ln.tax_amount_cents = line_tax.tax_cents
    return result


async def issued_tax(
    db: AsyncSession, business_id: str, lines: list[Line], issued_at: datetime
) -> TaxResult:
    """The tax fixed on a document's lines when it was issued; never recomputed from settings."""
    return split_fixed(
        [
            (TaxLine(amount_cents=ln.amount_cents, tax_class=ln.tax_class), ln.tax_amount_cents)
            for ln in lines
        ],
        await _components(db, business_id, issued_at),
    )
