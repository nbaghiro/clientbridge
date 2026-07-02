"""Canadian sales-tax rates, derived from a business's province.

No `tax_rates` table — these are government-set, province-keyed rates, not per-business data.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.identity import Business

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
    province = (
        await db.execute(select(Business.province).where(Business.id == business_id))
    ).scalar_one_or_none()
    return rates_for_province(province)
