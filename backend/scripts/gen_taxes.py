"""Write the frontend's bundled tax rate table and its engine parity cases from services/tax.py."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

from clientbridge.services.tax import (
    FEDERAL_CODES,
    RATES,
    TaxComponent,
    TaxLine,
    TaxResult,
    compute_tax,
    rates_on,
)

APP_CORE = Path(__file__).resolve().parents[2] / "frontend" / "packages" / "app-core" / "src"
CASE_DAY = date(2026, 7, 1)
HISTORY = (("NS", date(2025, 3, 31)), ("NS", date(2025, 4, 1)))
CASE_AMOUNTS = (0, 1, 10, -10, 999, 2400, 10000, 11200, 100000, 123457, -2500)
TAX_CLASSES = ("standard", "federal_only", "exempt")


def ppm(rate: Decimal) -> int:
    parts = rate * 1_000_000
    if parts != parts.to_integral_value():
        raise ValueError(f"{rate} is finer than a part per million")
    return int(parts)


def table() -> str:
    rows = [
        {
            "province": r.province,
            "code": r.code,
            "ppm": ppm(r.rate),
            "from": r.valid_from.isoformat(),
        }
        for r in RATES
    ]
    federal = json.dumps(list(FEDERAL_CODES))
    return (
        "// Generated from services/tax.py by `make gen-taxes`; edit the backend rate table.\n"
        'import type { RateRow } from "./domain/taxes";\n\n'
        f"export const FEDERAL_TAX_CODES: readonly string[] = {federal};\n\n"
        f"export const TAX_RATES: readonly RateRow[] = {json.dumps(rows)};\n"
    )


def outcome(result: TaxResult) -> dict[str, object]:
    return {
        "subtotalCents": result.subtotal_cents,
        "taxCents": result.tax_total_cents,
        "totalCents": result.total_cents,
        "byCode": result.by_jurisdiction,
        "lines": [[t.base_cents, t.by_jurisdiction] for t in result.lines],
    }


def cases() -> dict[str, object]:
    """Every province and class, collecting or not, priced with and without tax."""
    lines = [TaxLine(amount, tax_class=c) for c in TAX_CLASSES for amount in CASE_AMOUNTS]
    days = [*((p, CASE_DAY) for p in sorted({r.province for r in RATES})), *HISTORY]
    found = [
        {
            "province": province,
            "on": on.isoformat(),
            "registered": registered,
            "inclusive": inclusive,
            "expected": outcome(
                compute_tax(
                    lines,
                    [TaxComponent(r.jurisdiction, r.rate) for r in rates_on(province, on)],
                    registered=registered,
                    prices_include_tax=inclusive,
                )
            ),
        }
        for province, on in days
        for registered in (True, False)
        for inclusive in (False, True)
    ]
    shared = [{"amountCents": ln.amount_cents, "taxClass": ln.tax_class} for ln in lines]
    return {"lines": shared, "cases": found}


def main() -> None:
    (APP_CORE / "taxRates.ts").write_text(table())
    (APP_CORE / "taxes.cases.json").write_text(json.dumps(cases()) + "\n")


if __name__ == "__main__":
    main()
