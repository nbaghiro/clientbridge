"""Pure Canadian sales-tax engine — GST/HST/PST/QST, line-level, per-province. No DB; golden-tested.

`rate_bps` is basis points (500 = 5%). QST is legally 9.975% — finer than a whole
basis point (seeded as ~998 bps for display) — computed precisely here; all others are exact.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

_PRECISE: dict[str, Decimal] = {"QST": Decimal("0.09975")}


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


def _line(line: TaxLine, rates: Sequence[TaxComponent], inclusive: bool) -> LineTax:
    if not line.taxable or not rates:
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
